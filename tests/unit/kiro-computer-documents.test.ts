import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { KiroDocument } from "@/lib/ai/computer/documents/types";
import { renderMarkdown } from "@/lib/ai/computer/documents/markdown";
import { renderDocx } from "@/lib/ai/computer/documents/docx";
import { verifyMarkdownWritten, verifyDocxBytes, verifyRenderedDocx, inspectDocumentFacts, DOCX_REQUIRED_ENTRIES } from "@/lib/ai/computer/documents/verify";
import { isKiroDocument } from "@/lib/ai/computer/documents/types";
import { ComputerError } from "@/lib/ai/computer/errors";
import {
  normalizeDocumentForRender,
  sanitizeOpenXmlText,
  tableColumnCount,
} from "@/lib/ai/computer/documents/render-normalize";
import { distributeTwip } from "@/lib/ai/computer/documents/docx";

const doc: KiroDocument = {
  title: "研究方案",
  blocks: [
    { type: "heading", level: 1, content: [{ text: "引言" }] },
    { type: "paragraph", content: [{ text: "这是" }, { text: "重点", bold: true }] },
    { type: "bullet-list", items: [[{ text: "项目一" }], [{ text: "项目二" }]] },
    { type: "numbered-list", items: [[{ text: "第一步" }]] },
    { type: "quote", content: [{ text: "引用内容" }] },
    { type: "code", language: "ts", text: "const a = 1;" },
    { type: "table", header: [[{ text: "名称" }], [{ text: "值" }]], rows: [[[{ text: "A" }], [{ text: "1" }]]] },
    { type: "page-break" },
  ],
};

describe("document IR validation", () => {
  it("合法 IR 通过；非法 block 类型拒绝", () => {
    expect(isKiroDocument(doc)).toBe(true);
    expect(isKiroDocument({ blocks: [{ type: "script", content: [] }] })).toBe(false);
    expect(isKiroDocument({ title: "x" })).toBe(false);
  });
});

describe("markdown render + verify", () => {
  it("确定性输出且表内 | 转义", () => {
    const md = renderMarkdown(doc);
    expect(md).toContain("# 研究方案");
    expect(md).toContain("# 引言");
    expect(md).toContain("**重点**");
    expect(md).toContain("- 项目一");
    expect(md).toContain("> 引用内容");
    expect(md).toContain("```ts");
    expect(md).toContain("---");
    const tableDoc: KiroDocument = {
      blocks: [{ type: "table", header: [[{ text: "a|b" }]], rows: [] }],
    };
    expect(renderMarkdown(tableDoc)).toContain("a\\|b");
  });

  it("verifyMarkdownWritten exact equal", async () => {
    const md = renderMarkdown(doc);
    expect(await verifyMarkdownWritten(md, md)).toBe(true);
    expect(await verifyMarkdownWritten(md, md + "extra")).toBe(false);
  });
});

describe("docx render + verify", () => {
  it("生成合法 DOCX package（必需 entry + XML 可解析）", async () => {
    const bytes = await renderDocx(doc);
    expect(bytes.length).toBeGreaterThan(100);
    const ok = await verifyDocxBytes(bytes);
    expect(ok).toBe(true);
  });

  it("必需 entry 列表完整（core package parts；numbering 存在时才验证）", () => {
    expect(DOCX_REQUIRED_ENTRIES).toContain("[Content_Types].xml");
    expect(DOCX_REQUIRED_ENTRIES).toContain("_rels/.rels");
    expect(DOCX_REQUIRED_ENTRIES).toContain("word/document.xml");
    expect(DOCX_REQUIRED_ENTRIES).toContain("word/styles.xml");
    expect(DOCX_REQUIRED_ENTRIES).toContain("word/_rels/document.xml.rels");
    // numbering.xml 是条件 part：存在时必须可解析（由 verifier 全量 XML 校验覆盖）
  });

  it("损坏字节 verify 失败", async () => {
    expect(await verifyDocxBytes(new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it("XML 文本全部转义（& < > 不进 raw XML）", async () => {
    const evil: KiroDocument = {
      blocks: [
        { type: "paragraph", content: [{ text: "a <b>& \"c\"" }] },
      ],
    };
    const bytes = await renderDocx(evil);
    const ok = await verifyDocxBytes(bytes);
    expect(ok).toBe(true);
    expect(await renderDocx(evil)).toBeInstanceOf(Uint8Array);
  });
});

describe("DOCX structure regressions（Document Engine V2）", () => {
  it("每个 w:tc 至少包含一个 w:p（TableCell 内容必须是 block-level document content）", async () => {
    const bytes = await renderDocx(doc);
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("word/document.xml")?.async("string");
    expect(xml).toBeDefined();
    const tcRe = /<w:tc>([\s\S]*?)<\/w:tc>/g;
    let m: RegExpExecArray | null;
    let cellCount = 0;
    while ((m = tcRe.exec(xml!))) {
      cellCount += 1;
      expect(m[1]).toContain("<w:p");
    }
    expect(cellCount).toBeGreaterThan(0);
  });

  it("verifier 必须拒绝 malformed styles.xml（不能只 parse word/document.xml）", async () => {
    const bytes = await renderDocx(doc);
    const zip = await JSZip.loadAsync(bytes);
    // 用截断 + 未闭合的 styles.xml 替换（Word 无法读取的 package）
    const broken = new TextEncoder().encode(
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph"'
    );
    zip.file("word/styles.xml", broken);
    const repacked = await zip.generateAsync({ type: "uint8array" });
    expect(await verifyDocxBytes(new Uint8Array(repacked))).toBe(false);
  });

  it("verifier 必须拒绝 malformed numbering.xml（存在时必须可解析）", async () => {
    const bytes = await renderDocx(doc);
    const zip = await JSZip.loadAsync(bytes);
    const broken = new TextEncoder().encode("<w:numbering><w:abstractNum");
    zip.file("word/numbering.xml", broken);
    const repacked = await zip.generateAsync({ type: "uint8array" });
    expect(await verifyDocxBytes(new Uint8Array(repacked))).toBe(false);
  });
});

describe("inspect facts", () => {
  it("统计结构事实", () => {
    const facts = inspectDocumentFacts(doc, "markdown");
    expect(facts.headings).toBe(1);
    expect(facts.paragraphs).toBe(2); // paragraph + quote
    expect(facts.lists).toBe(2);
    expect(facts.tables).toBe(1);
    expect(facts.codeBlocks).toBe(1);
    expect(facts.characters).toBeGreaterThan(0);
    expect(facts.title).toBe("研究方案");
  });
});

describe("docx renderer error", () => {
  it("非法 IR 由 schema 层拒绝（renderer 只接受验证后的结构）", () => {
    // isKiroDocument 已过滤非法结构
    expect(isKiroDocument({ blocks: [{ type: "heading", level: 5 }] })).toBe(false);
  });
});

// ==================== V2.2：Word Compatibility Matrix（runtime integrity） ====================

const FIXTURE_01: KiroDocument = {
  title: "标题",
  blocks: [{ type: "paragraph", content: [{ text: "这是正文段落。" }] }],
};

const FIXTURE_02: KiroDocument = {
  title: "列表文档",
  blocks: [
    { type: "bullet-list", items: [[{ text: "项目一" }], [{ text: "项目二" }]] },
    { type: "numbered-list", items: [[{ text: "第一步" }], [{ text: "第二步" }]] },
  ],
};

const FIXTURE_03: KiroDocument = {
  title: "简单表格",
  blocks: [{ type: "table", header: [[{ text: "a" }], [{ text: "b" }]], rows: [[[{ text: "1" }], [{ text: "2" }]]] }],
};

const FIXTURE_04: KiroDocument = {
  title: "本周课程表",
  stylePreset: "business-report",
  blocks: [
    {
      type: "table",
      header: [[{ text: "星期" }], [{ text: "课程" }], [{ text: "时间" }], [{ text: "地点" }]],
      rows: [
        [[{ text: "周一" }], [{ text: "数据结构与算法" }], [{ text: "08:00–09:40" }], [{ text: "计算机楼 102" }]],
        [[{ text: "周二" }], [{ text: "概率论与数理统计" }], [{ text: "10:00–11:40" }], [{ text: "教三 305" }]],
        [[{ text: "周三" }], [{ text: "操作系统" }], [{ text: "14:00–15:40" }], [{ text: "计算机楼 201" }]],
        [[{ text: "周四" }], [{ text: "数据库系统" }], [{ text: "09:00–10:40" }], [{ text: "教二 401" }]],
        [[{ text: "周五" }], [{ text: "软件工程" }], [{ text: "13:00–14:40" }], [{ text: "教一 105" }]],
      ],
    },
  ],
};

describe("V2.2 compatibility matrix fixtures（01–04）", () => {
  for (const [name, fixture] of [
    ["01-paragraph", FIXTURE_01],
    ["02-list", FIXTURE_02],
    ["03-table-simple", FIXTURE_03],
    ["04-table-schedule", FIXTURE_04],
  ] as const) {
    it(`${name}：verifyDocxBytes + verifyRenderedDocx 通过`, async () => {
      const bytes = await renderDocx(fixture);
      expect(bytes.byteLength).toBeGreaterThan(0);
      expect(await verifyDocxBytes(bytes)).toBe(true);
      expect(await verifyRenderedDocx(bytes, fixture)).toBe(true);
    });
  }

  it("04 课表渲染：每个 w:tc 含 w:p；无百分比 table width；tblGrid 列数与 header 一致", async () => {
    const bytes = await renderDocx(FIXTURE_04);
    const zip = await JSZip.loadAsync(bytes);
    const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
    // w:tc 必须含 w:p
    const tcRe = /<w:tc>([\s\S]*?)<\/w:tc>/g;
    let m: RegExpExecArray | null;
    let cellCount = 0;
    while ((m = tcRe.exec(xml))) {
      cellCount += 1;
      expect(m[1]).toContain("<w:p");
    }
    expect(cellCount).toBeGreaterThanOrEqual(12); // 4 列 × (1 header + 5 rows)
    // 不再有百分比 table width（固定 DXA grid）
    expect(xml).not.toContain('w:w="100" w:type="pct"');
    expect(xml).not.toContain('w:type="pct"');
    // tblGrid：gridCol 数量 = 4
    const gridCols = xml.match(/<w:gridCol[^>]*>/g) ?? [];
    expect(gridCols.length).toBe(4);
  });
});

describe("V2.2 render normalization", () => {
  it("table 矩形化：混合列数补齐为 columnCount，缺失 cell 用空文本", () => {
    const ragged: KiroDocument = {
      blocks: [
        {
          type: "table",
          header: [[{ text: "h1" }], [{ text: "h2" }], [{ text: "h3" }], [{ text: "h4" }]],
          rows: [
            [[{ text: "r1c1" }], [{ text: "r1c2" }], [{ text: "r1c3" }]],
            [[{ text: "r2c1" }], [{ text: "r2c2" }], [{ text: "r2c3" }], [{ text: "r2c4" }], [{ text: "r2c5" }]],
          ],
        },
      ],
    };
    const normalized = normalizeDocumentForRender(ragged);
    const table = normalized.blocks[0];
    expect(table.type).toBe("table");
    if (table.type !== "table") return;
    expect(tableColumnCount(table)).toBe(5);
    expect(table.header.length).toBe(5);
    expect(table.header[4]).toEqual([{ text: "" }]);
    expect(table.rows[0].length).toBe(5);
    expect(table.rows[0][3]).toEqual([{ text: "" }]);
    expect(table.rows[1].length).toBe(5);
    // Source IR 不被修改
    const originalTable = ragged.blocks[0];
    expect(originalTable.type === "table" && originalTable.rows[0].length).toBe(3);
  });

  it("distributeTwip：sum(columnWidths) === printableWidth；余数给前 N 列", () => {
    const widths = distributeTwip(10100, 4);
    expect(widths.length).toBe(4);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(10100);
    const widths2 = distributeTwip(10001, 3);
    expect(widths2.reduce((a, b) => a + b, 0)).toBe(10001);
  });

  it("sanitizeOpenXmlText：移除 XML 1.0 非法 control chars，保留 \\t \\n \\r / 中文 / emoji", () => {
    expect(sanitizeOpenXmlText("a\u0000b\u0007c\u000Bd\u001Fe")).toBe("abcde");
    expect(sanitizeOpenXmlText("保留\t换行\n回车\r中文🎉")).toBe("保留\t换行\n回车\r中文🎉");
  });
});
