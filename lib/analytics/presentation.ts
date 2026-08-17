/**
 * Analytics V3 — Presentation / View 层（纯函数，无 React / 无 IndexedDB）。
 * 职责：
 * - 统一中文 duration 口径（页面内禁止 7h 24m 混排）
 * - Unknown ≠ Zero 的 metric 呈现（partial → 「已记录」/「—」，绝不假装完整 0）
 * - Course Investment 显示名解析（snapshot → current name → 已删除课程 → 未关联课程）
 * - Top 5 + Other 折叠
 * - Trend bucket 的 UI label 投影（canonical key 只用于数据）
 */

import {
  AnalyticsReliability,
  AnalyticsPeriod,
  CourseInvestment,
  ExecutionAnalytics,
} from "@/lib/analytics/types";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";

// ---------------- Duration ----------------

/**
 * 统一中文时长：
 * full：0 → 「0 分钟」；45 → 「45 分钟」；60 → 「1 小时」；88 → 「1 小时 28 分」
 * compact：45 → 「45分」；60 → 「1时」；88 → 「1时28分」
 */
export function formatAnalyticsDuration(
  minutes: number,
  mode: "full" | "compact" = "full"
): string {
  const safe = Math.max(0, Math.round(minutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  if (h === 0) {
    if (m === 0) return mode === "full" ? "0 分钟" : "0分";
    return mode === "full" ? `${m} 分钟` : `${m}分`;
  }
  if (m === 0) return mode === "full" ? `${h} 小时` : `${h}时`;
  return mode === "full" ? `${h} 小时 ${m} 分` : `${h}时${m}分`;
}

// ---------------- Metric presentation（Unknown ≠ Zero） ----------------

export interface AnalyticsMetricView {
  value: string;
  detail?: string;
  reliability: AnalyticsReliability;
}

/** Focus：complete+0 → 0 分钟；partial+>0 → 实际已记录值；partial+0 → — */
export function presentFocusMetric(
  focusMinutes: number,
  reliability: AnalyticsReliability
): AnalyticsMetricView {
  if (reliability === "complete") {
    return { value: formatAnalyticsDuration(focusMinutes), reliability };
  }
  // partial
  if (focusMinutes > 0) {
    return {
      value: formatAnalyticsDuration(focusMinutes),
      detail: "已记录 · 当前区间可能不完整",
      reliability,
    };
  }
  return { value: "—", detail: "该区间记录不完整", reliability };
}

/** Completed：complete → N 项；partial+N>0 → 已记录 N 项；partial+0 → — */
export function presentCompletedMetric(
  count: number,
  reliability: AnalyticsReliability
): AnalyticsMetricView {
  if (reliability === "complete") {
    return { value: `${count} 项`, reliability };
  }
  if (count > 0) {
    return { value: `已记录 ${count} 项`, detail: "当前区间可能不完整", reliability };
  }
  return { value: "—", detail: "该区间记录不完整", reliability };
}

/** Plan total：complete → 正常；partial → 已记录 X / — */
export function presentPlanMetric(
  plannedMinutes: number,
  reliability: AnalyticsReliability
): AnalyticsMetricView {
  if (reliability === "complete") {
    return { value: formatAnalyticsDuration(plannedMinutes), reliability };
  }
  if (plannedMinutes > 0) {
    return { value: `已记录 ${formatAnalyticsDuration(plannedMinutes)}`, detail: "当前区间可能不完整", reliability };
  }
  return { value: "—", detail: "该区间记录不完整", reliability };
}

/** Plan Execution ratio：complete+planned>0 → % + 实际/计划；planned=0 → —；partial → — */
export function presentPlanExecutionMetric(
  actualMinutes: number,
  plannedMinutes: number,
  reliability: AnalyticsReliability
): AnalyticsMetricView {
  if (reliability !== "complete" || plannedMinutes <= 0) {
    return {
      value: "—",
      detail: reliability !== "complete" ? "计划记录不完整" : "本周期暂无已到时间的学习计划",
      reliability: reliability === "complete" ? "unavailable" : reliability,
    };
  }
  const ratio = Math.round((actualMinutes / plannedMinutes) * 100);
  return {
    value: `${ratio}%`,
    detail: `实际 ${formatAnalyticsDuration(actualMinutes)} / 计划 ${formatAnalyticsDuration(plannedMinutes)}`,
    reliability: "complete",
  };
}

/** On-time：仅 assignment coverage complete 且 eligible>0 时显示 rate；否则 — */
export function presentOnTimeMetric(
  onTimeRate: number | null,
  onTimeCount: number,
  onTimeEligible: number,
  assignmentReliability: AnalyticsReliability
): AnalyticsMetricView {
  if (assignmentReliability !== "complete") {
    return { value: "—", detail: "任务历史不完整，暂不判断按时率", reliability: "partial" };
  }
  if (onTimeEligible <= 0 || onTimeRate === null) {
    return { value: "—", detail: "暂无可靠截止时间可判断", reliability: "unavailable" };
  }
  return {
    value: `${onTimeRate}%`,
    detail:
      onTimeEligible < 3
        ? `样本不足 · ${onTimeEligible} 个可判断任务`
        : `${onTimeCount} / ${onTimeEligible} 个可判断任务按时完成`,
    reliability: "complete",
  };
}

// ---------------- Execution Quality ----------------

export interface ExecutionMetricView {
  label: string;
  value: string;
  detail?: string;
  reliability: AnalyticsReliability;
}

export interface ExecutionQualityView {
  completed: ExecutionMetricView;
  reopened: ExecutionMetricView;
  onTime: ExecutionMetricView;
  activeDays: ExecutionMetricView;
  avgFocusSession: ExecutionMetricView;
}

/**
 * 执行情况纯投影（V3.1）：assignment 派生指标只受 assignmentReliability 控制，
 * focus 派生指标只受 focusReliability 控制；partial 下绝不显示伪精确值。
 */
export function presentExecutionQuality(
  execution: ExecutionAnalytics,
  assignmentReliability: AnalyticsReliability,
  focusReliability: AnalyticsReliability
): ExecutionQualityView {
  const assignmentDetail = "该区间任务历史不完整";
  const completed: ExecutionMetricView =
    assignmentReliability === "complete"
      ? { label: "完成任务", value: `${execution.uniqueCompletedAssignments} 项`, reliability: "complete" }
      : execution.uniqueCompletedAssignments > 0
        ? { label: "完成任务", value: `已记录 ${execution.uniqueCompletedAssignments} 项`, detail: assignmentDetail, reliability: "partial" }
        : { label: "完成任务", value: "—", detail: assignmentDetail, reliability: "partial" };

  const reopened: ExecutionMetricView =
    assignmentReliability === "complete"
      ? { label: "重新打开", value: `${execution.reopenedAssignments} 项`, reliability: "complete" }
      : execution.reopenedAssignments > 0
        ? { label: "重新打开", value: `已记录 ${execution.reopenedAssignments} 项`, detail: assignmentDetail, reliability: "partial" }
        : { label: "重新打开", value: "—", detail: assignmentDetail, reliability: "partial" };

  const onTime: ExecutionMetricView = {
    label: "按时完成",
    ...presentOnTimeMetric(execution.onTimeRate, execution.onTime, execution.onTimeEligible, assignmentReliability),
  };

  const activeDays: ExecutionMetricView =
    focusReliability === "complete"
      ? { label: "活跃天数", value: `${execution.activeDays} 天`, reliability: "complete" }
      : execution.activeDays > 0
        ? { label: "活跃天数", value: `已记录 ${execution.activeDays} 天`, detail: "该区间专注记录可能不完整", reliability: "partial" }
        : { label: "活跃天数", value: "—", detail: "该区间专注记录不完整", reliability: "partial" };

  const avgFocusSession: ExecutionMetricView =
    focusReliability === "complete"
      ? {
          label: "平均专注",
          value: execution.avgFocusSessionMinutes !== null ? `${execution.avgFocusSessionMinutes} 分钟/次` : "—",
          reliability: "complete",
        }
      : execution.avgFocusSessionMinutes !== null
        ? { label: "平均专注", value: `已记录平均 ${execution.avgFocusSessionMinutes} 分钟/次`, detail: "该区间专注记录可能不完整", reliability: "partial" }
        : { label: "平均专注", value: "—", detail: "该区间专注记录不完整", reliability: "partial" };

  return { completed, reopened, onTime, activeDays, avgFocusSession };
}

// ---------------- Summary Strip divider contract ----------------

/**
 * Summary Strip / Skeleton 共用的 2×2 / 4 列 divider 规则：
 * - mobile/tablet 2×2：第 2、4 格左侧分隔；第 3、4 格顶部
 * - desktop 4 列：除首格外全左侧分隔，去掉顶部
 */
export function summaryCellDividerClasses(index: number): string {
  return [
    "min-w-0 px-4 py-3.5 flex flex-col justify-center gap-0.5",
    (index === 1 || index === 3) && "border-l border-line-soft",
    index >= 2 && "border-t border-line-soft",
    index > 0 && "lg:border-l lg:border-line-soft",
    index >= 2 && "lg:border-t-0",
  ]
    .filter(Boolean)
    .join(" ");
}

// ---------------- Coverage facts（progressive disclosure） ----------------

export interface CoverageFacts {
  assignmentReliability: AnalyticsReliability;
  planReliability: AnalyticsReliability;
  focusReliability: AnalyticsReliability;
  focusBackfilled: boolean;
  historyStartedAt: number;
  planCoverageStartedAt: number;
}

function fmtMonthDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/**
 * 展开后的逐项事实（只包含真实受影响的 metric，禁止猜日期）：
 * - 任务记录：自 M月d日起完整（assignment partial）
 * - 学习计划：自 M月d日起完整（plan partial；planCoverageStartedAt 是真实 metadata）
 * - 专注记录：当前区间可能不完整（focus partial；不制造具体起点）
 * - 已有专注记录仍会正常计入统计（focusBackfilled 且无 partial 时）
 */
export function buildCoverageFactLines(f: CoverageFacts): string[] {
  const lines: string[] = [];
  if (f.assignmentReliability === "partial") {
    lines.push(`任务记录：自 ${fmtMonthDay(f.historyStartedAt)} 起完整`);
  }
  if (f.planReliability === "partial") {
    lines.push(`学习计划：自 ${fmtMonthDay(f.planCoverageStartedAt)} 起完整`);
  }
  if (f.focusReliability === "partial") {
    lines.push("专注记录：当前区间可能不完整");
  }
  if (f.focusBackfilled && lines.length === 0) {
    lines.push("已有专注记录仍会正常计入统计");
  }
  return lines;
}

/** 折叠态摘要；无任何不完整 → null（不渲染） */
export function buildCoverageSummary(f: CoverageFacts): { title: string; hint: string } | null {
  const lines = buildCoverageFactLines(f);
  if (lines.length === 0) return null;
  return { title: "部分历史记录不完整", hint: "部分指标仅展示已记录内容" };
}

// ---------------- Course Investment identity ----------------

export const UNLINKED_COURSE_LABEL = "未关联课程";
export const DELETED_COURSE_LABEL = "已删除课程";

/**
 * 最终显示名：
 * - courseId null → 未关联课程（真 unlinked，唯一聚合）
 * - snapshot 存在 → snapshot（最近一个非空 snapshot，deterministic）
 * - snapshot 缺失 → current Course.name
 * - 两者皆无 → 已删除课程（绝不误标「未关联」）
 */
export function resolveCourseInvestmentName(
  courseId: string | null,
  snapshotName: string | null,
  courses: Record<string, string>
): string {
  if (courseId === null) return UNLINKED_COURSE_LABEL;
  if (snapshotName) return snapshotName;
  const current = courses[courseId];
  if (current) return current;
  return DELETED_COURSE_LABEL;
}

export interface CourseInvestmentView extends CourseInvestment {
  courseName: string;
  isOther?: boolean;
}

/**
 * Presentation 折叠：解析显示名 + Top 5 + Other。
 * 按 minutes desc；第 6 项之后聚合为「其他」（minutes/sessions/share 求和）；
 * 总课程 ≤5 无 Other；未关联课程按普通课程参与排序。
 */
export function presentCourseInvestment(
  investment: CourseInvestment[],
  courses: Record<string, string>
): CourseInvestmentView[] {
  if (investment.length <= 5) {
    return investment.map((item) => ({
      ...item,
      courseName: resolveCourseInvestmentName(item.courseId, item.courseName, courses),
    }));
  }
  const top = investment.slice(0, 5).map((item) => ({
    ...item,
    courseName: resolveCourseInvestmentName(item.courseId, item.courseName, courses),
  }));
  const rest = investment.slice(5);
  const other: CourseInvestmentView = {
    courseId: null,
    courseName: "其他",
    minutes: rest.reduce((s, i) => s + i.minutes, 0),
    sessions: rest.reduce((s, i) => s + i.sessions, 0),
    share: rest.reduce((s, i) => s + i.share, 0),
    isOther: true,
  };
  return [...top, other];
}

// ---------------- Trend labels ----------------

/**
 * Canonical bucket → UI label：
 * week（day grain）：8/10 周一
 * 4weeks（week grain）：7/20
 * semester：第1周
 */
export function formatTrendBucketLabel(period: AnalyticsPeriod, key: string): string {
  if (period.trendGrain === "semester-week") {
    const w = key.replace(/\D/g, "");
    return `第${w}周`;
  }
  const date = new Date(`${key}T00:00:00`);
  if (Number.isNaN(date.getTime())) return key;
  if (period.trendGrain === "day") {
    return format(date, "M/d EEE", { locale: zhCN });
  }
  return format(date, "M/d");
}

/** Tooltip 用完整上下文（V3.1）：
 *  week：8月17日 周一；4weeks：8月10日–8月16日（bucket 周范围）；semester：第N周 · M月d日–M月d日 */
export function formatTrendTooltip(period: AnalyticsPeriod, key: string): string {
  if (period.trendGrain === "semester-week") {
    const w = Number(key.replace(/\D/g, ""));
    const start = period.current.from + (w - 1) * 7 * 86400000;
    return `第${w}周 · ${fmtRange(start, start + 6 * 86400000)}`;
  }
  const date = new Date(`${key}T00:00:00`);
  if (Number.isNaN(date.getTime())) return key;
  if (period.trendGrain === "day") {
    return format(date, "M月d日 EEE", { locale: zhCN });
  }
  // 4weeks：bucket 起止周范围
  return fmtRange(date.getTime(), date.getTime() + 6 * 86400000);
}

function fmtRange(from: number, to: number): string {
  const f = new Date(from);
  const t = new Date(to);
  const p = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${p(f)}–${p(t)}`;
}
