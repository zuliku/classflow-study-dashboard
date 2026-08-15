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

export interface LearningTrendPoint {
  key: string;
  label: string;
  focusMinutes: number;
  plannedMinutes: number;
  completedAssignments: number;
}

export interface CourseInvestment {
  courseId: string | null;
  courseName: string;
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
