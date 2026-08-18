import { CourseSchedule, ScheduleConflict } from "@/types";
import { isScheduleActive, hasTimeOverlap } from "@/lib/schedule";
import { parseWeekExpression, getMaxActiveWeek } from "@/lib/scheduleWeekExpression";

/** 两门课是否至少存在一个共同生效教学周（如 1-5,7-17 与 6 周课程不冲突） */
export function sharesActiveWeek(a: CourseSchedule, b: CourseSchedule): boolean {
  const pa = parseWeekExpression(a.weeks);
  const pb = parseWeekExpression(b.weeks);
  const maxWeek = Math.max(getMaxActiveWeek(pa), getMaxActiveWeek(pb), 16);
  for (let week = 1; week <= maxWeek; week++) {
    if (isScheduleActive(a, week) && isScheduleActive(b, week)) return true;
  }
  return false;
}

/**
 * 统一冲突定义：星期相同 + 时间区间重叠 + 至少一个共同生效教学周。
 * TimetableGrid 与导入器共用同一套冲突判定。
 *
 * options.ignoreSameCourse：忽略同一门课程（courseId 相同）内部时段之间的重叠——
 * 用于课表拖动/编辑/详情等"某门课卡片内部调整"场景：同课程多节时段（如连堂、补课）
 * 重叠属于该课程自身的安排，不应与"与其它课程冲突"混淆。
 * 导入器 / 新增课程保持默认 false（跨记录校验语义不变）。
 */
export function findScheduleConflicts(
  schedules: CourseSchedule[],
  options?: { ignoreSameCourse?: boolean }
): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];

  for (let i = 0; i < schedules.length; i++) {
    for (let j = i + 1; j < schedules.length; j++) {
      const a = schedules[i];
      const b = schedules[j];
      if (a.dayOfWeek !== b.dayOfWeek) continue;
      if (!hasTimeOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) continue;
      if (!sharesActiveWeek(a, b)) continue;
      if (options?.ignoreSameCourse && a.courseId === b.courseId) continue;

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
