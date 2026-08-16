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
import { loadPdfJs, classifyPdfTextLayer } from "@/lib/ai/attachments/pdf";
import {
  MAX_PROJECT_SEARCH_SNIPPET_CHARS,
  MAX_PROJECT_SEARCH_RESULTS,
  MAX_PROJECT_SEARCH_TOTAL_CHARS,
} from "@/lib/ai/attachments/limits";

/** 最多切分 terms（防止 query 过长导致扫描成本失控） */
export const MAX_LOCAL_SEARCH_TERMS = 8;

// ---------- normalize / offset mapping（SEARCH VIEW 单一事实来源，V1.4.3） ----------

/** normalized checkpoint 间隔：offset remap 只从最近 checkpoint 局部重扫（避免 dense per-char map） */
export const NORMALIZED_SEARCH_CHECKPOINT_INTERVAL = 512;

export interface NormalizedCheckpoint {
  /** 该 checkpoint 对应 normalized 文本的第几个字符 */
  normOffset: number;
  /** 对应 source 偏移（下一个待处理 code point 的位置） */
  sourceOffset: number;
  /** 是否已 emit 过非空白字符（trim-start 状态） */
  started: boolean;
  /** 上一个 emit 的 normalized 字符是否为 collapse 后的空格 */
  prevWasWs: boolean;
}

export interface NormalizedSourceView {
  normalized: string;
  /** source 原文（remap 与 snippet 用；buildNormalizedSourceView 持有引用，不复制） */
  source: string;
  /** 稀疏 checkpoints：mapping 用（不做 dense per-char 索引） */
  checkpoints: NormalizedCheckpoint[];
}

/** 单字符 normalize（code point 安全）：NFKC + lowercase；返回 normalized 结果与 source 消耗长度 */
function normalizeOneChar(source: string, sourcePos: number): { char: string; sourceEnd: number } {
  const cp = source.codePointAt(sourcePos);
  if (cp === undefined) return { char: "", sourceEnd: sourcePos };
  const raw = String.fromCodePoint(cp);
  return { char: raw.normalize("NFKC").toLowerCase(), sourceEnd: sourcePos + raw.length };
}

function isSpaceChar(ch: string): boolean {
  return /\s/.test(ch);
}

/**
 * 构建 SEARCH VIEW（唯一 normalize 实现；normalizeLocalSearchText 与其共用）：
 * NFKC + lowercase + collapse whitespace + trim，同时记录稀疏 checkpoints 供 source remap。
 * 复杂度 O(n)；内存 O(n / interval)（20MiB 文本 ≈ 4 万 checkpoint，瞬态）。
 */
export function buildNormalizedSourceView(source: string): NormalizedSourceView {
  const normalized: string[] = [];
  const checkpoints: NormalizedCheckpoint[] = [];
  let normOffset = 0;
  let srcPos = 0;
  let started = false;
  let prevWasWs = false;
  checkpoints.push({ normOffset: 0, sourceOffset: 0, started: false, prevWasWs: false });
  while (srcPos < source.length) {
    const { char, sourceEnd } = normalizeOneChar(source, srcPos);
    srcPos = sourceEnd;
    if (isSpaceChar(char)) {
      if (started && !prevWasWs) {
        normalized.push(" ");
        prevWasWs = true;
        normOffset++;
        if (normOffset % NORMALIZED_SEARCH_CHECKPOINT_INTERVAL === 0) {
          checkpoints.push({ normOffset, sourceOffset: srcPos, started, prevWasWs });
        }
      }
      continue;
    }
    normalized.push(char);
    started = true;
    prevWasWs = false;
    normOffset++;
    if (normOffset % NORMALIZED_SEARCH_CHECKPOINT_INTERVAL === 0) {
      checkpoints.push({ normOffset, sourceOffset: srcPos, started, prevWasWs });
    }
  }
  const joined = normalized.join("");
  // trim-end：末尾 collapse 出的空格不保留（与既有 normalizeLocalSearchText 语义一致）
  const finalText = joined.endsWith(" ") ? joined.slice(0, -1) : joined;
  return { normalized: finalText, source, checkpoints };
}

/** 纯函数：NFKC + Latin lowercase + collapse whitespace（SEARCH VIEW；由 buildNormalizedSourceView 实现） */
export function normalizeLocalSearchText(text: string): string {
  return buildNormalizedSourceView(text).normalized;
}

/**
 * normalized offset → source offset（仅对少量目标调用）。
 * 从最近 checkpoint 局部重扫（≤ interval 长度），不重新扫描全文：
 * 复杂度 O(interval × targets)，与 normalizeLocalSearchText 共用同一规则（单一事实来源）。
 */
export function mapNormalizedOffsetToSource(view: NormalizedSourceView, normOffset: number): number {
  if (normOffset <= 0) return view.checkpoints[0].sourceOffset;
  if (normOffset >= view.normalized.length) return view.source.length;
  // binary search：最近 checkpoint（≤ normOffset）
  const cks = view.checkpoints;
  let lo = 0;
  let hi = cks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cks[mid].normOffset <= normOffset) lo = mid + 1;
    else hi = mid;
  }
  const ck = cks[lo - 1];
  let emitted = ck.normOffset;
  let srcPos = ck.sourceOffset;
  let started = ck.started;
  let prevWasWs = ck.prevWasWs;
  while (srcPos < view.source.length && emitted <= normOffset) {
    const charStart = srcPos;
    const { char, sourceEnd } = normalizeOneChar(view.source, srcPos);
    srcPos = sourceEnd;
    if (isSpaceChar(char)) {
      if (started && !prevWasWs) {
        if (emitted === normOffset) return charStart;
        emitted++;
        prevWasWs = true;
      }
      continue;
    }
    if (emitted === normOffset) return charStart;
    emitted++;
    started = true;
    prevWasWs = false;
  }
  return view.source.length;
}

/** 术语切分（ES5 兼容：无 Unicode property escapes）：按空白 + 常见中英文标点切分。
 *  标点（含无空格连写如 policy,adoption）都是 term boundary；hyphen 也可拆（完整 phrase 保留给 exact match）。 */
const PUNCT_SPLIT_RE = /[\s，。、；：,.;:/()（）\[\]""''~-]+/;

/** query → { phrase, terms }：完整短语（normalized，保留原样供 exact phrase matching）+ 最多 8 个 terms */
export function tokenizeLocalSearchQuery(query: string): { phrase: string; terms: string[] } {
  const phrase = normalizeLocalSearchText(query);
  const terms = phrase
    .split(PUNCT_SPLIT_RE)
    .filter((t) => t.length > 0)
    .slice(0, MAX_LOCAL_SEARCH_TERMS);
  return { phrase, terms };
}

// ---------- scoring（deterministic；无第三方库） ----------

export interface LocalSearchMatch {
  /** 命中位置（normalized 文本中的字符偏移；snippet 定位用） */
  index: number;
  /** 命中强度分：exact phrase=10_000 + coverage*100 + frequency；term=coverage*100 + frequency */
  score: number;
  /** normalized 文本中该命中点的上下文（snippet 由调用方生成） */
  matchLength: number;
}

/** coverage window 半径：多个 query term 出现在同一局部上下文才算更相关（≠ 全文任意位置） */
export const LOCAL_SEARCH_COVERAGE_WINDOW_CHARS = 1200;

/** near-duplicate 去重距离：两个 candidate anchor 距离 < 该值只保留高分者 */
export const LOCAL_SEARCH_DEDUP_DISTANCE_CHARS = 200;

const EXACT_PHRASE_SCORE_BASE = 10_000;

/**
 * 在 normalized 文本中找全部命中点（V1.4.1 multi-term 修复）：
 * - 先收集每个 term 的全部 position（O(text × terms)，不逐候选重扫全文）
 * - exact phrase occurrence 作为 candidate anchor：score = 10_000 + coverage*100 + frequency
 * - 每个 term occurrence 作为 candidate anchor：score = coverage*100 + frequency
 *   coverage = anchor ± window 内命中的 distinct query terms 数；frequency = window 内 terms 总出现次数
 * - 排序（score 降序 → index 升序）后做 near-duplicate suppression（距离 < 200 chars 只留高分者；
 *   exact phrase 天然 10_000 起跳 → 同一区域的 term candidates 自动被吞并）
 */
export function scoreLocalSearch(text: string, query: { phrase: string; terms: string[] }): LocalSearchMatch[] {
  if (!text) return [];
  const qTerms = query.terms.filter((t) => t.length > 0);
  const radius = LOCAL_SEARCH_COVERAGE_WINDOW_CHARS;

  // 预收集 term positions（一次扫描/term）
  const positionsByTerm: { term: string; positions: number[] }[] = [];
  for (const term of qTerms) {
    const positions: number[] = [];
    let idx = 0;
    while (idx < text.length) {
      const found = text.indexOf(term, idx);
      if (found === -1) break;
      positions.push(found);
      idx = found + term.length;
    }
    if (positions.length > 0) positionsByTerm.push({ term, positions });
  }

  /** window [from, to] 内命中多少 distinct terms + 总出现次数（binary search per term） */
  const windowStats = (from: number, to: number): { coverage: number; frequency: number } => {
    let coverage = 0;
    let frequency = 0;
    for (const entry of positionsByTerm) {
      // 二分找到第一个 >= from 的 position
      let lo = 0;
      let hi = entry.positions.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (entry.positions[mid] < from) lo = mid + 1;
        else hi = mid;
      }
      let count = 0;
      for (let i = lo; i < entry.positions.length && entry.positions[i] <= to; i++) count++;
      if (count > 0) {
        coverage++;
        frequency += count;
      }
    }
    return { coverage, frequency };
  };

  const candidates: LocalSearchMatch[] = [];

  // 1. exact phrase（最高优先级；中文整句 substring 即为有效 exact phrase）
  if (query.phrase.length > 0) {
    let idx = 0;
    while (idx < text.length) {
      const found = text.indexOf(query.phrase, idx);
      if (found === -1) break;
      const stats = windowStats(found - radius, found + query.phrase.length + radius);
      candidates.push({
        index: found,
        score: EXACT_PHRASE_SCORE_BASE + stats.coverage * 100 + stats.frequency,
        matchLength: query.phrase.length,
      });
      idx = found + query.phrase.length;
    }
  }

  // 2. term candidates：每个 term occurrence 一个 anchor
  if (positionsByTerm.length > 0) {
    for (const entry of positionsByTerm) {
      for (const pos of entry.positions) {
        const stats = windowStats(pos - radius, pos + entry.term.length + radius);
        if (stats.coverage <= 0) continue;
        candidates.push({ index: pos, score: stats.coverage * 100 + stats.frequency, matchLength: entry.term.length });
      }
    }
  }

  // deterministic 排序：score 降序 → index 升序
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);

  // near-duplicate suppression：距已保留 candidate < 200 chars 的丢弃（保留高分者）。
  // keptIndices 保持升序 + 二分查找邻接点 → O(candidates × log kept)，避免高频词 O(n²)。
  const kept: LocalSearchMatch[] = [];
  const keptIndices: number[] = [];
  for (const c of candidates) {
    let lo = 0;
    let hi = keptIndices.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (keptIndices[mid] < c.index) lo = mid + 1;
      else hi = mid;
    }
    const prev = lo > 0 ? keptIndices[lo - 1] : Number.NEGATIVE_INFINITY;
    const next = lo < keptIndices.length ? keptIndices[lo] : Number.POSITIVE_INFINITY;
    if (c.index - prev < LOCAL_SEARCH_DEDUP_DISTANCE_CHARS || next - c.index < LOCAL_SEARCH_DEDUP_DISTANCE_CHARS) {
      continue;
    }
    kept.push(c);
    keptIndices.splice(lo, 0, c.index);
  }
  return kept;
}


// ---------- snippet（V1.4.3：source-faithful Evidence） ----------

/**
 * 围绕真实 source match range 的 bounded snippet（前 ~1/3 + 匹配区 + 后 ~2/3）。
 * - 内容来自 sourceText 原文（保留大小写/标点/Unicode/换行；绝不再 collapse）
 * - 向前扩展到换行或句末标点边界（. 。！？!?；; 与 \n）
 * - 最终 length ≤ maxChars；越界处加省略号
 */
export function buildSourceEvidenceSnippet(input: {
  sourceText: string;
  sourceStart: number;
  sourceEnd: number;
  maxChars?: number;
}): string {
  const total = Math.max(1, input.maxChars ?? MAX_PROJECT_SEARCH_SNIPPET_CHARS);
  const before = Math.floor(total / 3);
  const after = total - before;
  const source = input.sourceText;
  let start = Math.max(0, input.sourceStart - before);
  const end = Math.min(source.length, input.sourceEnd + after);
  const lineBreak = source.lastIndexOf("\n", input.sourceStart);
  if (lineBreak >= start && lineBreak < input.sourceStart) {
    start = lineBreak + 1;
  } else {
    let punct = -1;
    for (const p of ["。", "！", "？", "；", ".", "!", "?", ";"]) {
      const idx = source.lastIndexOf(p, input.sourceStart);
      if (idx > punct) punct = idx;
    }
    if (punct >= start && punct < input.sourceStart) start = punct + 1;
  }
  const snippet = source.slice(start, end);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < source.length ? "…" : "";
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

/**
 * 全文词法搜索（纯函数；bounded output）。
 * V1.4.3：matching/ranking 在 SEARCH VIEW（normalized）上进行；
 * Evidence snippet 通过 sparse checkpoint remap 到 source 原文生成（大小写/Unicode/换行保真）。
 * 预算按最终 source snippet 长度计算。
 */
export function searchLocalText(
  rawText: string,
  query: string,
  options?: { maxResults?: number; snippetChars?: number; totalChars?: number }
): LocalTextSearchResult {
  const maxResults = Math.max(1, Math.min(options?.maxResults ?? MAX_PROJECT_SEARCH_RESULTS, MAX_PROJECT_SEARCH_RESULTS));
  const snippetChars = options?.snippetChars ?? MAX_PROJECT_SEARCH_SNIPPET_CHARS;
  const totalChars = Math.max(1, options?.totalChars ?? MAX_PROJECT_SEARCH_TOTAL_CHARS);
  const view = buildNormalizedSourceView(rawText);
  const scored = scoreLocalSearch(view.normalized, tokenizeLocalSearchQuery(query));
  const matchCount = scored.length;
  // 按 normalized offset 排序后一次性 remap（每个目标只做 ≤ interval 的局部重扫）
  const targets = scored.slice(0, maxResults).sort((a, b) => a.index - b.index);
  const matches: { index: number; text: string }[] = [];
  let used = 0;
  for (const m of targets) {
    const sourceStart = mapNormalizedOffsetToSource(view, m.index);
    const sourceEnd = mapNormalizedOffsetToSource(view, m.index + m.matchLength);
    const snippet = buildSourceEvidenceSnippet({
      sourceText: rawText,
      sourceStart,
      sourceEnd,
      maxChars: snippetChars,
    });
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
  /** V1.4.2：文本层可用性（executor 据此区分「无文本层」与「无匹配」；不进 Tool Output） */
  textLayer: { pageCount: number; possiblyScanned: boolean };
}

interface PdfPageCandidate {
  page: number;
  score: number;
  /** V1.4.3：source-faithful bounded snippet（候选不保存整页双份文本） */
  snippet: string;
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
  if (!q.phrase) return { matches: [], matchCount: 0, truncated: false, textLayer: { pageCount: 0, possiblyScanned: false } };

  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const fontDir = "node_modules/pdfjs-dist/standard_fonts/";
  const nodeInit = typeof window === "undefined" ? { standardFontDataUrl: new URL(`${fontDir}`, import.meta.url).toString() } : {};
  const doc = await pdfjs.getDocument({ data, ...nodeInit }).promise;

  const topCandidates: PdfPageCandidate[] = [];
  let totalMatchCount = 0;
  let nonWhitespaceTextChars = 0;
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
      // V1.4.2：逐页累计非空白字符数（只累加一个 number；bounded memory）
      nonWhitespaceTextChars += pageText.replace(/\s+/g, "").length;
      // V1.4.3：matching 用 SEARCH VIEW；snippet 立即从本页 sourceText 生成（保真且不长期保存整页双份文本）
      const view = buildNormalizedSourceView(pageText);
      if (!view.normalized) continue;
      const scored = scoreLocalSearch(view.normalized, q);
      if (scored.length === 0) continue;
      totalMatchCount += scored.length;
      const best = scored[0];
      const sourceStart = mapNormalizedOffsetToSource(view, best.index);
      const sourceEnd = mapNormalizedOffsetToSource(view, best.index + best.matchLength);
      const snippet = buildSourceEvidenceSnippet({
        sourceText: pageText,
        sourceStart,
        sourceEnd,
        maxChars: snippetChars,
      });
      // 每页只取最佳命中进入候选池（页面级 Evidence 粒度）；ranking 只看 score/page，不看 snippet
      pushCandidate({ page: i, score: best.score, snippet });
    }
  } finally {
    const cleanup = (doc as unknown as { destroy?: () => Promise<void> }).destroy;
    if (cleanup) await cleanup();
  }
  // V1.4.2：canonical classifier（与 extractPdf 同源判定）
  const { possiblyScanned } = classifyPdfTextLayer({
    pageCount: doc.numPages,
    nonWhitespaceTextChars,
  });

  // 按候选生成 bounded snippets（受 maxResults + total chars 双预算；预算按最终 source snippet 长度）
  const matches: PdfSearchMatch[] = [];
  let used = 0;
  for (const c of topCandidates) {
    if (used + c.snippet.length > totalChars) break;
    matches.push({ page: c.page, text: c.snippet });
    used += c.snippet.length;
  }
  return {
    matches,
    matchCount: totalMatchCount,
    truncated: matches.length < topCandidates.length || matches.length < totalMatchCount,
    textLayer: { pageCount: doc.numPages, possiblyScanned },
  };
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

