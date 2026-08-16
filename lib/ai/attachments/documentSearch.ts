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

// ---------- normalize / offset mapping（SEARCH VIEW 单一事实来源，V1.4.3.1） ----------

/** normalized checkpoint 间隔：offset remap 只从最近 checkpoint 局部重扫（避免 dense per-char map） */
export const NORMALIZED_SEARCH_CHECKPOINT_INTERVAL = 512;

/**
 * 组合符号（canonical combining class > 0）范围：段边界判定用。
 * 「starter + 后续组合符号」构成一个 NFC block —— 块内 NFKC 精确、跨块不交互，
 * 因此逐块 normalize 后 concat === 整串 NFKC（canonical parity）。
 */
const COMBINING_MARK_RE =
  /[\u0300-\u036F\u0483-\u0489\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u0711\u0730-\u074A\u07A6-\u07B0\u07EB-\u07F3\u0816-\u0819\u081B-\u0823\u0825-\u0827\u0829-\u082D\u0859-\u085B\u08D3-\u08E1\u08E3-\u08FF\u0900-\u0902\u093A\u093C\u0941-\u0948\u094D\u0951-\u0957\u0962\u0963\u0981\u09BC\u09C1-\u09C4\u09CD\u09E2\u09E3\u0A01\u0A02\u0A3C\u0A41\u0A42\u0A47\u0A48\u0A4B-\u0A4D\u0A51\u0A70\u0A71\u0A75\u0A81\u0A82\u0ABC\u0AC1-\u0AC5\u0AC7\u0AC8\u0ACD\u0AE2\u0AE3\u0B01\u0B3C\u0B3F\u0B41-\u0B44\u0B4D\u0B56\u0B62\u0B63\u0B82\u0BC0\u0BCD\u0C00\u0C04\u0C3E-\u0C40\u0C46-\u0C48\u0C4A-\u0C4D\u0C55\u0C56\u0C62\u0C63\u0C81\u0CBC\u0CBF\u0CC6\u0CCC\u0CCD\u0CE2\u0CE3\u0D00\u0D01\u0D3B\u0D3C\u0D41-\u0D44\u0D4D\u0D62\u0D63\u0DCA\u0DD2-\u0DD4\u0DD6\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u0EB1\u0EB4-\u0EB9\u0EBB\u0EBC\u0EC8-\u0ECD\u0F18\u0F19\u0F35\u0F37\u0F39\u0F71-\u0F7E\u0F80-\u0F84\u0F86\u0F87\u0F8D-\u0F97\u0F99-\u0FBC\u0FC6\u102D-\u1030\u1032-\u1037\u1039\u103A\u103D\u103E\u1058\u1059\u105E-\u1060\u1071-\u1074\u1082\u1085\u1086\u108D\u109D\u135D-\u135F\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17B4\u17B5\u17B7-\u17BD\u17C6\u17C9-\u17D3\u17DD\u180B-\u180D\u18A9\u1920-\u1922\u1927\u1928\u1932\u1939-\u193B\u1A17\u1A18\u1A1B\u1A56\u1A58-\u1A5E\u1A60\u1A62\u1A65-\u1A6C\u1A73-\u1A7C\u1A7F\u1AB0-\u1ABE\u1B00-\u1B03\u1B34\u1B36-\u1B3A\u1B3C\u1B42\u1B6B-\u1B73\u1B80\u1B81\u1BA2-\u1BA5\u1BA8\u1BA9\u1BAB-\u1BAD\u1BE6\u1BE8-\u1BE9\u1BED\u1BEF-\u1BF1\u1C2C-\u1C33\u1C36\u1C37\u1CD0-\u1CD2\u1CD4-\u1CE0\u1CE2-\u1CE8\u1CED\u1CF4\u1CF8\u1CF9\u1DC0-\u1DFF\u20D0-\u20F0\u2CEF-\u2CF1\u2D7F\u2DE0-\u2DFF\u302A-\u302D\u3099\u309A\uA66F\uA674-\uA67D\uA69E\uA69F\uA6F0\uA6F1\uA802\uA806\uA80B\uA825\uA826\uA8C4\uA8E0-\uA8F1\uA926-\uA92D\uA947-\uA951\uA980-\uA982\uA9B3\uA9B6-\uA9B9\uA9BC\uA9E5\uAA29-\uAA2E\uAA31\uAA32\uAA35\uAA36\uAA43\uAA4C\uAA7C\uAAB0\uAAB2-\uAAB4\uAAB7\uAAB8\uAABE\uAABF\uAAC1\uAAEC\uAAED\uAAF6\uABE5\uABE8\uABED\uFB1E\uFE00-\uFE0F\uFE20-\uFE2F\uFF9E\uFF9F]/;

export interface NormalizedCheckpoint {
  /** checkpoint 处已产生的 canonical 字符数（UTF-16 units） */
  normOffset: number;
  /** 对应 source 偏移（UTF-16 units；checkpoint 位于安全段边界） */
  sourceOffset: number;
  /** 是否已 emit 过非空白字符（trim-start 状态） */
  started: boolean;
  /** 上一个 emit 的 canonical 字符是否为 collapse 后的空格 */
  prevWasWs: boolean;
}

export interface NormalizedSourceView {
  normalized: string;
  /** source 原文（remap 与 snippet 用；持有引用，不复制） */
  source: string;
  /** 稀疏 checkpoints：mapping 用（不做 dense per-char 索引） */
  checkpoints: NormalizedCheckpoint[];
}

function isSpaceChar(ch: string): boolean {
  return /\s/.test(ch);
}

/** 段内 spans：每个 canonical code point（UTF-16 长度）→ 来源 source span。
 *  组合（e+◌́→é）时后续 cp 扩展最后一个 span 的 srcEnd；分解（ﬀ→ff）时新字符归属当前 cp。
 *  段很小（starter + 组合符号），spans 为段内 dense、段间 sparse。 */
interface SegmentSpan {
  canonStart: number;
  canonUnits: number;
  srcStart: number;
  srcEnd: number;
}

/** 对段内 canonical 相对偏移 rel 查找所属 span（span.canonStart <= rel < canonStart+units） */
function spanForCanonOffset(spans: SegmentSpan[], rel: number): SegmentSpan | null {
  for (const s of spans) {
    if (rel >= s.canonStart && rel < s.canonStart + s.canonUnits) return s;
  }
  return null;
}

function buildSegmentSpans(segText: string, segSrcStart: number): { spans: SegmentSpan[]; canonLength: number } {
  const spans: SegmentSpan[] = [];
  let prefix = "";
  let prefixCanon = "";
  let cumLen = 0;
  let lastSpan: SegmentSpan | null = null;
  let localPos = 0;
  while (localPos < segText.length) {
    const cpStart = localPos;
    const cpChar = String.fromCodePoint(segText.codePointAt(localPos) ?? 0);
    localPos += cpChar.length;
    prefix += cpChar;
    prefixCanon = prefix.normalize("NFKC").toLowerCase();
    const newLen = prefixCanon.length;
    const srcStart = segSrcStart + cpStart;
    const srcEnd = segSrcStart + localPos;
    if (newLen > cumLen) {
      // 新 canonical 字符出现：[cumLen, newLen) 归属当前 source cp
      let pos = cumLen;
      while (pos < newLen) {
        const canonCp = prefixCanon.codePointAt(pos) ?? 0;
        const units = String.fromCodePoint(canonCp).length;
        lastSpan = { canonStart: pos, canonUnits: units, srcStart, srcEnd };
        spans.push(lastSpan);
        pos += units;
      }
    } else if (newLen === cumLen && lastSpan) {
      // 组合：扩展最后一个 span 的 srcEnd（é 跨 e 与 ◌́）
      lastSpan.srcEnd = srcEnd;
    }
    cumLen = newLen;
  }
  return { spans, canonLength: cumLen };
}

/**
 * 构建 SEARCH VIEW（唯一 normalize 实现；normalizeLocalSearchText 与其共用）：
 * 按 NFC block（starter + 组合符号）分段，逐段 NFKC → concat，等于整串 NFKC（canonical parity）。
 * 记录稀疏 checkpoints（位于安全段边界；相邻大致 bounded）。复杂度 O(n)；内存 O(n / interval)。
 */
export function buildNormalizedSourceView(source: string): NormalizedSourceView {
  const normalized: string[] = [];
  const checkpoints: NormalizedCheckpoint[] = [];
  let canonOffset = 0;
  let srcPos = 0;
  let started = false;
  let prevWasWs = false;
  checkpoints.push({ normOffset: 0, sourceOffset: 0, started: false, prevWasWs: false });
  while (srcPos < source.length) {
    const cpChar = String.fromCodePoint(source.codePointAt(srcPos) ?? 0);
    if (isSpaceChar(cpChar)) {
      // 空白 run：整体消费；仅在 started && !prevWasWs 时 emit 一个 collapse 空格
      const runStart = srcPos;
      while (srcPos < source.length && isSpaceChar(String.fromCodePoint(source.codePointAt(srcPos) ?? 0))) {
        srcPos += String.fromCodePoint(source.codePointAt(srcPos) ?? 0).length;
      }
      if (started && !prevWasWs) {
        normalized.push(" ");
        prevWasWs = true;
        canonOffset++;
      }
      continue;
    }
    // 非空白 segment：starter + 后续组合符号（NFC block）
    const segStart = srcPos;
    let segText = "";
    const starter = String.fromCodePoint(source.codePointAt(srcPos) ?? 0);
    segText += starter;
    srcPos += starter.length;
    while (srcPos < source.length) {
      const ch = String.fromCodePoint(source.codePointAt(srcPos) ?? 0);
      if (!COMBINING_MARK_RE.test(ch)) break;
      segText += ch;
      srcPos += ch.length;
    }
    const { canonLength } = buildSegmentSpans(segText, segStart);
    const segCanon = segText.normalize("NFKC").toLowerCase();
    normalized.push(segCanon);
    started = true;
    prevWasWs = false;
    canonOffset += canonLength;
    // checkpoint：仅在安全段边界、且距上一个 checkpoint ≥ interval 时记录
    if (canonOffset - checkpoints[checkpoints.length - 1].normOffset >= NORMALIZED_SEARCH_CHECKPOINT_INTERVAL) {
      checkpoints.push({ normOffset: canonOffset, sourceOffset: srcPos, started, prevWasWs });
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

export interface SourceRange {
  /** start inclusive */
  sourceStart: number;
  /** end exclusive */
  sourceEnd: number;
}

/**
 * canonical range → source range（仅对 ≤ maxResults 个目标调用）。
 * 从最近 checkpoint 局部重扫（≤ interval），逐 canonical 单位推进；命中单位内部用段内 spans 精确拆分。
 * start/end 均为 UTF-16 units；返回的 source 边界永远是合法 code point 边界（不会切在 surrogate pair 中间）。
 */
export function mapNormalizedRangeToSource(
  view: NormalizedSourceView,
  range: { start: number; end: number }
): SourceRange {
  const source = view.source;
  if (range.start <= 0 && range.end <= 0) {
    return { sourceStart: 0, sourceEnd: 0 };
  }
  // binary search：最近 checkpoint（≤ start）
  const cks = view.checkpoints;
  let lo = 0;
  let hi = cks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cks[mid].normOffset <= range.start) lo = mid + 1;
    else hi = mid;
  }
  const ck = cks[lo - 1];
  let canonOffset = ck.normOffset;
  let srcPos = ck.sourceOffset;
  let started = ck.started;
  let prevWasWs = ck.prevWasWs;
  let sourceStart = 0;
  let sourceEnd = source.length;
  let startFound = range.start <= 0;
  if (startFound) sourceStart = ck.sourceOffset;
  let endFound = range.end <= 0;

  while (srcPos < source.length && !(startFound && endFound)) {
    const cpChar = String.fromCodePoint(source.codePointAt(srcPos) ?? 0);
    if (isSpaceChar(cpChar)) {
      const runStart = srcPos;
      while (srcPos < source.length && isSpaceChar(String.fromCodePoint(source.codePointAt(srcPos) ?? 0))) {
        srcPos += String.fromCodePoint(source.codePointAt(srcPos) ?? 0).length;
      }
      if (started && !prevWasWs) {
        // canonical 空格：source span = 整个空白 run
        if (!startFound && canonOffset === range.start) {
          sourceStart = runStart;
          startFound = true;
        }
        canonOffset++;
        if (!endFound && canonOffset === range.end) {
          sourceEnd = srcPos; // run end
          endFound = true;
        }
        prevWasWs = true;
      }
      continue;
    }
    // 非空白 segment：starter + 后续组合符号（与 build 阶段同一分段逻辑）
    const segStart = srcPos;
    let segText = "";
    const starter = String.fromCodePoint(source.codePointAt(srcPos) ?? 0);
    segText += starter;
    srcPos += starter.length;
    while (srcPos < source.length) {
      const ch = String.fromCodePoint(source.codePointAt(srcPos) ?? 0);
      if (!COMBINING_MARK_RE.test(ch)) break;
      segText += ch;
      srcPos += ch.length;
    }
    const { spans, canonLength } = buildSegmentSpans(segText, segStart);
    if (!startFound) {
      const rel = range.start - canonOffset;
      if (rel >= 0 && rel < canonLength) {
        const span = spanForCanonOffset(spans, rel);
        sourceStart = span ? span.srcStart : srcPos;
        startFound = true;
      }
    }
    if (!endFound) {
      const relEnd = range.end - canonOffset;
      if (relEnd >= 0 && relEnd <= canonLength) {
        if (relEnd < canonLength) {
          const span = spanForCanonOffset(spans, relEnd);
          sourceEnd = span ? span.srcEnd : srcPos;
        } else {
          sourceEnd = srcPos; // 段尾（= 下一个 unit 起点）
        }
        endFound = true;
      }
    }
    canonOffset += canonLength;
    started = true;
    prevWasWs = false;
  }
  if (!startFound) sourceStart = source.length;
  if (!endFound) sourceEnd = source.length;
  return { sourceStart, sourceEnd };
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
 * V1.4.3.1：结果按 relevance（rank）顺序输出；remap 仅内部按 offset 排序，完成后恢复 rank 序；
 * 预算（maxResults / total chars）严格按 relevance 消费。
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
  // 保持 relevance（rank）顺序；mapping 内部按 offset 排序，完成后按 rank 恢复
  const ranked = scored.slice(0, maxResults);
  const mappedByRank: { index: number; range: SourceRange }[] = new Array(ranked.length);
  ranked
    .map((m, rank) => ({ m, rank }))
    .sort((a, b) => a.m.index - b.m.index)
    .forEach(({ m, rank }) => {
      mappedByRank[rank] = {
        index: m.index,
        range: mapNormalizedRangeToSource(view, { start: m.index, end: m.index + m.matchLength }),
      };
    });
  const matches: { index: number; text: string }[] = [];
  let used = 0;
  for (const entry of mappedByRank) {
    const snippet = buildSourceEvidenceSnippet({
      sourceText: rawText,
      sourceStart: entry.range.sourceStart,
      sourceEnd: entry.range.sourceEnd,
      maxChars: snippetChars,
    });
    if (used + snippet.length > totalChars) break;
    matches.push({ index: entry.index, text: snippet });
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
      const range = mapNormalizedRangeToSource(view, { start: best.index, end: best.index + best.matchLength });
      const snippet = buildSourceEvidenceSnippet({
        sourceText: pageText,
        sourceStart: range.sourceStart,
        sourceEnd: range.sourceEnd,
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

