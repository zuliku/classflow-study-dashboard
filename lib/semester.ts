import { addDays, addWeeks, differenceInCalendarDays, format, parseISO, startOfWeek } from "date-fns";
import { Semester } from "@/types";

/**
 * 按项目"动态演示日期"思路生成默认学期：
 * 开学日期 = 本周周一，因此"第 1 周"即现实中的本周。
 */
export function createDefaultSemester(now: Date = new Date()): Semester {
  const monday = startOfWeek(now, { weekStartsOn: 1 });
  return {
    id: "sem_demo",
    name: `${now.getFullYear()}年${getSeasonLabel(now)}`,
    startDate: format(monday, "yyyy-MM-dd"),
    totalWeeks: 16,
  };
}

function getSeasonLabel(date: Date): string {
  const month = date.getMonth() + 1;
  if (month >= 2 && month <= 7) return "春季学期";
  if (month >= 8 && month <= 12) return "秋季学期";
  return "冬季学期";
}

/**
 * 计算某个日期属于学期第几周（可能超出 [1, totalWeeks]，
 * 调用方需自行判断是否处于学期范围内）。
 */
export function getSemesterWeek(date: Date | string, semester: Semester): number {
  const target = typeof date === "string" ? parseISO(date) : date;
  const start = parseISO(semester.startDate);
  return Math.floor(differenceInCalendarDays(target, start) / 7) + 1;
}

/** 学期第 week 周的周一（周一为一周起始）。 */
export function getWeekStart(semester: Semester, week: number): Date {
  return addWeeks(parseISO(semester.startDate), week - 1);
}

/** 学期第 week 周的周一至周日 7 个日期。 */
export function getWeekDateRange(semester: Semester, week: number): Date[] {
  const monday = getWeekStart(semester, week);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** 第 week 周所在的日期范围文案，如 "8月3日 - 8月9日"。 */
export function formatWeekDateRange(semester: Semester, week: number): string {
  const days = getWeekDateRange(semester, week);
  return `${format(days[0], "M月d日")} - ${format(days[6], "M月d日")}`;
}

/** 学期结束日（不含）= 开学日 + totalWeeks 周；结束日期永远推导，不持久化。 */
export function getSemesterEndDate(
  startDate: string | Date,
  totalWeeks: number
): Date {
  const start = typeof startDate === "string" ? parseISO(startDate) : startDate;
  return addWeeks(start, totalWeeks);
}

/** 当前真实教学周（可能超出 [1, totalWeeks]） */
export function getCurrentSemesterWeek(semester: Semester, now: Date = new Date()): number {
  return getSemesterWeek(now, semester);
}
