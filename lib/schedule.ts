import { CourseSchedule } from "@/types";
import { parseWeekExpression, isWeekActive } from "@/lib/scheduleWeekExpression";

/** 周次规则预设（新增/编辑排课时共享） */
export const WEEK_RANGE_PRESETS: { label: string; value: string }[] = [
  { label: "1-16周 (全学期)", value: "1-16周" },
  { label: "1-8周 (前半学期)", value: "1-8周" },
  { label: "9-16周 (后半学期)", value: "9-16周" },
  { label: "单周 (1,3,5,7,9...)", value: "单周" },
  { label: "双周 (2,4,6,8,10...)", value: "双周" },
];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:mm" → 分钟数；格式非法返回 null */
export function timeToMinutes(timeStr: string): number | null {
  const m = TIME_RE.exec(timeStr);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 时间格式合法且结束时间晚于开始时间 */
export function isValidTimeRange(startTime: string, endTime: string): boolean {
  const s = timeToMinutes(startTime);
  const e = timeToMinutes(endTime);
  return s !== null && e !== null && e > s;
}

/** 时间区间是否重叠：[aStart, aEnd) 与 [bStart, bEnd) 有交集 */
export function hasTimeOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): boolean {
  const as = timeToMinutes(aStart);
  const ae = timeToMinutes(aEnd);
  const bs = timeToMinutes(bStart);
  const be = timeToMinutes(bEnd);
  if (as === null || ae === null || bs === null || be === null) return false;
  return as < be && bs < ae;
}

/**
 * 判断课程在某教学周是否生效（所有课程周次判断的唯一入口）。
 * 周次语义统一由 lib/scheduleWeekExpression.ts 解析：
 * 支持 "1-16周" / "1-8周" / "9-16周" / "单周" / "双周" /
 * 多段 "1-5,7-17" / "1-4,6-7,9-17" / 枚举 "1,3,5,7" / 中文逗号 等。
 * excludedWeeks（临时停课/排除）优先于原始教学周规则。
 * 无法解析的表达式按旧语义回退为全学期生效。
 */
export function isScheduleActive(schedule: CourseSchedule, week: number): boolean {
  if (schedule.excludedWeeks && schedule.excludedWeeks.includes(week)) {
    return false;
  }

  const weeksStr = schedule.weeks || "1-16周";
  const parsed = parseWeekExpression(weeksStr);
  return isWeekActive(parsed, week);
}
