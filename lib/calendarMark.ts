import { Assignment, CalendarMark } from "@/types";
import { getLocalDDLDate } from "@/lib/ddl";
import { hasTaskDeadline } from "@/lib/tasks/taskSemantics";

/**
 * Legacy fallback 匹配：仅当 mark 无 sourceId 且 type==="ddl" 时，
 * 按 title AND date 严格匹配。宁可匹配不到，也不能误删同一天/同名
 * 其他任务的数据。
 * Task V2：Assignment 无 DDL 时一律不参与 legacy 匹配（sourceId 精确匹配仍可用）。
 */
export function isLegacyDDLMarkForAssignment(
  mark: CalendarMark,
  assignment: Assignment
): boolean {
  if (!hasTaskDeadline(assignment)) return false;
  return (
    !mark.sourceId &&
    mark.type === "ddl" &&
    mark.title === assignment.title &&
    mark.date === getLocalDDLDate(assignment.ddl)
  );
}

/**
 * 统一关联判断（updateAssignment / deleteAssignment / deleteCourse 共用）：
 * Level 1：sourceId 精确匹配（标准路径）
 * Level 2：仅无 sourceId 的 ddl mark 走 legacy title AND date 匹配
 */
export function isDDLMarkForAssignment(
  mark: CalendarMark,
  assignment: Assignment
): boolean {
  return mark.sourceId === assignment.id || isLegacyDDLMarkForAssignment(mark, assignment);
}

/**
 * 数据修复 helper：对"可唯一确定"的 legacy mark（无 sourceId、type=ddl）
 * 自动补 sourceId。
 *
 * 规则：
 * - 仅当某个 title+date 组合恰好对应唯一一个 Assignment 且
 *   恰好唯一一个 legacy mark 时才链接；
 * - 若两个 Assignment 的 title+date 完全相同（无法区分），保持不动，不猜；
 * - 已带 sourceId 的 mark、exam/activity mark 一律不动。
 */
export function linkLegacyDDLMarks(
  assignments: Assignment[],
  calendarMarks: CalendarMark[]
): CalendarMark[] {
  const byKey = new Map<string, Assignment[]>();
  for (const a of assignments) {
    // Task V2：无 DDL 的 Assignment 不参与 legacy linking（不猜关联）
    if (!hasTaskDeadline(a)) continue;
    const key = `${a.title}\u0000${getLocalDDLDate(a.ddl)}`;
    const list = byKey.get(key);
    if (list) list.push(a);
    else byKey.set(key, [a]);
  }

  return calendarMarks.map((m) => {
    if (m.sourceId || m.type !== "ddl") return m;
    const key = `${m.title}\u0000${m.date}`;
    const candidates = byKey.get(key);
    // 唯一对应才链接；重复 title+date 属于历史异常，不做猜测
    if (candidates && candidates.length === 1) {
      return { ...m, sourceId: candidates[0].id };
    }
    return m;
  });
}
