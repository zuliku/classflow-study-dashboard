import { Assignment, Priority } from "@/types";
import { combineLocalDateTime, getLocalDDLTime } from "@/lib/ddl";

/**
 * Assignment Workspace 的选择/批量逻辑（纯函数，可独立单测）。
 * 选择状态与 highlight 由 Store 承载（Command Center 与列表共享同一 selection context）。
 */

// ---- Selection ----

/** 切换单个 id 的选中状态 */
export function toggleSelection(selection: string[], id: string): string[] {
  return selection.includes(id)
    ? selection.filter((x) => x !== id)
    : [...selection, id];
}

/**
 * Range 选择：在 visible 列表顺序内，从 anchor 到 target 的闭区间。
 * anchor 不在 visible 中时退化为仅 target。
 */
export function rangeSelection(
  visibleIds: string[],
  anchorId: string,
  targetId: string
): string[] {
  const start = visibleIds.indexOf(anchorId);
  const end = visibleIds.indexOf(targetId);
  if (start === -1 || end === -1) return [targetId];
  const [lo, hi] = start <= end ? [start, end] : [end, start];
  return visibleIds.slice(lo, hi + 1);
}

/** 全选当前可见（仅返回可见集合本身） */
export function selectAllVisible(visibleIds: string[]): string[] {
  return [...visibleIds];
}

/** 筛选变化后清理隐藏项：selection/highlight 只保留仍可见的 id */
export function sanitizeSelection(selection: string[], visibleIds: string[]): string[] {
  const set = new Set(visibleIds);
  return selection.filter((id) => set.has(id));
}

export function sanitizeHighlight(
  highlightedId: string | null,
  visibleIds: string[]
): string | null {
  if (highlightedId == null) return null;
  return visibleIds.includes(highlightedId) ? highlightedId : (visibleIds[0] ?? null);
}

// ---- Bulk DDL ----

/** 批量调整截止日期：只改日期，保留每项原本的墙钟时间（无 UTC 漂移） */
export function bulkApplyDDLDate(
  assignments: Assignment[],
  targetDate: string
): Assignment[] {
  return assignments.map((a) => ({
    ...a,
    ddl: combineLocalDateTime(targetDate, getLocalDDLTime(a.ddl)),
  }));
}

/** 批量设置状态 */
export function bulkApplyStatus(
  assignments: Assignment[],
  status: Assignment["status"]
): Assignment[] {
  return assignments.map((a) => ({
    ...a,
    status,
    progress: status === "completed" ? 100 : a.progress,
  }));
}

/** 批量设置优先级 */
export function bulkApplyPriority(
  assignments: Assignment[],
  priority: Priority
): Assignment[] {
  return assignments.map((a) => ({ ...a, priority }));
}
