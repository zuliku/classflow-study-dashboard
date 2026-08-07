import { CourseSchedule, ScheduleConflict } from "@/types";
import { isScheduleActive } from "@/store/useAppStore";

const WEEK_DEFAULT_MAX = 16;

function timeToMinutes(timeStr: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeStr);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
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

function getMaxWeek(schedule: CourseSchedule): number {
  const m = /(\d+)\s*-\s*(\d+)/.exec(schedule.weeks || "");
  if (m) return Math.max(Number(m[1]), Number(m[2]));
  return WEEK_DEFAULT_MAX;
}

/** 两门课是否至少存在一个共同生效教学周（如 1-8周 与 9-16周 不冲突） */
export function sharesActiveWeek(a: CourseSchedule, b: CourseSchedule): boolean {
  const maxWeek = Math.max(getMaxWeek(a), getMaxWeek(b), WEEK_DEFAULT_MAX);
  for (let week = 1; week <= maxWeek; week++) {
    if (isScheduleActive(a, week) && isScheduleActive(b, week)) return true;
  }
  return false;
}

/**
 * 统一冲突定义：星期相同 + 时间区间重叠 + 至少一个共同生效教学周。
 * TimetableGrid 与导入器共用同一套冲突判定。
 */
export function findScheduleConflicts(
  schedules: CourseSchedule[]
): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];

  for (let i = 0; i < schedules.length; i++) {
    for (let j = i + 1; j < schedules.length; j++) {
      const a = schedules[i];
      const b = schedules[j];
      if (a.dayOfWeek !== b.dayOfWeek) continue;
      if (!hasTimeOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) continue;
      if (!sharesActiveWeek(a, b)) continue;

      conflicts.push({
        scheduleA: a,
        scheduleB: b,
        dayOfWeek: a.dayOfWeek,
        timeRange: `${a.startTime}-${a.endTime}`,
      });
    }
  }

  return conflicts;
}
