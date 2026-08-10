import { Assignment, Priority } from "@/types";
import { combineLocalDateTime, getLocalDDLTime, parseLocalDDL } from "@/lib/ddl";

/** 本地日期字符串（不用 toISOString，避免时区偏移） */
export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

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

/**
 * 批量整体平移截止日期：所有任务提前/延后 N 天（N 可为负），
 * 相对日期差保持不变；HH:mm 墙钟时间保持；非法 DDL 原样保留；不 mutate 原数组。
 * 纯本地日历运算（setDate 由 Date 内部按本地时区进位/借位），无 UTC 漂移。
 */
export function bulkShiftDDL(assignments: Assignment[], days: number): Assignment[] {
  return assignments.map((a) => {
    const d = parseLocalDDL(a.ddl);
    if (!d) return a; // 无法解析：安全原样保留
    const shifted = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate() + days,
      d.getHours(),
      d.getMinutes(),
      d.getSeconds() || 0,
      0
    );
    return {
      ...a,
      ddl: combineLocalDateTime(localDateStr(shifted), getLocalDDLTime(a.ddl)),
    };
  });
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

/** 批量清除截止时间（ddl 恢复为 undefined；CalendarMark 由 store 的 updateAssignment 同步删除） */
export function bulkClearDDL(assignments: Assignment[]): Assignment[] {
  return assignments.map((a) => ({ ...a, ddl: undefined }));
}
