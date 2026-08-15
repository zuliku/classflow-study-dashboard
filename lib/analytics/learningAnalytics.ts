/**
 * Analytics Snapshot 构建（Analytics V2）：
 * - 一次「查询事实」→ 派生所有 section（不让组件各查 IndexedDB）
 * - 纯 projection 函数输入 events；IndexedDB query 只在最顶层
 * - deterministic；tests 全部传 now
 */

import {
  AnalyticsPeriod,
  AnalyticsProjectionEvent,
  AnalyticsRangePreset,
  CourseInvestment,
  ExecutionAnalytics,
  FocusRhythm,
  LearningAnalyticsBuildInput,
  LearningAnalyticsSnapshot,
  LearningTrendPoint,
} from "@/lib/analytics/types";
import { resolveAnalyticsPeriod } from "@/lib/analytics/range";
import { projectStudyPlans } from "@/lib/analytics/studyPlanProjection";
import { projectAssignmentCompletions } from "@/lib/analytics/assignmentProjection";
import { aggregateFocusAnalytics, extractFocusFacts } from "@/lib/analytics/focusAnalytics";
import { buildLearningSignals } from "@/lib/analytics/signals";
import { collectLearningHistoryEvents, resolveLearningHistoryQuery, sortLearningHistoryEvents } from "@/lib/history/query";
import { getLearningHistoryCoverage } from "@/lib/history/store";

/** 事件 → projection 最小视图 */
function toProjectionEvent(e: {
  type: string;
  entityId: string;
  occurredAt: number;
  sequence: number;
  courseId?: string;
  courseNameSnapshot?: string;
  data: unknown;
}): AnalyticsProjectionEvent {
  return {
    type: e.type,
    entityId: e.entityId,
    occurredAt: e.occurredAt,
    sequence: e.sequence,
    courseId: e.courseId,
    courseNameSnapshot: e.courseNameSnapshot,
    data: e.data,
  };
}

/** 纯函数：从事实构建 overview（不含信号） */
export function buildOverviewFacts(input: {
  period: AnalyticsPeriod;
  focusMinutes: number;
  previousFocusMinutes: number | null;
  completedAssignments: number;
  plannedMinutes: number;
  execution: ExecutionAnalytics;
}): LearningAnalyticsSnapshot["overview"] {
  const { period, focusMinutes, previousFocusMinutes, completedAssignments, plannedMinutes, execution } = input;
  const focusDeltaPercent =
    previousFocusMinutes !== null && previousFocusMinutes >= 60
      ? Math.round(((focusMinutes - previousFocusMinutes) / previousFocusMinutes) * 100)
      : null;
  return {
    actualFocusMinutes: focusMinutes,
    actualFocusLabel: formatDurationLabel(focusMinutes),
    focusDeltaPercent,
    completedAssignments,
    plannedMinutes,
    plannedLabel: formatDurationLabel(plannedMinutes),
    actualToPlanRatio: plannedMinutes > 0 ? Math.round((focusMinutes / plannedMinutes) * 100) : null,
    onTimeCount: execution.onTime,
    onTimeEligible: execution.onTimeEligible,
    onTimeRate: execution.onTimeRate,
  };
}

export function formatDurationLabel(minutes: number): string {
  if (minutes <= 0) return "0m";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function buildTrendPoints(
  period: AnalyticsPeriod,
  focusByKey: Map<string, number>,
  planByKey: Map<string, number>,
  completedByKey: Map<string, number>
): LearningTrendPoint[] {
  // 按 trendGrain 生成连续 bucket（day=日期键；week=ISO-ish 周起点；semester-week=wN）
  const keySet = new Set<string>();
  for (const k of Array.from(focusByKey.keys())) keySet.add(k);
  for (const k of Array.from(planByKey.keys())) keySet.add(k);
  for (const k of Array.from(completedByKey.keys())) keySet.add(k);
  return Array.from(Array.from(keySet))
    .map((key) => ({
      key,
      label: key,
      focusMinutes: focusByKey.get(key) ?? 0,
      plannedMinutes: planByKey.get(key) ?? 0,
      completedAssignments: completedByKey.get(key) ?? 0,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export async function buildLearningAnalyticsSnapshot(
  input: LearningAnalyticsBuildInput
): Promise<LearningAnalyticsSnapshot> {
  const now = input.now ?? Date.now();
  const period = resolveAnalyticsPeriod(input.preset, input.semester, now);
  const coverage = await getLearningHistoryCoverage();
  const historyStartedAt = coverage?.historyStartedAt ?? now;

  const currentFrom = period.current.from;
  const previousFrom = period.previous?.from ?? null;
  const to = period.current.to;

  // Projection facts：historyStartedAt → to（实体可能更早创建但在本周期完成）
  const projectionFrom = Math.min(historyStartedAt, currentFrom);
  const projectionEvents = sortLearningHistoryEvents(
    await collectLearningHistoryEvents(
      resolveLearningHistoryQuery({
        from: projectionFrom,
        to,
        eventTypes: [
          "study_block.created",
          "study_block.updated",
          "study_block.deleted",
          "assignment.created",
          "assignment.deadline_changed",
          "assignment.completed",
          "assignment.reopened",
        ],
      })
    ),
    "asc"
  ).map(toProjectionEvent);

  // Focus facts：previous.from / current.from → to
  const focusFrom = previousFrom !== null ? previousFrom : currentFrom;
  const focusEvents = sortLearningHistoryEvents(
    await collectLearningHistoryEvents(
      resolveLearningHistoryQuery({ from: focusFrom, to, eventTypes: ["focus.completed"] })
    ),
    "asc"
  ).map(toProjectionEvent);

  // ---- Projections ----
  const planProjection = projectStudyPlans(projectionEvents);
  const assignmentProjection = projectAssignmentCompletions(projectionEvents);
  const focusFacts = extractFocusFacts(focusEvents);

  // 当前周期事实（按 scheduledStart / completedAt / startedAt 落在 current）
  const currentPlans = planProjection.maturedPlans.filter(
    (p) => p.scheduledStart >= currentFrom && p.scheduledStart <= to
  );
  const currentCompletions = assignmentProjection.completions.filter(
    (c) => c.completedAt >= currentFrom && c.completedAt <= to
  );
  const previousCompletions =
    previousFrom !== null
      ? assignmentProjection.completions.filter((c) => c.completedAt >= previousFrom && c.completedAt < currentFrom)
      : [];
  const currentFocus = focusFacts.filter((f) => f.startedAt >= currentFrom && f.startedAt <= to);
  const previousFocus =
    previousFrom !== null ? focusFacts.filter((f) => f.startedAt >= previousFrom && f.startedAt < currentFrom) : [];

  // ---- Focus aggregation（current 周期）----
  const focusAgg = aggregateFocusAnalytics(currentFocus);
  const previousFocusMinutes =
    previousFrom !== null && previousFocus.length > 0
      ? Math.round(previousFocus.reduce((s, f) => s + f.actualActiveMs, 0) / 60000)
      : null;

  // ---- Execution ----
  const onTime = currentCompletions.filter((c) => c.onTime === true).length;
  const late = currentCompletions.filter((c) => c.onTime === false).length;
  const onTimeEligible = currentCompletions.filter((c) => c.onTime !== null).length;
  const uniqueCompleted = new Set(currentCompletions.map((c) => c.entityId)).size;
  const reopenedIds = new Set(
    projectionEvents
      .filter((e) => e.type === "assignment.reopened" && e.occurredAt >= currentFrom && e.occurredAt <= to)
      .map((e) => e.entityId)
  ).size;
  const execution: ExecutionAnalytics = {
    uniqueCompletedAssignments: uniqueCompleted,
    reopenedAssignments: reopenedIds,
    onTime,
    late,
    onTimeEligible,
    onTimeRate: onTimeEligible > 0 ? Math.round((onTime / onTimeEligible) * 100) : null,
    activeDays: focusAgg.activeDays,
    avgFocusSessionMinutes: focusAgg.averageSessionMinutes,
  };

  // ---- Planned minutes（current 周期）----
  const plannedMinutes = currentPlans.reduce((s, p) => s + p.plannedMinutes, 0);

  // ---- Trend（计划 vs 实际，按天/周/教学周聚合）----
  const focusByKey = new Map<string, number>();
  const planByKey = new Map<string, number>();
  const completedByKey = new Map<string, number>();
  const grain = period.trendGrain;

  for (const f of currentFocus) {
    const key = grain === "day" ? f.startedLocalDate : grainKeyForStart(f.startedAt, grain, input.semester);
    focusByKey.set(key, (focusByKey.get(key) ?? 0) + Math.round(f.actualActiveMs / 60000));
  }
  for (const p of currentPlans) {
    const key = grain === "day" ? localDateOf(p.scheduledStart) : grainKeyForStart(p.scheduledStart, grain, input.semester);
    planByKey.set(key, (planByKey.get(key) ?? 0) + p.plannedMinutes);
  }
  for (const c of currentCompletions) {
    const key = grain === "day" ? localDateOf(c.completedAt) : grainKeyForStart(c.completedAt, grain, input.semester);
    completedByKey.set(key, (completedByKey.get(key) ?? 0) + 1);
  }

  const trend = buildTrendPoints(period, focusByKey, planByKey, completedByKey);

  // ---- Course investment ----
  const courseAgg = new Map<string, { minutes: number; sessions: number; name: string }>();
  for (const f of currentFocus) {
    const id = f.courseId ?? "__unlinked__";
    const v = courseAgg.get(id) ?? { minutes: 0, sessions: 0, name: f.courseNameSnapshot ?? "未关联课程" };
    v.minutes += Math.round(f.actualActiveMs / 60000);
    v.sessions += 1;
    courseAgg.set(id, v);
  }
  const totalCourseMinutes = Array.from(courseAgg.values()).reduce((s, v) => s + v.minutes, 0);
  const ranked = Array.from(courseAgg.entries())
    .map(([courseId, v]) => ({
      courseId: courseId === "__unlinked__" ? null : courseId,
      courseName: v.name,
      minutes: v.minutes,
      sessions: v.sessions,
      share: totalCourseMinutes > 0 ? v.minutes / totalCourseMinutes : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes);

  // ---- Focus rhythm ----
  const focusRhythm: FocusRhythm = {
    byTimeOfDay: focusAgg.byTimeOfDay,
    activeDays: focusAgg.activeDays,
    averageSessionMinutes: focusAgg.averageSessionMinutes,
    longestSessionMinutes: focusAgg.longestSessionMinutes,
    dominantTimeOfDay: focusAgg.dominantTimeOfDay,
  };

  // ---- Coverage ----
  const fullCoverage = currentFrom >= historyStartedAt;
  const comparisonAvailable =
    previousFrom !== null &&
    previousFrom >= historyStartedAt &&
    previousCompletions.length + previousFocus.length > 0;
  // comparisonAvailable 由 history 覆盖决定（previous.from >= startedAt）；事件为空时也视为不可比
  const comparisonAvailableFinal =
    comparisonAvailable && (previousFocus.length > 0 || previousCompletions.length > 0);

  // ---- Overview ----
  const overview = buildOverviewFacts({
    period,
    focusMinutes: focusAgg.totalFocusMinutes,
    previousFocusMinutes,
    completedAssignments: execution.uniqueCompletedAssignments,
    plannedMinutes,
    execution,
  });

  const isEmpty =
    focusAgg.totalFocusMinutes === 0 &&
    execution.uniqueCompletedAssignments === 0 &&
    plannedMinutes === 0 &&
    currentCompletions.length === 0;

  const snapshotWithoutSignals: LearningAnalyticsSnapshot = {
    period,
    coverage: {
      fullCoverage,
      comparisonAvailable: comparisonAvailableFinal,
      historyStartedAt,
    },
    overview,
    trend,
    courseInvestment: ranked,
    focusRhythm,
    execution,
    signals: [],
    isEmpty,
  };

  const signals = buildLearningSignals(snapshotWithoutSignals, {
    previousFocusMinutes,
    plannedMinutes,
  });

  return { ...snapshotWithoutSignals, signals };
}

function grainKeyForStart(
  ts: number,
  grain: "day" | "week" | "semester-week",
  semester: { startDate: string }
): string {
  if (grain === "day") return localDateOf(ts);
  if (grain === "week") {
    // 近 4 周按「周起始日」分桶（本地周一）
    const d = new Date(ts);
    const dow = d.getDay() === 0 ? 7 : d.getDay();
    d.setDate(d.getDate() - (dow - 1));
    return localDateOf(d.getTime());
  }
  // semester-week：以学期 startDate 为基准计算周数
  const start = new Date(`${semester.startDate}T00:00:00`);
  const target = new Date(ts);
  const week = Math.floor((target.getTime() - start.getTime()) / (7 * 86400000)) + 1;
  return `w${Math.max(week, 1)}`;
}

function localDateOf(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
