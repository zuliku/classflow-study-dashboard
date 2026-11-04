/**
 * Kiro Search / Deep Research 共享 Turn 状态。
 *
 * 目的：web_search 与 web_research 在同一个请求内共享：
 * - 本轮剩余搜索预算（每个 query / search 消耗 1 次）
 * - 下一个 web-N sourceId（跨工具唯一、连续）
 * - 已成功查询（重复查询守卫）
 * - 已见 canonical URL（跨工具去重）
 *
 * 跨 request 的总量仍由 inspectCurrentTurnWebSearchState 从 messages 重建，
 * 本对象只负责单次 /api/ai/chat 请求内的并发一致性。
 */

import { MAX_WEB_SEARCHES_PER_TURN } from "@/lib/ai/web/types";

export interface KiroWebTurnState {
  remainingSearchAttempts: number;
  nextSourceIndex: number;
  successfulQueries: Set<string>;
  seenUrls: Set<string>;
}

export function createKiroWebTurnState(input: {
  attemptsSoFar: number;
  maxAttempts?: number;
  nextSourceIndex: number;
  successfulQueries?: string[];
  seenUrls?: string[];
}): KiroWebTurnState {
  return {
    remainingSearchAttempts: Math.max(
      0,
      (input.maxAttempts ?? MAX_WEB_SEARCHES_PER_TURN) - input.attemptsSoFar
    ),
    nextSourceIndex: input.nextSourceIndex,
    successfulQueries: new Set(input.successfulQueries ?? []),
    seenUrls: new Set(input.seenUrls ?? []),
  };
}

/** 原子分配连续 sourceId（JS 单线程；并发 tool call 不会拿到重复 ID） */
export function allocateWebSourceIds(state: KiroWebTurnState, count: number): string[] {
  const n = Math.max(0, Math.floor(count));
  const start = state.nextSourceIndex;
  state.nextSourceIndex += n;
  return Array.from({ length: n }, (_, i) => `web-${start + i}`);
}
