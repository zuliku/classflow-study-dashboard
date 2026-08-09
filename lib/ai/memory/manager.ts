/**
 * Memory Manager（纯逻辑层）：Intent 守卫、eligible 过滤、Index 构建、关键词搜索。
 * Memory 不是当前 ClassFlow 业务状态；stale（课程被删 / 学期已过）默认不进 Index。
 */

import { KiroMemory, MemoryCategory, MemoryScope, MAX_MEMORY_SEARCH_RESULTS } from "@/lib/ai/memory/types";
import { listMemories } from "@/lib/ai/memory/db";
import type { AppState } from "@/store/useAppStore";

const INTENT_PATTERNS: RegExp[] = [
  /记住/i,
  /记一下/i,
  /以后都/i,
  /以后不要/i,
  /以后也/i,
  /我的偏好/i,
  /请记住/i,
  /别忘了/i,
  /\bremember\b/i,
  /\bkeep in mind\b/i,
  /my preference is/i,
  /from now on/i,
];

/** Explicit Memory Intent 守卫：只有当前用户消息明显表达「记住…」时才允许保存 */
export function hasExplicitMemoryIntent(userText: string): boolean {
  if (!userText) return false;
  return INTENT_PATTERNS.some((re) => re.test(userText));
}

export interface MemoryIndexEntry {
  id: string;
  title: string;
  category: MemoryCategory;
  scope: MemoryScope;
  scopeId?: string;
}

/** eligible：global 恒有效；semester 需匹配当前学期；course 需课程仍存在（不猜重绑） */
export function isMemoryEligible(m: KiroMemory, state: Pick<AppState, "semester" | "courses">): boolean {
  if (!m.active) return false;
  if (m.scope === "global") return true;
  if (m.scope === "semester") return !!m.scopeId && m.scopeId === state.semester.id;
  if (m.scope === "course") return !!m.scopeId && state.courses.some((c) => c.id === m.scopeId);
  return false;
}

/** 每轮只给模型 Index（无 content）；stale memory 不进 Index */
export async function buildMemoryIndex(state: Pick<AppState, "semester" | "courses">): Promise<MemoryIndexEntry[]> {
  const all = await listMemories();
  return all
    .filter((m) => isMemoryEligible(m, state))
    .map((m) => ({ id: m.id, title: m.title, category: m.category, scope: m.scope, scopeId: m.scopeId }))
    .slice(0, 20);
}

/** 关键词搜索（title/content/tags 简单包含匹配） */
export function searchMemoriesByKeyword(memories: KiroMemory[], opts: { query?: string; category?: MemoryCategory; scope?: MemoryScope; limit?: number }): KiroMemory[] {
  const q = (opts.query ?? "").trim().toLowerCase();
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), MAX_MEMORY_SEARCH_RESULTS);
  return memories
    .filter((m) => {
      if (opts.category && m.category !== opts.category) return false;
      if (opts.scope && m.scope !== opts.scope) return false;
      if (!q) return true;
      const hay = normalizeSearch(m.title + " " + m.content + " " + (m.tags ?? []).join(" "));
      return hay.includes(normalizeSearch(q));
    })
    .slice(0, limit);
}

function normalizeSearch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

/** stale 记忆（课程已删 / 学期已过）：保留在库，不进入 Index；UI 显示「关联课程已不存在」 */
export function isMemoryStale(m: KiroMemory, state: Pick<AppState, "semester" | "courses">): boolean {
  if (m.scope === "course") return !m.scopeId || !state.courses.some((c) => c.id === m.scopeId);
  if (m.scope === "semester") return !m.scopeId || m.scopeId !== state.semester.id;
  return false;
}
