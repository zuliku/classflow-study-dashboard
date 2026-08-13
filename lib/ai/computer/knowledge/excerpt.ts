/**
 * V3 Part 2.1 — Live Text Excerpt（Grounded Workspace Retrieval）。
 * 职责：live text + query → 有界相关 excerpt（window 方案）。
 * 知识 snippet 绝不直接作为最终正文；excerpt 必须来自当前 live read 的文本。
 *
 * Window 方案（修复 normalized offset 漂移）：
 * - 将 raw 原文按固定 overlap windows 切分；
 * - ranking 用 normalize 后的 window（exact phrase + token overlap 的确定性小 score）；
 * - excerpt 永远返回 raw original window（offset 恒准确）。
 * truncated 语义 = 返回的 excerpt 是否省略了 live source 任何正文
 * （start > 0 或 end < source.length 即 truncated；不使用 Knowledge snippet 常量）。
 */
import { normalizeKnowledgeText, tokenizeKnowledgeText } from "@/lib/ai/computer/knowledge/tokenize";

export const RETRIEVE_EXCERPT_MAX_CHARS = 1_600;
export const RETRIEVE_EXCERPT_WINDOW_OVERLAP = 240;

export interface LiveExcerptResult {
  excerpt: string;
  truncated: boolean;
}

/** window score：exact normalized phrase 权重最高 + 有界 token overlap */
function scoreWindow(windowText: string, normQuery: string, queryTokens: string[]): number {
  let score = 0;
  if (normQuery && windowText.includes(normQuery)) score += 50;
  const tokens = new Set(tokenizeKnowledgeText(windowText));
  for (const token of queryTokens) {
    if (tokens.has(token)) score += 6;
  }
  return score;
}

/** 在 live text 中定位 query 最相关 window 并返回 raw bounded excerpt（无命中则取前部） */
export function buildLiveExcerpt(text: string, query: string): LiveExcerptResult {
  const trimmed = text.trim();
  if (!trimmed) return { excerpt: "", truncated: false };
  const sourceLength = trimmed.length;

  const normQuery = normalizeKnowledgeText(query);
  const queryTokens = Array.from(new Set(tokenizeKnowledgeText(query)));

  // 固定 overlap windows（window size = RETRIEVE_EXCERPT_MAX_CHARS）
  const windows: { start: number; end: number; score: number }[] = [];
  const step = Math.max(1, RETRIEVE_EXCERPT_MAX_CHARS - RETRIEVE_EXCERPT_WINDOW_OVERLAP);
  for (let start = 0; start < sourceLength; start += step) {
    const end = Math.min(sourceLength, start + RETRIEVE_EXCERPT_MAX_CHARS);
    const rawWindow = trimmed.slice(start, end);
    windows.push({ start, end, score: scoreWindow(normalizeKnowledgeText(rawWindow), normQuery, queryTokens) });
    if (end >= sourceLength) break;
  }

  if (windows.length === 0) return { excerpt: "", truncated: false };

  // 最高分 window（score DESC → start ASC 确定性）
  let best = windows[0];
  for (const w of windows) {
    if (w.score > best.score || (w.score === best.score && w.start < best.start)) best = w;
  }

  if (best.score <= 0) {
    // 无 query 命中：前部 bounded excerpt
    return {
      excerpt: trimmed.slice(0, RETRIEVE_EXCERPT_MAX_CHARS),
      truncated: sourceLength > RETRIEVE_EXCERPT_MAX_CHARS,
    };
  }

  return {
    excerpt: trimmed.slice(best.start, best.end),
    truncated: best.start > 0 || best.end < sourceLength,
  };
}
