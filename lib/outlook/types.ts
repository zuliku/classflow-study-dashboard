/**
 * Study Outlook（未来 7 / 14 天确定性学习前瞻）类型。
 * 语义边界：Analytics = 过去发生了什么；Outlook = 基于当前状态，未来可能需要怎么安排。
 * 不使用 LLM；deriveAssignmentHealth + findFreeTime 复用既有确定性引擎。
 */

import { CourseEstimateCalibration, EstimateCalibration } from "@/lib/analytics/estimateCalibration";

export type StudyOutlookHorizon = 7 | 14;

export type OutlookHealth =
  | "safe"
  | "attention"
  | "at-risk"
  | "overdue"
  | "unscheduled"
  | "unknown";

export interface OutlookTaskEstimateCalibration {
  source: "course" | "global";
  medianRatio: number;
  sampleCount: number;
}

export interface OutlookTask {
  assignmentId: string;
  title: string;
  courseId: string | null;
  courseName: string;
  deadline: string | null;
  estimatedMinutes: number | null;
  /** Deadline 之前已安排的 StudyBlock 分钟 */
  scheduledMinutesBeforeDeadline: number;
  /** max(estimated - scheduled, 0)；无估时 → null */
  unscheduledMinutes: number | null;
  /** now → min(deadline, horizonEnd) 范围内可用的 free minutes；无 DDL → null */
  availableMinutesBeforeDeadline: number | null;
  health: OutlookHealth;
  reasons: string[];
  /** 只读参考 metadata（绝不自动写入 / 不改变 health 判定） */
  estimateCalibration?: OutlookTaskEstimateCalibration;
}

export interface OutlookDayLoad {
  date: string;
  plannedStudyMinutes: number;
  freeMinutesRemaining: number;
  dueTaskCount: number;
}

export interface StudyOutlookSummary {
  horizonDays: StudyOutlookHorizon;
  counts: {
    totalDue: number;
    overdue: number;
    atRisk: number;
    attention: number;
    unscheduled: number;
    safe: number;
    unknown: number;
    missingEstimate: number;
    noDeadline: number;
  };
  workload: {
    estimatedMinutesKnown: number;
    scheduledMinutes: number;
    remainingKnownMinutes: number;
    freeMinutes: number;
  };
}

export interface StudyOutlook {
  horizonDays: StudyOutlookHorizon;
  summary: StudyOutlookSummary;
  /** 按优先级排序（最多 8 条） */
  tasks: OutlookTask[];
  bottleneckDays: OutlookDayLoad[];
  estimateCalibration: EstimateCalibration;
}

/** buildStudyOutlook 输入（state 快照 + 预构建 calibration） */
export interface StudyOutlookBuildInput {
  assignments: import("@/types").Assignment[];
  studyBlocks: import("@/types").StudyBlock[];
  schedules: import("@/types").CourseSchedule[];
  calendarMarks: import("@/types").CalendarMark[];
  courses: import("@/types").Course[];
  semester: import("@/types").Semester;
  currentSemesterWeek: number;
  horizonDays: StudyOutlookHorizon;
  now: Date;
  /** 预构建的估时校准（供每个 task 附加只读参考） */
  calibration: EstimateCalibration;
}
