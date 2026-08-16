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
  AnalyticsReliability,
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
import { formatAnalyticsDuration, formatTrendBucketLabel } from "@/lib/analytics/presentation";

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
  /** false → 计划序列不完整，不输出 actualToPlanRatio（分母可能缺失） */
  planCoverageFull?: boolean;
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
    actualToPlanRatio:
      input.planCoverageFull !== false && plannedMinutes > 0
        ? Math.round((focusMinutes / plannedMinutes) * 100)
        : null,
    onTimeCount: execution.onTime,
    onTimeEligible: execution.onTimeEligible,
    onTimeRate: execution.onTimeRate,
  };
}

/** 中文时长（V3 统一口径；与 presentation.formatAnalyticsDuration 同源） */
export function formatDurationLabel(minutes: number): string {
  return formatAnalyticsDuration(minutes, "full");
}

/** 解析周期趋势 bucket 的 UI label（canonical key 只用于数据） */
export function trendBucketLabel(period: AnalyticsPeriod, key: string): string {
  return formatTrendBucketLabel(period, key);
}

const DAY_MS = 86400000;

function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function localDateOf(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function mondayOfLocalWeek(ts: number): number {
  const d = new Date(startOfLocalDay(ts));
  const dow = d.getDay() === 0 ? 7 : d.getDay();
  d.setDate(d.getDate() - (dow - 1));
  return d.getTime();
}

export interface TrendBucket {
  key: string;
  from: number;
  to: number;
}

/**
 * Canonical continuous buckets（Analytics V3）：
 * 由 Analytics Period 生成，事件只填值；某天/某周无事件不删除 bucket。
 * - week：current.from（周一 00:00）→ now，每天一个
 * - 4weeks：覆盖 [current.from, now] 的连续周（按本地周一锚定）
 * - semester：第 1 周 → 当前教学周（不生成未来周）
 */
export function generateTrendBuckets(period: AnalyticsPeriod): TrendBucket[] {
  const { current } = period;
  const buckets: TrendBucket[] = [];

  if (period.trendGrain === "day") {
    const start = startOfLocalDay(current.from);
    for (let t = start; t <= current.to; t += DAY_MS) {
      buckets.push({ key: localDateOf(t), from: t, to: Math.min(t + DAY_MS - 1, current.to) });
    }
    return buckets;
  }

  if (period.trendGrain === "week") {
    let t = mondayOfLocalWeek(current.from);
    while (t <= current.to) {
      buckets.push({ key: localDateOf(t), from: t, to: Math.min(t + 7 * DAY_MS - 1, current.to) });
      t += 7 * DAY_MS;
    }
    return buckets;
  }

  // semester-week：第 1 周 → 当前教学周（semester 预设下 current.from = 学期开始日）
  const semesterStart = current.from;
  const currentWeek = Math.max(1, Math.floor((current.to - semesterStart) / (7 * DAY_MS)) + 1);
  for (let w = 1; w <= currentWeek; w += 1) {
    const from = semesterStart + (w - 1) * 7 * DAY_MS;
    buckets.push({ key: `w${w}`, from, to: Math.min(from + 7 * DAY_MS - 1, current.to) });
  }
  return buckets;
}

/**
 * Continuous trend points：canonical buckets + 事件填充。
 * per-bucket reliability：bucket.from 早于该 metric 的 coverage 起点 → null（unknown，禁止补 0）。
 */
export function buildTrendPoints(input: {
  period: AnalyticsPeriod;
  focusByKey: Map<string, number>;
  planByKey: Map<string, number>;
  completedByKey: Map<string, number>;
  /** focus / assignment 的可靠起点（historyStartedAt） */
  focusCoverageFrom: number;
  /** plan 的可靠起点（planCoverageStartedAt） */
  planCoverageFrom: number;
}): LearningTrendPoint[] {
  const { period, focusByKey, planByKey, completedByKey, focusCoverageFrom, planCoverageFrom } = input;
  return generateTrendBuckets(period).map((bucket) => ({
    key: bucket.key,
    label: trendBucketLabel(period, bucket.key),
    focusMinutes:
      bucket.from >= focusCoverageFrom ? (focusByKey.get(bucket.key) ?? 0) : null,
    plannedMinutes:
      bucket.from >= planCoverageFrom ? (planByKey.get(bucket.key) ?? 0) : null,
    completedAssignments:
      bucket.from >= focusCoverageFrom ? (completedByKey.get(bucket.key) ?? 0) : null,
  }));
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

  // ---- Coverage（含 plan-specific + V3 metric-level reliability；先于 trend 计算）----
  const planCoverageStartedAt = Math.max(
    historyStartedAt,
    coverage?.studyBlockBatchIntegrityStartedAt ?? historyStartedAt
  );
  const planCoverageFull = currentFrom >= planCoverageStartedAt;

  const assignmentReliability: AnalyticsReliability = currentFrom >= historyStartedAt ? "complete" : "partial";
  const planReliability: AnalyticsReliability = currentFrom >= planCoverageStartedAt ? "complete" : "partial";
  // Focus：与 assignment 同起点（focus.completed 同属 Learning History）；
  // backfill 存在也不能证明完整起点（不声称 complete 之前的区间）
  const focusReliability: AnalyticsReliability = currentFrom >= historyStartedAt ? "complete" : "partial";
  const focusBackfilled = coverage?.focusBackfillCompleted === true;

  // ---- Planned minutes（current 周期）----
  const plannedMinutes = currentPlans.reduce((s, p) => s + p.plannedMinutes, 0);

  // ---- Trend（计划 vs 实际，按天/周/教学周聚合；canonical continuous buckets）----
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

  const trend = buildTrendPoints({
    period,
    focusByKey,
    planByKey,
    completedByKey,
    focusCoverageFrom: historyStartedAt,
    planCoverageFrom: planCoverageStartedAt,
  });

  // ---- Course investment ----
  // identity：courseId 存在 ≠ 未关联课程。snapshot 优先（取该 courseId 最近一个非空 snapshot）；
  // 真 unlinked（courseId undefined）聚合为唯一一条「未关联课程」。
  const courseAgg = new Map<string, { minutes: number; sessions: number; latestSnapshot: string | null; latestAt: number }>();
  for (const f of currentFocus) {
    const id = f.courseId ?? "__unlinked__";
    const v = courseAgg.get(id) ?? { minutes: 0, sessions: 0, latestSnapshot: null, latestAt: 0 };
    v.minutes += Math.round(f.actualActiveMs / 60000);
    v.sessions += 1;
    if (f.courseNameSnapshot && f.startedAt >= v.latestAt) {
      v.latestSnapshot = f.courseNameSnapshot;
      v.latestAt = f.startedAt;
    }
    courseAgg.set(id, v);
  }
  const totalCourseMinutes = Array.from(courseAgg.values()).reduce((s, v) => s + v.minutes, 0);
  const ranked = Array.from(courseAgg.entries())
    .map(([courseId, v]) => ({
      courseId: courseId === "__unlinked__" ? null : courseId,
      // 未关联课程：确定语义；linked 课程：snapshot 或 null（由 presentation 用 current name 兜底）
      courseName: courseId === "__unlinked__" ? "未关联课程" : v.latestSnapshot,
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
    // 计划分母可能缺失（batch history 在该区间不完整）→ 不输出伪精确 ratio
    planCoverageFull,
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
      planCoverageFull,
      planCoverageStartedAt,
      assignmentReliability,
      planReliability,
      focusReliability,
      focusBackfilled,
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
