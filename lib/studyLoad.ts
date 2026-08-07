import { CourseSchedule } from "@/types";
import { Semester } from "@/types";
import { getSemesterWeek } from "@/lib/semester";
import { isScheduleActive } from "@/lib/schedule";

const DAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function toHours(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return (h * 60 + m) / 60;
}

export interface WeekCourseLoad {
  week: number;
  isInSemester: boolean;
  days: { day: string; hours: number }[];
  totalHours: number;
}

/**
 * 根据学期周次实际生效的 schedule（isScheduleActive 唯一入口），
 * 用 endTime - startTime 计算周一至周日每天的课程时长与本周总时长。
 */
export function computeWeekCourseLoad(
  schedules: CourseSchedule[],
  semester: Semester,
  week?: number
): WeekCourseLoad {
  const currentWeek = week ?? getSemesterWeek(new Date(), semester);
  const isInSemester = currentWeek >= 1 && currentWeek <= semester.totalWeeks;

  if (!isInSemester) {
    return {
      week: currentWeek,
      isInSemester,
      days: DAY_LABELS.map((day) => ({ day, hours: 0 })),
      totalHours: 0,
    };
  }

  const days = DAY_LABELS.map((day, idx) => {
    const daySchedules = schedules.filter(
      (s) => s.dayOfWeek === idx + 1 && isScheduleActive(s, currentWeek)
    );
    const hours = daySchedules.reduce(
      (sum, s) => sum + (toHours(s.endTime) - toHours(s.startTime)),
      0
    );
    return { day, hours: Math.round(hours * 10) / 10 };
  });

  const totalHours = Math.round(days.reduce((sum, d) => sum + d.hours, 0) * 10) / 10;

  return { week: currentWeek, isInSemester, days, totalHours };
}
