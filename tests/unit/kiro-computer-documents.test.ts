import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
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
