import { KiroDocument, KiroInline } from "@/lib/ai/computer/documents/types";
import { ResolvedDocumentTheme } from "@/lib/ai/computer/documents/styles/types";

/**
 * Document IR → DOCX（Kiro Document Engine V2）。
 *
 * 使用成熟 `docx` renderer（library-level primitives：Document / Paragraph / TextRun /
 * Table / TableRow / TableCell / PageBreak / numbering），不再手写 OOXML / 手拼 ZIP。
 * - renderDocx() 公共 API 保持 Uint8Array（executor / Artifact / Undo / Preview / Download 无需感知替换）
 * - `docx` 按需动态加载（普通聊天不生成 Word 时避免初始 bundle 负担）
 * - 浏览器输出路径：Document → Packer.toBlob() → Blob.arrayBuffer() → Uint8Array
 * - 强 invariant：TableCell children 永远包含 Paragraph（TextRun 绝不作为 TableCell 直接 child）
 * - bullet / numbered list 使用真正的 DOCX numbering（不把 "•" / "1." 当普通字符拼入）
 *
 * 排版全部来自 styles/resolve.ts 的 ResolvedDocumentTheme（renderer 不自行堆 magic number）。
 */

type Docx = typeof import("docx");

let docxModulePromise: Promise<Docx> | null = null;
function loadDocx(): Promise<Docx> {
  if (!docxModulePromise) docxModulePromise = import("docx") as Promise<Docx>;
  return docxModulePromise;
}

export async function renderDocx(doc: KiroDocument): Promise<Uint8Array> {
  const docx = await loadDocx();
  const { resolveDocumentTheme } = await import("./styles/resolve");
  const theme = resolveDocumentTheme(doc.stylePreset, doc.styleHints);

  const { Document, Packer, AlignmentType, LevelFormat, LineRuleType } = docx;
  const children = buildChildren(docx, doc, theme);

  const packed = new Document({
    numbering: {
      config: [
        {
          reference: "kiro-bullet",
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "\u2022",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: {
                    left: theme.list.indentLeftTwip,
                    hanging: theme.list.hangingTwip,
                  },
                },
              },
            },
          ],
        },
        {
          reference: "kiro-number",
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: {
                    left: theme.list.indentLeftTwip,
                    hanging: theme.list.hangingTwip,
                  },
                },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: theme.page.widthTwip, height: theme.page.heightTwip },
            margin: {
              top: theme.page.topTwip,
              right: theme.page.rightTwip,
              bottom: theme.page.bottomTwip,
              left: theme.page.leftTwip,
            },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(packed);
  return new Uint8Array(await blob.arrayBuffer());
}

function buildChildren(docx: Docx, doc: KiroDocument, theme: ResolvedDocumentTheme) {
  const { Paragraph, TextRun, Table, TableRow, TableCell, PageBreak, AlignmentType, BorderStyle, LineRuleType, WidthType } = docx;
  const out: InstanceType<typeof Paragraph | typeof Table>[] = [];

  const makeRuns = (
    inline: KiroInline[] | undefined,
    overrides?: { bold?: boolean; sizePt?: number; font?: { eastAsia: string; latin: string } }
  ): InstanceType<typeof TextRun>[] =>
    (inline ?? []).map(
      (run) =>
        new TextRun({
          text: run.text,
          bold: overrides?.bold ?? run.bold,
          italics: run.italic,
          font: {
            ascii: overrides?.font?.latin ?? theme.body.latinFont,
            hAnsi: overrides?.font?.latin ?? theme.body.latinFont,
            eastAsia: overrides?.font?.eastAsia ?? theme.body.eastAsiaFont,
          },
          size: Math.round((overrides?.sizePt ?? theme.body.fontSizePt) * 2),
        })
    );

  const bodyAlign = (a: "left" | "center" | "justify") =>
    a === "justify" ? AlignmentType.JUSTIFIED : a === "center" ? AlignmentType.CENTER : AlignmentType.LEFT;

  const bodySpacing = (spaceBeforePt: number, spaceAfterPt: number, lineSpacing: number) => ({
    line: Math.round(lineSpacing * 240),
    lineRule: LineRuleType.AUTO,
    before: Math.round(spaceBeforePt * 20),
    after: Math.round(spaceAfterPt * 20),
  });

  if (doc.title) {
    out.push(
      new Paragraph({
        alignment: bodyAlign(theme.title.alignment),
        spacing: bodySpacing(theme.title.spaceBeforePt, theme.title.spaceAfterPt, 1.5),
        children: [
          new TextRun({
            text: doc.title,
            bold: theme.title.bold,
            font: { ascii: theme.title.latinFont, hAnsi: theme.title.latinFont, eastAsia: theme.title.eastAsiaFont },
            size: theme.title.fontSizePt * 2,
          }),
        ],
      })
    );
  }

  for (const block of doc.blocks) {
    switch (block.type) {
      case "heading": {
        const h = block.level === 1 ? theme.heading1 : block.level === 2 ? theme.heading2 : theme.heading3;
        out.push(
          new Paragraph({
            alignment: bodyAlign(h.alignment),
            spacing: bodySpacing(h.spaceBeforePt, h.spaceAfterPt, h.lineSpacing),
            children: [
              new TextRun({
                text: (block.content ?? []).map((r) => r.text).join(""),
                bold: h.bold,
                font: { ascii: h.latinFont, hAnsi: h.latinFont, eastAsia: h.eastAsiaFont },
                size: h.fontSizePt * 2,
              }),
            ],
          })
        );
        break;
      }
      case "paragraph":
        out.push(
          new Paragraph({
            alignment: bodyAlign(theme.body.alignment),
            spacing: bodySpacing(theme.body.spaceBeforePt, theme.body.spaceAfterPt, theme.body.lineSpacing),
            indent:
              theme.body.firstLineIndentChars > 0
                ? { firstLineChars: Math.round(theme.body.firstLineIndentChars * 100) }
                : undefined,
            children: makeRuns(block.content),
          })
        );
        break;
      case "bullet-list":
        for (const item of block.items) {
          out.push(
            new Paragraph({
              numbering: { reference: "kiro-bullet", level: 0 },
              alignment: bodyAlign(theme.body.alignment),
              spacing: bodySpacing(theme.body.spaceBeforePt, theme.body.spaceAfterPt, theme.body.lineSpacing),
              children: makeRuns(item),
            })
          );
        }
        break;
      case "numbered-list":
        for (const item of block.items) {
          out.push(
            new Paragraph({
              numbering: { reference: "kiro-number", level: 0 },
              alignment: bodyAlign(theme.body.alignment),
              spacing: bodySpacing(theme.body.spaceBeforePt, theme.body.spaceAfterPt, theme.body.lineSpacing),
              children: makeRuns(item),
            })
          );
        }
        break;
      case "quote":
        out.push(
          new Paragraph({
            alignment: bodyAlign(theme.quote.alignment),
            spacing: bodySpacing(theme.quote.spaceBeforePt, theme.quote.spaceAfterPt, theme.quote.lineSpacing),
            indent: {
              left: theme.quote.indentLeftTwip,
              right: theme.quote.indentRightTwip,
            },
            children: makeRuns(block.content, { sizePt: theme.quote.fontSizePt }),
          })
        );
        break;
      case "code":
        out.push(
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: bodySpacing(0, 6, theme.code.lineSpacing),
            shading: { fill: theme.code.backgroundFill },
            border: {
              top: { style: BorderStyle.SINGLE, size: 4, color: "E2E2E2" },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: "E2E2E2" },
              left: { style: BorderStyle.SINGLE, size: 4, color: "E2E2E2" },
              right: { style: BorderStyle.SINGLE, size: 4, color: "E2E2E2" },
            },
            children: [
              new TextRun({
                text: block.text,
                font: { ascii: theme.code.font, hAnsi: theme.code.font, eastAsia: theme.code.font },
                size: theme.code.fontSizePt * 2,
              }),
            ],
          })
        );
        break;
      case "page-break":
        out.push(new Paragraph({ children: [new PageBreak()] }));
        break;
      case "table": {
        const allRows = [block.header, ...block.rows];
        const colCount = Math.max(1, ...allRows.map((r) => r.length));
        const widthPct = Math.floor(100 / colCount);
        const rows = allRows.map(
          (row, ri) =>
            new TableRow({
              children: row.map((cell) => {
                const isHeader = ri === 0 && block.header.length > 0;
                return new TableCell({
                  width: { size: widthPct, type: WidthType.PERCENTAGE },
                  shading:
                    isHeader && theme.table.headerShading ? { fill: theme.table.headerShading } : undefined,
                  borders: tableCellBorders(docx, theme, isHeader),
                  // 强 invariant：TableCell children 必须包含 Paragraph（block-level content）
                  children: [
                    new Paragraph({
                      alignment: isHeader ? AlignmentType.CENTER : AlignmentType.LEFT,
                      spacing: bodySpacing(0, 2, 1.2),
                      children: makeRuns(cell, {
                        bold: isHeader ? true : undefined,
                        sizePt: isHeader ? theme.table.headerFontSizePt : theme.table.bodyFontSizePt,
                      }),
                    }),
                  ],
                });
              }),
            })
        );
        out.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: tableBorders(docx, theme),
            rows,
          })
        );
        break;
      }
    }
  }
  return out;
}

function tableBorders(docx: Docx, theme: ResolvedDocumentTheme) {
  const none = { style: docx.BorderStyle.NONE, size: 0, color: "FFFFFF" };
  switch (theme.table.style) {
    case "three-line":
      // 三线表：top / header-bottom（cell 级）/ bottom；无内部竖线
      return {
        top: { style: docx.BorderStyle.SINGLE, size: 12, color: "000000" },
        bottom: { style: docx.BorderStyle.SINGLE, size: 12, color: "000000" },
        left: none,
        right: none,
        insideHorizontal: none,
        insideVertical: none,
      };
    case "grid":
      return {
        top: { style: docx.BorderStyle.SINGLE, size: 4, color: "C9C9C9" },
        bottom: { style: docx.BorderStyle.SINGLE, size: 4, color: "C9C9C9" },
        left: { style: docx.BorderStyle.SINGLE, size: 4, color: "C9C9C9" },
        right: { style: docx.BorderStyle.SINGLE, size: 4, color: "C9C9C9" },
        insideHorizontal: { style: docx.BorderStyle.SINGLE, size: 4, color: "E0E0E0" },
        insideVertical: { style: docx.BorderStyle.SINGLE, size: 4, color: "E0E0E0" },
      };
    default: // clean：顶/底细线 + 内部细横线（表头底纹区分）
      return {
        top: { style: docx.BorderStyle.SINGLE, size: 4, color: "D9D9D9" },
        bottom: { style: docx.BorderStyle.SINGLE, size: 4, color: "D9D9D9" },
        left: none,
        right: none,
        insideHorizontal: { style: docx.BorderStyle.SINGLE, size: 4, color: "E8E8E8" },
        insideVertical: none,
      };
  }
}

function tableCellBorders(docx: Docx, theme: ResolvedDocumentTheme, isHeader: boolean) {
  if (theme.table.style !== "three-line" || !isHeader) return undefined;
  // 三线表：表头行下沿一条细线
  return {
    bottom: { style: docx.BorderStyle.SINGLE, size: 6, color: "000000" },
  };
}
