/**
 * Task 18B：Kiro Native HTML Reader —— 纯函数 evidence 管线。
 *
 * normalize → paragraph chunking → query-aware selection → budget cap。
 * 复用现有 Web Evidence 预算（lib/ai/web/types.ts）：
 *   MAX_WEB_EVIDENCE_CHUNK_CHARS / MAX_WEB_EVIDENCE_CHARS_PER_SOURCE
 *
 * 本模块无 IO；HTML/网络/Readability 都在 reader.ts。
 */

import {
  MAX_WEB_EVIDENCE_CHARS_PER_SOURCE,
  MAX_WEB_EVIDENCE_CHUNK_CHARS,
} from "@/lib/ai/web/types";

/** Native Reader 单 source 最多 chunks（Task 18B §36） */
export const MAX_NATIVE_WEB_EVIDENCE_CHUNKS = 3;
/** 有效正文最小字符数（normalize 后）；低于此 → WEB_NATIVE_NO_EVIDENCE（§31） */
export const MIN_NATIVE_WEB_EVIDENCE_CHARS = 120;
/** parsed text 扫描上限（§49）：超过先截至此值再走 pipeline，标 truncated */
export const MAX_NATIVE_WEB_TEXT_SCAN_CHARS = 100_000;

export interface NativeEvidenceChunk {
  /** 在原文中的文档顺序索引（selection 后按此恢复自然顺序） */
  index: number;
  text: string;
}

/**
 * 统一文本归一（§32）：
 * \r\n → \n；逐行 trim；行内连续空格/tab → 单空格；空行折叠为段落边界（段落间恰好一个空行）。
 * 不把全部正文压成一行。
 */
export function normalizeNativeWebText(text: string): string {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/[ \t]+/g, " "));
  const paragraphs: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    if (paragraphs.length === 0 || paragraphs[paragraphs.length - 1] !== line) paragraphs.push(line);
  }
  return paragraphs.join("\n\n");
}

interface ChunkPipelineResult {
  chunks: NativeEvidenceChunk[];
  truncated: boolean;
}

/**
 * Paragraph → chunk（§37-38、§49）：
 * - 正文超过 MAX_NATIVE_WEB_TEXT_SCAN_CHARS → 先截断，标 truncated
 * - 按段落顺序累计到 MAX_WEB_EVIDENCE_CHUNK_CHARS 附近再开新 chunk
 * - 单段超长 → 硬切 1800
 * - exact dedupe（normalized 后完全相同的段落只保留一次；§39）
 */
export function chunkNativeEvidence(
  text: string,
  opts?: { maxChunkChars?: number }
): ChunkPipelineResult {
  const maxChunkChars = opts?.maxChunkChars ?? MAX_WEB_EVIDENCE_CHUNK_CHARS;
  let truncated = false;
  let scan = text;
  if (scan.length > MAX_NATIVE_WEB_TEXT_SCAN_CHARS) {
    scan = scan.slice(0, MAX_NATIVE_WEB_TEXT_SCAN_CHARS);
    truncated = true;
  }

  const paragraphs = scan.split("\n\n");
  const seen = new Set<string>();
  const chunks: NativeEvidenceChunk[] = [];
  let current = "";
  let index = 0;

  const flush = () => {
    if (!current) return;
    if (chunks.length === 0 || chunks[chunks.length - 1].text !== current) {
      chunks.push({ index: index++, text: current });
    }
    current = "";
  };

  for (const rawParagraph of paragraphs) {
    const paragraph = rawParagraph.trim();
    if (!paragraph) continue;
    if (seen.has(paragraph)) {
      truncated = true; // 原文存在重复段落（被去重 = 未完整保留）
      continue;
    }
    seen.add(paragraph);

    if (paragraph.length > maxChunkChars) {
      flush();
      chunks.push({ index: index++, text: paragraph.slice(0, maxChunkChars) });
      truncated = true; // 单段硬切
      continue;
    }
    if (current && current.length + paragraph.length + 1 > maxChunkChars) {
      flush();
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  flush();

  return { chunks, truncated };
}

/** query 归一（§42-43）：lowercase + collapse whitespace + Unicode 字母/数字 token，长度 ≥2 */
const UNICODE_TOKEN_RE = /[\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFFa-zA-Z0-9]+/g;

export function normalizeWebQueryTokens(query: string): string[] {
  const normalized = query.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const tokens = normalized.match(UNICODE_TOKEN_RE) ?? [];
  return tokens.filter((t) => t.length >= 2);
}

/**
 * Query-aware selection（§40-46）：
 * - 无 query → 文档顺序前 MAX_NATIVE_WEB_EVIDENCE_CHUNKS 个
 * - 有 query → 每 chunk 命中 token +1、完整 phrase 命中额外 +3；
 *   存在 score>0 时取最高分最多 3 个并按文档 index 恢复自然顺序；
 *   全部 score=0 → 退回前 3 个（不返回空证据）
 */
export function selectNativeEvidenceChunks(
  chunks: NativeEvidenceChunk[],
  query?: string
): { selected: NativeEvidenceChunk[]; truncated: boolean } {
  const sorted = [...chunks].sort((a, b) => a.index - b.index);
  const fallback = sorted.slice(0, MAX_NATIVE_WEB_EVIDENCE_CHUNKS);
  const truncated = sorted.length > MAX_NATIVE_WEB_EVIDENCE_CHUNKS;

  if (!query || query.trim().length === 0) return { selected: fallback, truncated };

  const phrase = query.toLowerCase().replace(/\s+/g, " ").trim();
  const tokens = normalizeWebQueryTokens(phrase);
  if (tokens.length === 0) return { selected: fallback, truncated };

  const scored = sorted.map((chunk) => {
    const text = chunk.text.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (text.includes(token)) score += 1;
    }
    if (text.includes(phrase)) score += 3;
    return { chunk, score };
  });

  const best = scored.filter((s) => s.score > 0);
  if (best.length === 0) return { selected: fallback, truncated };

  const top = best
    .sort((a, b) => b.score - a.score || a.chunk.index - b.chunk.index)
    .slice(0, MAX_NATIVE_WEB_EVIDENCE_CHUNKS)
    .map((s) => s.chunk)
    .sort((a, b) => a.index - b.index);

  const droppedRelevant = best.length > top.length;
  return { selected: top, truncated: truncated || droppedRelevant };
}

/**
 * Source budget cap（§47）：最终 selected chunks 总 chars ≤ MAX_WEB_EVIDENCE_CHARS_PER_SOURCE。
 * 截断 → truncated=true。chunk 会被截断到预算内（最小保留 chunk 上限，不产生空 chunk）。
 */
export function applyNativeEvidenceBudget(
  selected: NativeEvidenceChunk[]
): { chunks: { text: string }[]; truncated: boolean } {
  const out: { text: string }[] = [];
  let total = 0;
  let truncated = false;
  for (const chunk of selected) {
    if (total + chunk.text.length <= MAX_WEB_EVIDENCE_CHARS_PER_SOURCE) {
      out.push({ text: chunk.text });
      total += chunk.text.length;
      continue;
    }
    const room = MAX_WEB_EVIDENCE_CHARS_PER_SOURCE - total;
    if (room > 0) {
      out.push({ text: chunk.text.slice(0, room) });
      total += room;
      truncated = true;
    }
    truncated = true; // 后续 chunk 被丢弃
  }
  return { chunks: out, truncated };
}
