import { CourseSchedule } from "@/types";
import { isScheduleActive, timeToMinutes } from "@/lib/schedule";

/**
 * 课程工作区「本周下一节」纯 UI helper（Task 2 Phase C / Task 3A 修正）：
 * 在 currentSemesterWeek 内、isScheduleActive 有效的课次中，找出尚未开始的下一节。
 * - 只看本周（跨周安排不做猜测，避免显示错误日期）
 * - 排序键 = dayOfWeek * 1440 + startMinutes（先星期、后时间，杜绝"周五 08:00 排在周二 14:00 前"）
 * - 正在进行的课不算「下一节」
 * - 教学周越界（week < 1 或 > totalWeeks）→ null（单双周规则在周 0 上会误判）
 * - 找不到 → null（显示「本周无后续课程」）
 */
export interface NextCourseSession {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  location: string;
}

export function deriveNextCourseSession(
  courseId: string,
  schedules: CourseSchedule[],
  currentSemesterWeek: number,
  totalWeeks: number,
  now: Date = new Date()
): NextCourseSession | null {
  if (currentSemesterWeek < 1 || currentSemesterWeek > totalWeeks) return null;

  const nowDayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const upcoming = schedules
    .filter((s) => s.courseId === courseId && isScheduleActive(s, currentSemesterWeek))
    .sort((a, b) => {
      const keyA = a.dayOfWeek * 1440 + (timeToMinutes(a.startTime) ?? 0);
      const keyB = b.dayOfWeek * 1440 + (timeToMinutes(b.startTime) ?? 0);
      return keyA - keyB;
    })
    .find((s) => {
      const startMinutes = timeToMinutes(s.startTime) ?? 0;
      return s.dayOfWeek > nowDayOfWeek || (s.dayOfWeek === nowDayOfWeek && startMinutes > nowMinutes);
    });

  if (!upcoming) return null;
  return {
    dayOfWeek: upcoming.dayOfWeek,
    startTime: upcoming.startTime,
    endTime: upcoming.endTime,
    location: upcoming.location,
  };
}
