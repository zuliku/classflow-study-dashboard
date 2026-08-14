import JSZip from "jszip";
import { KiroDocument, KiroInline } from "@/lib/ai/computer/documents/types";
import { ComputerError } from "@/lib/ai/computer/errors";

/**
 * Document Verification（Document Engine V2 / V2.2）。
 * 这是 runtime integrity verification（ZIP / required parts / XML parse / Mammoth round-trip），
 * 不是 Microsoft Word compatibility verification（那需要微软官方 OpenXmlValidator，
 * 见 dev-only compatibility gate）。
 * - Markdown：Adapter read-back 与 renderer 输出 exact equal。
 * - DOCX：JSZip 可解析 → 必需 entry 存在 → **所有** XML part 都可解析
 *   （不只是 word/document.xml）→ WordprocessingML root。
 *   「document.xml 能解析」≠「DOCX package 可被 Word 正确读取」：
 *   styles.xml / numbering.xml（存在时）等任何 malformed part 都必须拒绝。
 * - verifyRenderedDocx：package 有效 + Mammoth raw-text round-trip 与 Source IR 的
 *   bounded semantic read-back 一致（bounded：≤20 个 segment、每个 ≤160 chars）。
 */

export const DOCX_REQUIRED_ENTRIES = [
  "[Content_Types].xml",
  "_rels/.rels",
  "word/document.xml",
  "word/styles.xml",
  "word/_rels/document.xml.rels",
];

export async function verifyMarkdownWritten(expected: string, readBack: string): Promise<boolean> {
  return readBack === expected;
}

/**
 * 浏览器 runtime：原生 DOMParser（parsererror = false）。
 * Node 测试环境：轻量 well-formedness 校验（不引入 jsdom / 不增加客户端 bundle）。
 */
function isXmlWellFormed(xml: string): boolean {
  if (typeof DOMParser !== "undefined") {
    const parsed = new DOMParser().parseFromString(xml, "application/xml");
    return !parsed.querySelector("parsererror");
  }
  // node fallback：prolog / 注释 / CDATA 剥离后做 tag 平衡扫描
  let s = xml;
  s = s.replace(/^\s*<\?xml[^?]*\?>/i, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const stack: string[] = [];
  const tagRe = /<(\/?)([A-Za-z_:][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = tagRe.exec(s))) {
    if (/[<>]/.test(s.slice(last, m.index))) return false;
    last = tagRe.lastIndex;
    const close = m[1];
    const name = m[2];
    const selfClose = m[4];
    if (close) {
      if (stack.pop() !== name) return false;
    } else if (!selfClose) {
      stack.push(name);
    }
  }
  if (/[<>]/.test(s.slice(last))) return false;
  return stack.length === 0;
}

export async function verifyDocxBytes(bytes: Uint8Array): Promise<boolean> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    for (const entry of DOCX_REQUIRED_ENTRIES) {
      if (!zip.file(entry)) return false;
    }
    // 所有 XML / RELS part 都必须可解析（存在即验证；缺失由 REQUIRED 检查兜底）
    const entries = Object.values(zip.files);
    for (const entry of entries) {
      if (entry.dir) continue;
      const name = entry.name;
      if (!name.endsWith(".xml") && !name.endsWith(".rels") && name !== "[Content_Types].xml") continue;
      const text = await entry.async("string");
      if (!isXmlWellFormed(text)) return false;
    }
    const documentXml = await zip.file("word/document.xml")?.async("string");
    if (!documentXml) return false;
    if (typeof DOMParser !== "undefined") {
      const parsed = new DOMParser().parseFromString(documentXml, "application/xml");
      if (parsed.querySelector("parsererror")) return false;
      const root = parsed.documentElement;
      if (!root || root.tagName !== "w:document") return false;
    } else if (!documentXml.includes("<w:document")) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** 把 KiroDocument 正文按顺序收集为 plain-text segments（title + 各 block） */
export function collectDocumentPlainText(doc: KiroDocument): string[] {
  const segments: string[] = [];
  const inlineText = (inline: KiroInline[] | undefined): string =>
    (inline ?? []).map((r) => r.text).join("");
  if (doc.title && doc.title.trim()) segments.push(doc.title);
  for (const block of doc.blocks) {
    switch (block.type) {
      case "heading":
        pushNonEmpty(segments, inlineText(block.content));
        break;
      case "paragraph":
        pushNonEmpty(segments, inlineText(block.content));
        break;
      case "bullet-list":
      case "numbered-list":
        for (const item of block.items) pushNonEmpty(segments, inlineText(item));
        break;
      case "quote":
        pushNonEmpty(segments, inlineText(block.content));
        break;
      case "code":
        pushNonEmpty(segments, block.text);
        break;
      case "table":
        for (const row of [block.header, ...block.rows]) {
          for (const cell of row) pushNonEmpty(segments, inlineText(cell));
        }
        break;
      case "page-break":
        break;
    }
  }
  return segments;
}

function pushNonEmpty(segments: string[], text: string): void {
  const trimmed = text.trim();
  if (trimmed) segments.push(trimmed);
}

/** 归一化空白（collapse），用于两边对比 */
function normalizeForCompare(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export const VERIFY_READBACK_MAX_SEGMENTS = 20;
export const VERIFY_READBACK_MAX_SEGMENT_CHARS = 160;

/**
 * 强化验证：package 有效 + Mammoth raw-text round-trip 与 Source IR 做 bounded semantic read-back。
 * 不要求二进制 exact match；只验证若干前部非空 text segment 出现在生成文档提取文本中。
 * 浏览器 / Node 环境自适应（浏览器无 Buffer；与 attachments/docx.ts 同一约定）。
 */
export async function verifyRenderedDocx(bytes: Uint8Array, source: KiroDocument): Promise<boolean> {
  if (!(await verifyDocxBytes(bytes))) return false;
  try {
    const mammoth = await import("mammoth");
    const options =
      typeof window === "undefined"
        ? { buffer: Buffer.from(bytes) }
        : { arrayBuffer: bytes.slice().buffer as ArrayBuffer };
    const result = await mammoth.extractRawText(options);
    const extracted = normalizeForCompare(result.value ?? "");
    if (!extracted) return false;
    const segments = collectDocumentPlainText(source);
    let checked = 0;
    for (const segment of segments) {
      if (checked >= VERIFY_READBACK_MAX_SEGMENTS) break;
      const capped = normalizeForCompare(segment).slice(0, VERIFY_READBACK_MAX_SEGMENT_CHARS);
      if (!capped) continue;
      checked += 1;
      if (!extracted.includes(capped)) return false;
    }
    return checked > 0;
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
