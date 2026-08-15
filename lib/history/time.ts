/**
 * Learning History 时间语义（Part 1）：
 * 全部本地墙钟；禁止 UTC 转换。
 */

import { Semester } from "@/types";
import { getSemesterWeek } from "@/lib/semester";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** epoch ms → 本地墙钟日期 "YYYY-MM-DD" */
export function localDateOf(occurredAt: number): string {
  const d = new Date(occurredAt);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** epoch ms → 本地时区偏移（分钟；Date.getTimezoneOffset 的符号与 UTC 差相反） */
export function timezoneOffsetMinutesOf(occurredAt: number): number {
  return -new Date(occurredAt).getTimezoneOffset();
}

/**
 * 事件发生时间所在教学周：
 * - 必须根据 occurredAt 计算（不用 currentSemesterWeek 解释历史）
 * - week < 1 或 week > totalWeeks → null（不 clamp）
 */
export function computeSemesterWeek(occurredAt: number, semester: Semester): number | null {
  const week = getSemesterWeek(new Date(occurredAt), semester);
  if (week < 1 || week > semester.totalWeeks) return null;
  return week;
}
