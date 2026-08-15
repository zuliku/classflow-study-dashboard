/**
 * Local Document Search Primitives（V1.4）：
 * LOCAL / DETERMINISTIC / LEXICAL / ON-DEMAND。绝不引入 Embeddings / Vector DB / 第三方搜索库。
 *
 * - normalizeLocalSearchText：NFKC + lowercase Latin + collapse whitespace
 * - query：保留 normalized full phrase，并切成最多 MAX_LOCAL_SEARCH_TERMS 个 terms
 * - scoring（deterministic）：exact phrase 最高 → term 命中数 → 出现次数
 * - searchPdfText：逐页 getTextContent → 搜索当前页 → 只保留 top-N candidates → page.cleanup()，
 *   内存不随 pageCount 线性增长；绝不提前 break（后部可能有更好的 exact match）
 * - extractPdfPagesText：PDF 定向页正文（read_project_file(pages) 用；绝不调用 extractPdf 前缀截断）
 */
import { loadPdfJs } from "@/lib/ai/attachments/pdf";
import {
  MAX_PROJECT_SEARCH_SNIPPET_CHARS,
  MAX_PROJECT_SEARCH_RESULTS,
  MAX_PROJECT_SEARCH_TOTAL_CHARS,
} from "@/lib/ai/attachments/limits";

/** 最多切分 terms（防止 query 过长导致扫描成本失控） */
export const MAX_LOCAL_SEARCH_TERMS = 8;

// ---------- normalize / tokenize ----------

/** 纯函数：NFKC + Latin lowercase + collapse whitespace（中文 substring 天然保留） */
export function normalizeLocalSearchText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** 术语切分（ES5 兼容：无 Unicode property escapes）：按空白切分后剥除首尾非字母数字字符（含 CJK） */
function isAlnumChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    (code >= 0x00c0 && code <= 0x024f) || // Latin 扩展
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一汉字
    (code >= 0x3400 && code <= 0x4dbf) // CJK 扩展 A
  );
}

/** query → { phrase, terms }：完整短语（normalized）+ 最多 8 个 terms（按空白/标点切分） */
export function tokenizeLocalSearchQuery(query: string): { phrase: string; terms: string[] } {
  const phrase = normalizeLocalSearchText(query);
  const terms = phrase
    .split(/\s+/)
    .map((t) => {
      let start = 0;
      let end = t.length;
      while (start < end && !isAlnumChar(t[start])) start++;
      while (end > start && !isAlnumChar(t[end - 1])) end--;
      return t.slice(start, end);
    })
    .filter((t) => t.length > 0)
    .slice(0, MAX_LOCAL_SEARCH_TERMS);
  return { phrase, terms };
}

// ---------- scoring（deterministic；无第三方库） ----------

export interface LocalSearchMatch {
  /** 命中位置（normalized 文本中的字符偏移；snippet 定位用） */
  index: number;
  /** 命中强度分：exact phrase=1000；否则 term 命中数 * 100 + 出现次数 */
  score: number;
  /** normalized 文本中该命中点的上下文（snippet 由调用方生成） */
  matchLength: number;
}

/** 在 normalized 文本中找全部命中点；scoring 后返回 deterministic 排序 */
export function scoreLocalSearch(text: string, query: { phrase: string; terms: string[] }): LocalSearchMatch[] {
  if (!text) return [];
  const hits: LocalSearchMatch[] = [];
  // 1. exact phrase（最高优先级；中文整句 substring 即为有效 exact phrase）
  if (query.phrase.length > 0) {
    let idx = 0;
    while (idx < text.length) {
      const found = text.indexOf(query.phrase, idx);
      if (found === -1) break;
      hits.push({ index: found, score: 1000 + countOccurrences(text, query.phrase), matchLength: query.phrase.length });
      idx = found + query.phrase.length;
    }
  }
  // 2. terms（phrase 命中位置跳过；term 数越多分越高，其次出现次数）
  if (query.terms.length > 0) {
    const termHits: Map<number, { terms: Set<string>; count: number; length: number }> = new Map();
    for (const term of query.terms) {
      if (term.length === 0 || (query.phrase.includes(term) && term.length > 1 && query.phrase.length > 1)) continue;
      let idx = 0;
      while (idx < text.length) {
        const found = text.indexOf(term, idx);
        if (found === -1) break;
        const existing = termHits.get(found);
        if (existing) {
          existing.terms.add(term);
          existing.count += 1;
        } else {
          termHits.set(found, { terms: new Set([term]), count: 1, length: term.length });
        }
        idx = found + term.length;
      }
    }
    for (const entry of Array.from(termHits.entries())) {
      const [index, info] = entry;
      hits.push({ index, score: info.terms.size * 100 + info.count, matchLength: info.length });
    }
  }
  // deterministic：score 降序 → index 升序
  return hits.sort((a, b) => b.score - a.score || a.index - b.index);
}

function countOccurrences(text: string, sub: string): number {
  let count = 0;
  let idx = 0;
  while (idx < text.length) {
    const found = text.indexOf(sub, idx);
    if (found === -1) break;
    count += 1;
    idx = found + sub.length;
  }
  return count;
}

// ---------- snippet ----------

/** 围绕命中位置的 bounded snippet（前 ~1/3 + 匹配区 + 后 ~2/3；总长 ≤ snippetChars） */
export function buildLocalSearchSnippet(text: string, match: LocalSearchMatch, snippetChars = MAX_PROJECT_SEARCH_SNIPPET_CHARS): string {
  const total = Math.max(1, snippetChars);
  const before = Math.floor(total / 3);
  const after = total - before;
  let start = Math.max(0, match.index - before);
  let end = Math.min(text.length, match.index + match.matchLength + after);
  // 允许片段向前扩展到句子边界（. ！？；\n）
  const sentenceBreak = text.lastIndexOf("\n", match.index);
  if (sentenceBreak > start && sentenceBreak < match.index) start = sentenceBreak + 1;
  const snippet = text.slice(start, end);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${snippet}${suffix}`.slice(0, total);
}

// ---------- 纯文本搜索（TXT/MD/DOCX raw text） ----------

export interface LocalTextSearchResult {
  matches: { index: number; text: string }[];
  /** 原始（未按 maxResults/预算裁剪前的）匹配总数 */
  matchCount: number;
  /** 存在更多匹配但未全部返回（maxResults / total chars budget） */
  truncated: boolean;
}

/** 全文词法搜索（纯函数；bounded output） */
export function searchLocalText(
  rawText: string,
  query: string,
  options?: { maxResults?: number; snippetChars?: number; totalChars?: number }
): LocalTextSearchResult {
  const maxResults = Math.max(1, Math.min(options?.maxResults ?? MAX_PROJECT_SEARCH_RESULTS, MAX_PROJECT_SEARCH_RESULTS));
  const snippetChars = options?.snippetChars ?? MAX_PROJECT_SEARCH_SNIPPET_CHARS;
  const totalChars = Math.max(1, options?.totalChars ?? MAX_PROJECT_SEARCH_TOTAL_CHARS);
  const normalized = normalizeLocalSearchText(rawText);
  const scored = scoreLocalSearch(normalized, tokenizeLocalSearchQuery(query));
  const matchCount = scored.length;
  const matches: { index: number; text: string }[] = [];
  let used = 0;
  for (const m of scored.slice(0, maxResults)) {
    const snippet = buildLocalSearchSnippet(normalized, m, snippetChars);
    if (used + snippet.length > totalChars) break;
    matches.push({ index: m.index, text: snippet });
    used += snippet.length;
  }
  return { matches, matchCount, truncated: matches.length < matchCount };
}

// ---------- PDF 全文搜索（bounded memory；绕过 100k prefix cache） ----------

export interface PdfSearchMatch {
  page: number;
  text: string;
}

export interface PdfSearchResult {
  matches: PdfSearchMatch[];
  matchCount: number;
  truncated: boolean;
}

interface PdfPageCandidate {
  page: number;
  score: number;
  normalizedText: string;
  match: LocalSearchMatch;
}

/** 全页扫描：逐页搜索，保留 top-N candidates（不提前 break；内存只随 N 增长） */
export async function searchPdfText(
  file: Blob,
  query: string,
  options?: { maxResults?: number; snippetChars?: number; totalChars?: number }
): Promise<PdfSearchResult> {
  const maxResults = Math.max(1, Math.min(options?.maxResults ?? MAX_PROJECT_SEARCH_RESULTS, MAX_PROJECT_SEARCH_RESULTS));
  const snippetChars = options?.snippetChars ?? MAX_PROJECT_SEARCH_SNIPPET_CHARS;
  const totalChars = Math.max(1, options?.totalChars ?? MAX_PROJECT_SEARCH_TOTAL_CHARS);
  const q = tokenizeLocalSearchQuery(query);
  if (!q.phrase) return { matches: [], matchCount: 0, truncated: false };

  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const fontDir = "node_modules/pdfjs-dist/standard_fonts/";
  const nodeInit = typeof window === "undefined" ? { standardFontDataUrl: new URL(`${fontDir}`, import.meta.url).toString() } : {};
  const doc = await pdfjs.getDocument({ data, ...nodeInit }).promise;

  const topCandidates: PdfPageCandidate[] = [];
  let totalMatchCount = 0;
  const pushCandidate = (c: PdfPageCandidate) => {
    topCandidates.push(c);
    topCandidates.sort((a, b) => b.score - a.score || a.page - b.page);
    if (topCandidates.length > maxResults) topCandidates.pop();
  };
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      let pageText = "";
      try {
        const content = await page.getTextContent();
        pageText = content.items
          .map((item) => ("str" in item ? (item as { str: string }).str : ""))
          .join(" ")
          .replace(/\s+/g, " ");
      } finally {
        page.cleanup();
      }
      const normalized = normalizeLocalSearchText(pageText);
      if (!normalized) continue;
      const scored = scoreLocalSearch(normalized, q);
      if (scored.length === 0) continue;
      totalMatchCount += scored.length;
      // 每页只取最佳命中进入候选池（页面级 Evidence 粒度）
      pushCandidate({ page: i, score: scored[0].score, normalizedText: normalized, match: scored[0] });
    }
  } finally {
    const cleanup = (doc as unknown as { destroy?: () => Promise<void> }).destroy;
    if (cleanup) await cleanup();
  }

  // 按候选生成 bounded snippets（受 maxResults + total chars 双预算）
  const matches: PdfSearchMatch[] = [];
  let used = 0;
  for (const c of topCandidates) {
    const snippet = buildLocalSearchSnippet(c.normalizedText, c.match, snippetChars);
    if (used + snippet.length > totalChars) break;
    matches.push({ page: c.page, text: snippet });
    used += snippet.length;
  }
  return { matches, matchCount: totalMatchCount, truncated: matches.length < topCandidates.length || matches.length < totalMatchCount };
}

// ---------- PDF 定向页正文（read_project_file(pages)） ----------

export interface PdfPageTextResult {
  page: number;
  text: string;
}

/** 只读取明确页面（dedupe/sort 由调用方 canonicalize）；越界页标记 invalid（不 getPage，不抛错）；
 * 不写入任何 extraction cache；绝不调用 extractPdf */
export async function extractPdfPagesText(
  file: Blob,
  pageNumbers: number[]
): Promise<{ numPages: number; pages: PdfPageTextResult[]; invalid: number[] }> {
  if (pageNumbers.length === 0) return { numPages: 0, pages: [], invalid: [] };
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const fontDir = "node_modules/pdfjs-dist/standard_fonts/";
  const nodeInit = typeof window === "undefined" ? { standardFontDataUrl: new URL(`${fontDir}`, import.meta.url).toString() } : {};
  const doc = await pdfjs.getDocument({ data, ...nodeInit }).promise;
  try {
    const numPages = doc.numPages;
    const pages: PdfPageTextResult[] = [];
    const invalid: number[] = [];
    for (const pageNum of pageNumbers) {
      if (pageNum < 1 || pageNum > numPages) {
        invalid.push(pageNum);
        continue;
      }
      const page = await doc.getPage(pageNum);
      let text = "";
      try {
        const content = await page.getTextContent();
        text = content.items
          .map((item) => ("str" in item ? (item as { str: string }).str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
      } finally {
        page.cleanup();
      }
      pages.push({ page: pageNum, text });
    }
    return { numPages, pages, invalid };
  } finally {
    const cleanup = (doc as unknown as { destroy?: () => Promise<void> }).destroy;
    if (cleanup) await cleanup();
  }
}

