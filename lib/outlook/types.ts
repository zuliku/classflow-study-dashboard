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
  /** 「如果没有其它任务竞争，截止前存在多少空闲分钟」（raw，非共享容量；容量结论看 capacity* 字段） */
  rawFreeMinutesBeforeDeadline: number | null;
  /** Preferred 共享容量分配（非课程时间；Capacity Allocator 输出；无估时 / 无 DDL / overdue → null） */
  capacityAllocatedMinutes: number | null;
  capacityShortfallMinutes: number | null;
  capacityComplete: boolean | null;
  /** V1.2：放宽课程约束后额外可分配分钟（Preferred 之外） */
  courseFallbackAllocatedMinutes: number | null;
  /** V1.2：Combined（Preferred + soft fallback）容量事实 */
  combinedCapacityAllocatedMinutes: number | null;
  combinedCapacityShortfallMinutes: number | null;
  combinedCapacityComplete: boolean | null;
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
  /** 该日 projected 分配分钟（Combined forecast blocks） */
  projectedAllocationMinutes: number;
  capacityPressure: "normal" | "busy" | "preferred-shortfall" | "hard-shortfall";
}

/** 按 Deadline 升序的 cumulative capacity checkpoint */
export interface CapacityCheckpoint {
  deadline: string;
  dueAssignmentIds: string[];
  cumulativeRequiredMinutes: number;
  cumulativeAllocatedMinutes: number;
  cumulativeShortfallMinutes: number;
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
    /** 整个 horizon 的 raw free capacity（未做 deadline 竞争） */
    freeMinutes: number;

    unusedFreeMinutes: number;
    /** V1.2：Preferred（非课程时间）容量 */
    preferredAllocatedMinutes: number;
    preferredShortfallMinutes: number;
    /** V1.2：放宽课程约束后额外可安排的分钟（≠ 课程重叠分钟） */
    additionalAllocatedWithCourseTime: number;
    /** V1.2：Combined（Preferred + soft fallback）容量 */
    combinedAllocatedMinutes: number;
    combinedShortfallMinutes: number;
  };
}

export interface StudyOutlook {
  horizonDays: StudyOutlookHorizon;
  summary: StudyOutlookSummary;
  /** 按优先级排序（最多 8 条） */
  tasks: OutlookTask[];
  bottleneckDays: OutlookDayLoad[];
  /** 按 Deadline 升序的 cumulative capacity forecast（Preferred；只含 eligible 任务） */
  capacityForecast: CapacityCheckpoint[];
  /** 首次 Preferred cumulative shortage 的 checkpoint；无缺口 → null */
  firstCapacityShortfall: {
    deadline: string;
    shortfallMinutes: number;
    affectedAssignmentIds: string[];
  } | null;
  /** V1.2：Combined（soft fallback 后）的 cumulative forecast */
  combinedCapacityForecast: CapacityCheckpoint[];
  /** V1.2：soft fallback 后仍不足的首次缺口；无 → null */
  firstCombinedCapacityShortfall: {
    deadline: string;
    shortfallMinutes: number;
    affectedAssignmentIds: string[];
  } | null;
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
