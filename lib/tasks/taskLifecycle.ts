/**
 * Phase 0：Task Lifecycle 语义（纯函数，无 React / 无 Zustand）。
 *
 * 单一事实源：
 * - todo / doing = active（planning eligible）
 * - submitted = waiting feedback（planning terminal）
 * - completed = done（planning terminal）
 *
 * 逾期只按截止时刻判断；submitted/completed 永不 overdue。
 * 旧数据只有日期没有时间 → 按当地 23:59 解释（读取时补，不写回）。
 */

import { differenceInCalendarDays } from "date-fns";
import { Assignment } from "@/types";
import { parseLocalDDL } from "@/lib/ddl";

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isActiveTask(task: Pick<Assignment, "status">): boolean {
  return task.status === "todo" || task.status === "doing";
}

export function isWaitingTask(task: Pick<Assignment, "status">): boolean {
  return task.status === "submitted";
}

export function isCompletedTask(task: Pick<Assignment, "status">): boolean {
  return task.status === "completed";
}

export function isClosedTask(task: Pick<Assignment, "status">): boolean {
  return task.status === "submitted" || task.status === "completed";
}

/** 与 taskSemantics.isAssignmentPlanningEligible 同义；新代码优先用这个语义名。 */
export const isPlanningEligible = isActiveTask;

/** 本地日期 key "YYYY-MM-DD"（墙钟，不做 UTC 转换） */
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

/**
 * Deadline → Date（本地墙钟）。
 * - 完整时间：parseLocalDDL
 * - 仅有日期（旧数据）：当天 23:59:00（避免午夜误判逾期）
 */
export function getTaskDeadlineInstant(task: Pick<Assignment, "ddl">): Date | null {
  if (!task.ddl) return null;
  const raw = task.ddl.trim();
  if (LOCAL_DATE_RE.test(raw)) return parseLocalDDL(`${raw}T23:59:00`);
  return parseLocalDDL(raw);
}

/** active + 截止时刻已过 */
export function isTaskOverdue(task: Assignment, now: Date): boolean {
  if (!isActiveTask(task)) return false;
  const deadline = getTaskDeadlineInstant(task);
  return deadline !== null && deadline.getTime() < now.getTime();
}

/** active + 截止日期是今天（即使今天早些时候已过，仍可能为 true；分组时 overdue 优先） */
export function isDueToday(task: Assignment, now: Date): boolean {
  if (!isActiveTask(task)) return false;
  const deadline = getTaskDeadlineInstant(task);
  return deadline !== null && localDateKey(deadline) === localDateKey(now);
}

/** active + 未逾期 + 未来 1..warningDays 个日历日内 */
export function isDueSoon(task: Assignment, now: Date, warningDays: number): boolean {
  if (!isActiveTask(task)) return false;
  const deadline = getTaskDeadlineInstant(task);
  if (!deadline || deadline.getTime() <= now.getTime()) return false;
  const days = differenceInCalendarDays(deadline, now);
  return days > 0 && days <= warningDays;
}

/** active + doDate 是今天 */
export function isDoToday(task: Assignment, now: Date): boolean {
  return isActiveTask(task) && !!task.doDate && task.doDate === localDateKey(now);
}

/** active + doDate 落在给定周日期内 */
export function isDoInWeek(task: Assignment, weekDates: readonly string[]): boolean {
  return isActiveTask(task) && !!task.doDate && weekDates.includes(task.doDate);
}

/**
 * 学术完成时间：submittedAt 优先，其次 completedAt。
 * 用于 on-time / Review；旧数据缺失 → null（unknown，不伪造）。
 */
export function academicDoneAt(task: Pick<Assignment, "submittedAt" | "completedAt">): string | null {
  return task.submittedAt ?? task.completedAt ?? null;
}

/** 是否按时完成；无 DDL 或无学术完成时间 → null（不进分母） */
export function isAcademicDoneOnTime(
  task: Pick<Assignment, "submittedAt" | "completedAt" | "ddl">
): boolean | null {
  const doneAt = academicDoneAt(task);
  const deadline = getTaskDeadlineInstant(task);
  if (!doneAt || !deadline) return null;
  const done = parseLocalDDL(doneAt);
  if (!done) return null;
  return done.getTime() <= deadline.getTime();
}
