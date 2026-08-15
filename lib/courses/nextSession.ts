import { CourseSchedule, ScheduleOccurrenceOverride } from "@/types";
import { resolveCourseOccurrencesForWeek } from "@/lib/scheduleOccurrences";

/**
 * 课程工作区「本周下一节」纯 UI helper（Task 2 Phase C / Task 3A / Task 7）：
 * 在 currentSemesterWeek 内找出该课程尚未开始的下一节。
 * - 只看本周（跨周安排不做猜测，避免显示错误日期）
 * - 排序键 = dayOfWeek * 1440 + startMinutes（先星期、后时间，杜绝"周五 08:00 排在周二 14:00 前"）
 * - 正在进行的课不算「下一节」
 * - 教学周越界（week < 1 或 > totalWeeks）→ null
 * - Task 7：基于 effective occurrences（cancel 消失 / move 显示目标位 / extra 出现）
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
  now: Date = new Date(),
  overrides: ScheduleOccurrenceOverride[] = []
): NextCourseSession | null {
  if (currentSemesterWeek < 1 || currentSemesterWeek > totalWeeks) return null;

  const nowDayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const occurrences = resolveCourseOccurrencesForWeek({
    schedules,
    overrides,
    week: currentSemesterWeek,
    totalWeeks,
  });

  const upcoming = occurrences
    .filter((o) => o.courseId === courseId)
    .sort((a, b) => {
      const keyA = a.dayOfWeek * 1440 + (timeToMinutes(a.startTime) ?? 0);
      const keyB = b.dayOfWeek * 1440 + (timeToMinutes(b.startTime) ?? 0);
      return keyA - keyB;
    })
    .find((o) => {
      const startMinutes = timeToMinutes(o.startTime) ?? 0;
      return o.dayOfWeek > nowDayOfWeek || (o.dayOfWeek === nowDayOfWeek && startMinutes > nowMinutes);
    });

  if (!upcoming) return null;
  return {
    dayOfWeek: upcoming.dayOfWeek,
    startTime: upcoming.startTime,
    endTime: upcoming.endTime,
    location: upcoming.location,
  };
}

function timeToMinutes(timeStr: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(timeStr);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}
