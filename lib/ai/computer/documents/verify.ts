import JSZip from "jszip";
import { KiroDocument } from "@/lib/ai/computer/documents/types";
import { ComputerError } from "@/lib/ai/computer/errors";

/**
 * Document Verification（Part 2）：只有验证通过才允许 ok:true。
 * - Markdown：Adapter read-back 与 renderer 输出 exact equal。
 * - DOCX：read bytes → JSZip 可解析 → 必需 entry 存在 → document.xml DOMParser 无错 → WordprocessingML root。
 */

export const DOCX_REQUIRED_ENTRIES = [
  "[Content_Types].xml",
  "_rels/.rels",
  "docProps/core.xml",
  "docProps/app.xml",
  "word/document.xml",
  "word/styles.xml",
  "word/numbering.xml",
  "word/_rels/document.xml.rels",
];

export async function verifyMarkdownWritten(expected: string, readBack: string): Promise<boolean> {
  return readBack === expected;
}

export async function verifyDocxBytes(bytes: Uint8Array): Promise<boolean> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    for (const entry of DOCX_REQUIRED_ENTRIES) {
      if (!zip.file(entry)) return false;
    }
    const documentXml = await zip.file("word/document.xml")?.async("string");
    if (!documentXml) return false;
    if (typeof DOMParser !== "undefined") {
      const parsed = new DOMParser().parseFromString(documentXml, "application/xml");
      if (parsed.querySelector("parsererror")) return false;
      const root = parsed.documentElement;
      if (!root || root.tagName !== "w:document") return false;
    } else {
      // node 环境（测试）：轻量校验根标签
      if (!documentXml.includes("<w:document")) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export interface DocumentInspectFacts {
  format: "markdown" | "docx";
  title?: string;
  headings: number;
  paragraphs: number;
  lists: number;
  tables: number;
  codeBlocks: number;
  characters: number;
}

/** 从已渲染内容统计事实结构（不解析二进制 diff） */
export function inspectDocumentFacts(doc: KiroDocument, format: "markdown" | "docx"): DocumentInspectFacts {
  let headings = 0;
  let paragraphs = 0;
  let lists = 0;
  let tables = 0;
  let codeBlocks = 0;
  let characters = 0;

  const countInline = (inline?: { text: string }[]) => {
    if (!inline) return;
    for (const run of inline) characters += run.text.length;
  };

  for (const block of doc.blocks) {
    switch (block.type) {
      case "heading":
        headings += 1;
        countInline(block.content);
        break;
      case "paragraph":
        paragraphs += 1;
        countInline(block.content);
        break;
      case "bullet-list":
      case "numbered-list":
        lists += 1;
        for (const item of block.items) countInline(item);
        break;
      case "table":
        tables += 1;
        for (const row of [block.header, ...block.rows]) {
          for (const cell of row) countInline(cell);
        }
        break;
      case "quote":
        paragraphs += 1;
        countInline(block.content);
        break;
      case "code":
        codeBlocks += 1;
        characters += block.text.length;
        break;
    }
  }

  return {
    format,
    title: doc.title,
    headings,
    paragraphs,
    lists,
    tables,
    codeBlocks,
    characters,
  };
}
