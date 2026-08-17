/**
 * Kiro DOCX Compatibility Fixture Matrix（V2.4）。
 *
 * 使用生产 renderDocx() 生成确定性 fixture——测试对象 === Kiro 实际生成对象。
 * 输出：.tmp/kiro-docx-compat/*.docx（已 gitignore，不提交二进制）。
 * 运行方式：npm run test:docx:fixtures（vitest runner，解析 @/ 别名；不引入新依赖）。
 */
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { renderDocx } from "@/lib/ai/computer/documents/docx";
import { KiroDocument } from "@/lib/ai/computer/documents/types";

export const DOCX_COMPAT_OUT_DIR = path.resolve(".tmp/kiro-docx-compat");

export interface DocxFixture {
  name: string;
  fileName: string;
  document: KiroDocument;
}

export const DOCX_FIXTURES: DocxFixture[] = [
  {
    name: "01-paragraph",
    fileName: "01-paragraph.docx",
    document: {
      title: "Kiro DOCX Compatibility",
      stylePreset: "business-report",
      blocks: [{ type: "paragraph", content: [{ text: "Hello Word 兼容性测试" }] }],
    },
  },
  {
    name: "02-headings",
    fileName: "02-headings.docx",
    document: {
      title: "标题文档",
      stylePreset: "business-report",
      blocks: [
        { type: "heading", level: 1, content: [{ text: "一级标题" }] },
        { type: "heading", level: 2, content: [{ text: "二级标题" }] },
        { type: "paragraph", content: [{ text: "正文段落。" }] },
      ],
    },
  },
  {
    name: "03-lists",
    fileName: "03-lists.docx",
    document: {
      title: "列表文档",
      stylePreset: "business-report",
      blocks: [
        { type: "bullet-list", items: [[{ text: "项目一" }], [{ text: "项目二" }]] },
        { type: "numbered-list", items: [[{ text: "第一步" }], [{ text: "第二步" }]] },
      ],
    },
  },
  {
    name: "04-table-2x2",
    fileName: "04-table-2x2.docx",
    document: {
      title: "最小表格",
      stylePreset: "business-report",
      blocks: [{ type: "table", header: [[{ text: "A" }], [{ text: "B" }]], rows: [[[{ text: "1" }], [{ text: "2" }]]] }],
    },
  },
  {
    name: "05-schedule",
    fileName: "05-schedule.docx",
    document: {
      title: "本周课表",
      stylePreset: "business-report",
      blocks: [
        {
          type: "table",
          header: [[{ text: "星期" }], [{ text: "课程" }], [{ text: "时间" }], [{ text: "地点" }]],
          rows: [
            [[{ text: "周一" }], [{ text: "数据结构与算法" }], [{ text: "08:00–09:40" }], [{ text: "计算机楼 102" }]],
            [[{ text: "周二" }], [{ text: "概率论与数理统计" }], [{ text: "10:00–11:40" }], [{ text: "教三 305" }]],
            [[{ text: "周三" }], [{ text: "操作系统" }], [{ text: "14:00–15:40" }], [{ text: "计算机楼 208" }]],
            [[{ text: "周四" }], [{ text: "学术英语写作" }], [{ text: "13:00–14:40" }], [{ text: "外语楼 207" }]],
            [[{ text: "周五" }], [{ text: "计算机网络" }], [{ text: "10:00–11:40" }], [{ text: "计算机楼 305" }]],
          ],
        },
      ],
    },
  },
];

/**
 * 用生产 renderDocx 生成全部 fixture（含 control.docx：绕过 Kiro styles 的 docx 官方最小输出，
 * 供 package forensics 对比）。
 */
export async function generateDocxFixtures(outDir: string = DOCX_COMPAT_OUT_DIR): Promise<{ fileName: string; byteLength: number }[]> {
  await mkdir(outDir, { recursive: true });
  const results: { fileName: string; byteLength: number }[] = [];
  for (const fixture of DOCX_FIXTURES) {
    const bytes = await renderDocx(fixture.document);
    await writeFile(path.join(outDir, fixture.fileName), Buffer.from(bytes));
    results.push({ fileName: fixture.fileName, byteLength: bytes.byteLength });
  }
  // control.docx：完全绕过 Kiro styles（同一 docx@9.7.1 + Packer.toArrayBuffer）
  const { Document, Packer, Paragraph } = await import("docx");
  const control = new Document({ sections: [{ children: [new Paragraph("Hello")] }] });
  const controlBytes = new Uint8Array(await Packer.toArrayBuffer(control));
  await writeFile(path.join(outDir, "control.docx"), Buffer.from(controlBytes));
  results.push({ fileName: "control.docx", byteLength: controlBytes.byteLength });
  return results;
}
