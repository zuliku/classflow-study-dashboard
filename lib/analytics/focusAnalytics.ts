/**
 * Focus Analytics（Analytics V2）：
 * - 只累计 focus.completed.actualActiveMs（不用 planned / wall-clock 推算）
 * - 每日归属 = focus.data.startedAt 的本地日期（跨午夜不拆分）
 * - 时段 = startedAt 小时；activeDays = started localDate 去重
 */

import { LearningTrendPoint } from "@/lib/analytics/types";
import { AnalyticsProjectionEvent } from "@/lib/analytics/types";

export interface FocusCompletionFact {
  sessionId: string;
  startedAt: number;
  startedLocalDate: string;
  actualActiveMs: number;
  plannedMinutes: number;
  courseId?: string;
  courseNameSnapshot?: string;
}

export function focusStartHour(ts: number): number {
  return new Date(ts).getHours();
}

/** 时段划分：深夜 00–05 / 上午 05–12 / 下午 12–18 / 晚间 18–24 */
export function focusTimeOfDay(hour: number): "深夜" | "上午" | "下午" | "晚间" {
  if (hour < 5) return "深夜";
  if (hour < 12) return "上午";
  if (hour < 18) return "下午";
  return "晚间";
}

function localDateOf(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 纯函数：抽取 focus.completed 事实（实际分钟 = actualActiveMs，归属 startedAt 日） */
export function extractFocusFacts(events: AnalyticsProjectionEvent[]): FocusCompletionFact[] {
  const facts: FocusCompletionFact[] = [];
  for (const e of events) {
    if (e.type !== "focus.completed") continue;
    const data = e.data as { actualActiveMs?: number; startedAt?: number; plannedMinutes?: number };
    if (typeof data.actualActiveMs !== "number" || typeof data.startedAt !== "number") continue;
    facts.push({
      sessionId: e.entityId,
      startedAt: data.startedAt,
      startedLocalDate: localDateOf(data.startedAt),
      actualActiveMs: data.actualActiveMs,
      plannedMinutes: typeof data.plannedMinutes === "number" ? data.plannedMinutes : 0,
      courseId: e.courseId,
      courseNameSnapshot: e.courseNameSnapshot,
    });
  }
  return facts;
}

export interface FocusTrendResult {
  /** key = localDate（每日一个点；无数据的天不出现） */
  points: LearningTrendPoint[];
  totalFocusMinutes: number;
  activeDays: number;
  averageSessionMinutes: number | null;
  longestSessionMinutes: number;
  byTimeOfDay: { bucket: "深夜" | "上午" | "下午" | "晚间"; minutes: number; sessions: number }[];
  dominantTimeOfDay: "深夜" | "上午" | "下午" | "晚间" | null;
}

export function aggregateFocusAnalytics(facts: FocusCompletionFact[]): FocusTrendResult {
  const byDay = new Map<string, { focusMinutes: number; completed: number }>();
  const byBucket = new Map<string, { minutes: number; sessions: number }>();
  const activeDates = new Set<string>();
  let totalMs = 0;
  let sessions = 0;
  let longest = 0;

  for (const f of facts) {
    const minutes = Math.round(f.actualActiveMs / 60000);
    totalMs += f.actualActiveMs;
    sessions += 1;
    longest = Math.max(longest, f.actualActiveMs);
    activeDates.add(f.startedLocalDate);

    const day = byDay.get(f.startedLocalDate) ?? { focusMinutes: 0, completed: 0 };
    day.focusMinutes += minutes;
    day.completed += 1;
    byDay.set(f.startedLocalDate, day);

    const bucket = focusTimeOfDay(focusStartHour(f.startedAt));
    const b = byBucket.get(bucket) ?? { minutes: 0, sessions: 0 };
    b.minutes += minutes;
    b.sessions += 1;
    byBucket.set(bucket, b);
  }

  const points: LearningTrendPoint[] = Array.from(byDay.entries())
    .map(([key, v]) => ({ key, label: key, focusMinutes: v.focusMinutes, plannedMinutes: 0, completedAssignments: 0 }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const totalFocusMinutes = Math.round(totalMs / 60000);
  const byTimeOfDay = (["深夜", "上午", "下午", "晚间"] as const).map((bucket) => {
    const v = byBucket.get(bucket) ?? { minutes: 0, sessions: 0 };
    return { bucket, minutes: v.minutes, sessions: v.sessions };
  });

  let dominantTimeOfDay: "深夜" | "上午" | "下午" | "晚间" | null = null;
  if (sessions >= 5 && totalFocusMinutes >= 120) {
    let best = null as { bucket: string; minutes: number } | null;
    for (const b of byTimeOfDay) {
      if (!best || b.minutes > best.minutes) best = b;
    }
    if (best && best.minutes > 0) dominantTimeOfDay = best.bucket as "深夜" | "上午" | "下午" | "晚间";
  }

  return {
    points,
    totalFocusMinutes,
    activeDays: activeDates.size,
    averageSessionMinutes: sessions > 0 ? Math.round(totalMs / sessions / 60000) : null,
    longestSessionMinutes: Math.round(longest / 60000),
    byTimeOfDay,
    dominantTimeOfDay,
  };
}
