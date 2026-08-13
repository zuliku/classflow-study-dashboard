import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { KiroDocument } from "@/lib/ai/computer/documents/types";
import { renderMarkdown } from "@/lib/ai/computer/documents/markdown";
import { renderDocx } from "@/lib/ai/computer/documents/docx";
import { verifyMarkdownWritten, verifyDocxBytes, inspectDocumentFacts, DOCX_REQUIRED_ENTRIES } from "@/lib/ai/computer/documents/verify";
import { isKiroDocument } from "@/lib/ai/computer/documents/types";
import { ComputerError } from "@/lib/ai/computer/errors";

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

  it("必需 entry 列表完整", () => {
    expect(DOCX_REQUIRED_ENTRIES).toContain("[Content_Types].xml");
    expect(DOCX_REQUIRED_ENTRIES).toContain("word/document.xml");
    expect(DOCX_REQUIRED_ENTRIES).toContain("word/styles.xml");
    expect(DOCX_REQUIRED_ENTRIES).toContain("word/numbering.xml");
    expect(DOCX_REQUIRED_ENTRIES).toContain("word/_rels/document.xml.rels");
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
