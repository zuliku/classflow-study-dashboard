/**
 * ClassFlow Learning Analytics V2 — 类型（Part 1）。
 * 只定义 deterministic analytics 层；不涉及 AI。
 */

import { Semester } from "@/types";

export type AnalyticsRangePreset = "week" | "4weeks" | "semester";

export interface AnalyticsPeriodWindow {
  from: number;
  to: number;
}

export interface AnalyticsPeriod {
  preset: AnalyticsRangePreset;
  current: AnalyticsPeriodWindow;
  previous: AnalyticsPeriodWindow | null;
  trendGrain: "day" | "week" | "semester-week";
}

/**
 * Metric-level reliability（Analytics V3 Truth）：
 * - complete：该区间进入可靠记录起点之后
 * - partial：区间早于可靠记录起点（只可表达「已记录」，不可表达「完整总数 / 0」）
 * - unavailable：无法形成该指标（如无样本、计划比率在 partial 下不可算）
 */
export type AnalyticsReliability = "complete" | "partial" | "unavailable";

export interface LearningTrendPoint {
  key: string;
  /** UI label（week：8/10 周一；4weeks：7/20；semester：第1周）；完整日期在 tooltip */
  label: string;
  /** null = 该 bucket 处于记录起点之前（unknown），禁止补 0 */
  focusMinutes: number | null;
  plannedMinutes: number | null;
  completedAssignments: number | null;
}

export interface CourseInvestment {
  courseId: string | null;
  /** 最近一个非空 snapshot；null = 无 snapshot（由 presentation 用 current name / 已删除课程 兜底） */
  courseName: string | null;
  minutes: number;
  sessions: number;
  share: number; // 0..1
}

export type FocusTimeOfDay = "深夜" | "上午" | "下午" | "晚间";

export interface FocusRhythm {
  byTimeOfDay: { bucket: FocusTimeOfDay; minutes: number; sessions: number }[];
  activeDays: number;
  averageSessionMinutes: number | null;
  longestSessionMinutes: number;
  /** 满足样本阈值（sessions>=5 且 minutes>=120）时的主导时段；否则 null */
  dominantTimeOfDay: FocusTimeOfDay | null;
}

export interface ExecutionAnalytics {
  uniqueCompletedAssignments: number;
  reopenedAssignments: number;
  onTime: number;
  late: number;
  onTimeEligible: number;
  onTimeRate: number | null;
  activeDays: number;
  avgFocusSessionMinutes: number | null;
}

export interface AnalyticsOverview {
  actualFocusMinutes: number;
  actualFocusLabel: string;
  focusDeltaPercent: number | null;
  completedAssignments: number;
  plannedMinutes: number;
  plannedLabel: string;
  actualToPlanRatio: number | null;
  onTimeCount: number;
  onTimeEligible: number;
  onTimeRate: number | null;
}

export type LearningSignalTone = "positive" | "neutral" | "attention";

export interface LearningSignal {
  id: string;
  tone: LearningSignalTone;
  title: string;
  description: string;
  action?: {
    label: string;
    targetTab: "assignments" | "timetable" | "courses";
  };
}

export interface LearningAnalyticsSnapshot {
  period: AnalyticsPeriod;
  coverage: {
    fullCoverage: boolean;
    comparisonAvailable: boolean;
    historyStartedAt: number;
    /** StudyBlock 计划序列在该 range 内是否完整（≥ planCoverageStartedAt 才 true） */
    planCoverageFull: boolean;
    /** max(historyStartedAt, studyBlockBatchIntegrityStartedAt) */
    planCoverageStartedAt: number;
    /** V3：metric-level reliability（Unknown ≠ Zero） */
    assignmentReliability: AnalyticsReliability;
    planReliability: AnalyticsReliability;
    focusReliability: AnalyticsReliability;
    /** Focus backfill 是否执行过（旧会话已回填；无完整起点证明时 UI 不声称「完整」） */
    focusBackfilled: boolean;
  };
  overview: AnalyticsOverview;
  trend: LearningTrendPoint[];
  courseInvestment: CourseInvestment[];
  focusRhythm: FocusRhythm;
  execution: ExecutionAnalytics;
  signals: LearningSignal[];
  /** true = 当前范围无任何可用事件（展示 empty state） */
  isEmpty: boolean;
}

/** 计划学习重建所需的最小事件视图（studyPlanProjection / assignmentProjection 输入） */
export interface AnalyticsProjectionEvent {
  type: string;
  entityId: string;
  occurredAt: number;
  sequence: number;
  courseId?: string;
  courseNameSnapshot?: string;
  assignmentId?: string;
  assignmentTitleSnapshot?: string;
  data: unknown;
}

export interface SemesterInfo {
  id: string;
  name: string;
  startDate: string;
  totalWeeks: number;
}

export interface LearningAnalyticsBuildInput {
  preset: AnalyticsRangePreset;
  semester: SemesterInfo;
  now?: number;
}
