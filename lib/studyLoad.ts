import { CourseSchedule, ScheduleOccurrenceOverride } from "@/types";
import { Semester } from "@/types";
import { getSemesterWeek } from "@/lib/semester";
import { resolveCourseOccurrencesForWeek } from "@/lib/scheduleOccurrences";

const DAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function toHours(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return (h * 60 + m) / 60;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface WeekDayLoad {
  day: string;
  hours: number;
  /** 该教学周当天实际生效的 schedule 数量 */
  count: number;
}

export interface WeekCourseLoad {
  week: number;
  isInSemester: boolean;
  days: WeekDayLoad[];
  totalHours: number;
  /** 当前教学周实际生效的 schedule 总数 */
  totalSessions: number;
  /** totalHours / 7，保留 1 位小数 */
  averageHours: number;
  /** 最忙的一天（并列取第一个）；教学周外或全部为 0 时为 null */
  busiestDay: { day: string; hours: number } | null;
}

/**
 * 根据学期周次实际生效的课程统计周一至周日的时长/节数。
 *
 * 唯一事实源 = resolveCourseOccurrencesForWeek（与课表 / 冲突检测同一 resolver）：
 * - base：按周生效（weeks / 单双周 / excludedWeeks 尊重）
 * - extra 补课：计入当周
 * - move 调课：计入目标位（原位置不再计入）
 * - cancel 停课：当周不计入
 *
 * overrides 缺省为空 → 行为与纯 base 课表一致（向后兼容）。
 */
export function computeWeekCourseLoad(
  schedules: CourseSchedule[],
  semester: Semester,
  week?: number,
  overrides: ScheduleOccurrenceOverride[] = []
): WeekCourseLoad {
  const currentWeek = week ?? getSemesterWeek(new Date(), semester);
  const isInSemester = currentWeek >= 1 && currentWeek <= semester.totalWeeks;

  const empty = (): WeekCourseLoad => ({
    week: currentWeek,
    isInSemester,
    days: DAY_LABELS.map((day) => ({ day, hours: 0, count: 0 })),
    totalHours: 0,
    totalSessions: 0,
    averageHours: 0,
    busiestDay: null,
  });

  if (!isInSemester) return empty();

  const occurrences = resolveCourseOccurrencesForWeek({
    schedules,
    overrides,
    week: currentWeek,
    totalWeeks: semester.totalWeeks,
  });

  const days: WeekDayLoad[] = DAY_LABELS.map((day, idx) => {
    const dayOccurrences = occurrences.filter((o) => o.dayOfWeek === idx + 1);
    const hours = dayOccurrences.reduce(
      (sum, o) => sum + (toHours(o.endTime) - toHours(o.startTime)),
      0
    );
    return { day, hours: round1(hours), count: dayOccurrences.length };
  });

  const totalHours = round1(days.reduce((sum, d) => sum + d.hours, 0));
  const totalSessions = days.reduce((sum, d) => sum + d.count, 0);
  const averageHours = round1(totalHours / 7);

  let busiestDay: WeekCourseLoad["busiestDay"] = null;
  for (const d of days) {
    if (d.hours > 0 && (!busiestDay || d.hours > busiestDay.hours)) {
      busiestDay = { day: d.day, hours: d.hours };
    }
  }

  return { week: currentWeek, isInSemester, days, totalHours, totalSessions, averageHours, busiestDay };
}
