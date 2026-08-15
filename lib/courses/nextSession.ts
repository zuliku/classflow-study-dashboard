import { CourseSchedule } from "@/types";
import { isScheduleActive, timeToMinutes } from "@/lib/schedule";

/**
 * 课程工作区「下一节」纯 UI helper（Task 2 Phase C）：
 * 在 currentSemesterWeek 内、isScheduleActive 有效的课次中，找出尚未开始的下一节。
 * - 只看本周（跨周安排不做猜测，避免显示错误日期）
 * - 正在进行的课不算「下一节」
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
  now: Date = new Date()
): NextCourseSession | null {
  const nowDayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const upcoming = schedules
    .filter((s) => s.courseId === courseId && isScheduleActive(s, currentSemesterWeek))
    .sort((a, b) => (timeToMinutes(a.startTime) ?? 0) - (timeToMinutes(b.startTime) ?? 0))
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
