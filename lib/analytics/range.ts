/**
 * Analytics Range（Part 1）：
 * - week：本周一 00:00 → now；previous = 上周一 00:00 → 上周同 weekday/time offset（公平比较）
 * - 4weeks：最近 28 天 vs 紧邻之前 28 天
 * - semester：semester.startDate → now（超出学期 → end）；previous = null（不跨学期假同比）
 */

import { AnalyticsPeriod, AnalyticsPeriodWindow, AnalyticsRangePreset } from "@/lib/analytics/types";
import { addDays, addWeeks, parseISO } from "date-fns";

export const ANALYTICS_RANGE_PRESETS: AnalyticsRangePreset[] = ["week", "4weeks", "semester"];

function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 本周一 00:00（本地墙钟；周一为一周起始） */
export function mondayOfLocalWeek(ts: number): number {
  const d = new Date(startOfLocalDay(ts));
  const dow = d.getDay() === 0 ? 7 : d.getDay();
  d.setDate(d.getDate() - (dow - 1));
  return d.getTime();
}

/**
 * 解析分析周期。
 * week：current = 周一00:00 → now；previous = 上周一00:00 → 上周一00:00 + elapsed
 * （elapsed = now - 本周一00:00，保证与本周同 elapsed duration）
 */
export function resolveAnalyticsPeriod(
  preset: AnalyticsRangePreset,
  semester: { startDate: string; totalWeeks: number },
  now: number
): AnalyticsPeriod {
  if (preset === "week") {
    const thisMonday = mondayOfLocalWeek(now);
    const elapsed = now - thisMonday;
    // 用本地日历日加减，不用 7×86400000：DST 切换周不会把上周一算到周日 23:00
    const prevMonday = addDays(new Date(thisMonday), -7).getTime();
    return {
      preset,
      current: { from: thisMonday, to: now },
      previous: { from: prevMonday, to: prevMonday + elapsed },
      trendGrain: "day",
    };
  }

  if (preset === "4weeks") {
    const to = now;
    const currentFrom = addDays(new Date(to), -28).getTime();
    const previousFrom = addDays(new Date(currentFrom), -28).getTime();
    return {
      preset,
      current: { from: currentFrom, to },
      previous: { from: previousFrom, to: currentFrom },
      trendGrain: "week",
    };
  }

  // semester
  const start = parseISO(semester.startDate);
  const semesterStartDate = Number.isNaN(start.getTime()) ? new Date(now) : start;
  const semesterStart = semesterStartDate.getTime();
  // 学期结束估算：startDate + totalWeeks 周；同样按本地日历周计算（DST 安全）
  const semesterEnd = addWeeks(semesterStartDate, semester.totalWeeks).getTime();
  const to = Math.min(now, semesterEnd);
  const current: AnalyticsPeriodWindow =
    now <= semesterStart ? { from: semesterStart, to: semesterStart } : { from: semesterStart, to };
  return {
    preset,
    current,
    previous: null,
    trendGrain: "semester-week",
  };
}
