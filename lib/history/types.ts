/**
 * ClassFlow Learning History V1 — Event Schema（Part 1）。
 * 独立于 Zustand business state 的 append-only 历史事实（IndexedDB）。
 */

export const LEARNING_HISTORY_SCHEMA_VERSION = 1 as const;

export type LearningHistorySource = "manual" | "kiro" | "system" | "import";

export type LearningHistoryEntityType =
  | "assignment"
  | "study-block"
  | "focus-session"
  | "course"
  | "schedule"
  | "semester";

export type LearningHistoryEventType =
  | "assignment.created"
  | "assignment.status_changed"
  | "assignment.completed"
  | "assignment.reopened"
  | "assignment.deadline_changed"
  | "assignment.estimate_changed"
  | "assignment.priority_changed"
  | "assignment.deleted"
  | "assignment.restored"
  | "study_block.created"
  | "study_block.updated"
  | "study_block.deleted"
  | "focus.started"
  | "focus.paused"
  | "focus.resumed"
  | "focus.completed"
  | "course.created"
  | "course.updated"
  | "course.deleted"
  | "schedule.created"
  | "schedule.updated"
  | "schedule.deleted"
  | "semester.updated";

export interface LearningHistoryEventBase {
  id: string;
  schemaVersion: 1;
  type: LearningHistoryEventType;
  /** epoch ms（事件发生时间） */
  occurredAt: number;
  /** 本地墙钟日期 "YYYY-MM-DD" */
  localDate: string;
  timezoneOffsetMinutes: number;
  source: LearningHistorySource;
  entityType: LearningHistoryEntityType;
  entityId: string;
  semesterId: string;
  semesterNameSnapshot: string;
  /** 事件发生时间所在教学周；<1 或 > totalWeeks → null（不 clamp） */
  semesterWeek: number | null;
  courseId?: string;
  assignmentId?: string;
  courseNameSnapshot?: string;
  assignmentTitleSnapshot?: string;
  /** 写入顺序（同毫秒批量事件保序）；不跨 reload 保证唯一 */
  sequence: number;
}

// ---------- Typed Payloads ----------

export interface AssignmentCreatedData {
  status: import("@/types").Assignment["status"];
  priority: import("@/types").Assignment["priority"];
  ddl: string | null;
  estimatedMinutes: number | null;
}

export interface AssignmentStatusChangedData {
  from: import("@/types").Assignment["status"];
  to: import("@/types").Assignment["status"];
}

export type AssignmentCompletionTrigger = "status" | "progress" | "subtasks" | "update";

export interface AssignmentCompletedData {
  previousStatus: import("@/types").Assignment["status"];
  completionTrigger: AssignmentCompletionTrigger;
}

export interface AssignmentReopenedData {
  from: "completed";
  to: import("@/types").Assignment["status"];
}

export interface AssignmentDeadlineChangedData {
  before: string | null;
  after: string | null;
}

export interface AssignmentEstimateChangedData {
  before: number | null;
  after: number | null;
}

export interface AssignmentPriorityChangedData {
  before: import("@/types").Assignment["priority"];
  after: import("@/types").Assignment["priority"];
}

export interface StudyBlockCreatedData {
  date: string;
  startTime: string;
  endTime: string;
  plannedMinutes: number | null;
  originSource: "manual" | "kiro";
  restored?: boolean;
}

export interface StudyBlockUpdatedData {
  date?: string;
  startTime?: string;
  endTime?: string;
  plannedMinutesBefore: number | null;
  plannedMinutesAfter: number | null;
}

export interface FocusStartedData {
  plannedMinutes: number;
  sessionSource: import("@/types").FocusSession["source"];
  startedAt: number;
}

export interface FocusPausedData {
  accumulatedActiveMs: number;
}

export interface FocusResumedData {
  accumulatedActiveMs: number;
}

export interface FocusCompletedData {
  plannedMinutes: number;
  actualActiveMs: number;
  startedAt: number;
  endedAt: number;
  endReason: "timer" | "manual" | "recovered";
  sessionSource: import("@/types").FocusSession["source"];
  backfilled?: boolean;
}

export interface CourseCreatedData {
  name: string;
  code: string;
  credit: number;
}

export interface CourseUpdatedData {
  before: { name?: string; code?: string; teacher?: string; classroom?: string; credit?: number };
  after: { name?: string; code?: string; teacher?: string; classroom?: string; credit?: number };
}

export interface CourseDeletedData {
  name: string;
  code: string;
  credit: number;
}

export interface ScheduleEventData {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  location: string;
  weeks: string;
  excludedWeeks?: number[];
  restored?: boolean;
}

export interface SemesterUpdatedData {
  before: { id: string; name: string; startDate: string; totalWeeks: number };
  after: { id: string; name: string; startDate: string; totalWeeks: number };
}

export type LearningHistoryEvent =
  | (LearningHistoryEventBase & { type: "assignment.created"; data: AssignmentCreatedData })
  | (LearningHistoryEventBase & { type: "assignment.status_changed"; data: AssignmentStatusChangedData })
  | (LearningHistoryEventBase & { type: "assignment.completed"; data: AssignmentCompletedData })
  | (LearningHistoryEventBase & { type: "assignment.reopened"; data: AssignmentReopenedData })
  | (LearningHistoryEventBase & { type: "assignment.deadline_changed"; data: AssignmentDeadlineChangedData })
  | (LearningHistoryEventBase & { type: "assignment.estimate_changed"; data: AssignmentEstimateChangedData })
  | (LearningHistoryEventBase & { type: "assignment.priority_changed"; data: AssignmentPriorityChangedData })
  | (LearningHistoryEventBase & { type: "assignment.deleted"; data: { titleSnapshot?: string } })
  | (LearningHistoryEventBase & { type: "assignment.restored"; data: { titleSnapshot?: string } })
  | (LearningHistoryEventBase & { type: "study_block.created"; data: StudyBlockCreatedData })
  | (LearningHistoryEventBase & { type: "study_block.updated"; data: StudyBlockUpdatedData })
  | (LearningHistoryEventBase & { type: "study_block.deleted"; data: { date?: string } })
  | (LearningHistoryEventBase & { type: "focus.started"; data: FocusStartedData })
  | (LearningHistoryEventBase & { type: "focus.paused"; data: FocusPausedData })
  | (LearningHistoryEventBase & { type: "focus.resumed"; data: FocusResumedData })
  | (LearningHistoryEventBase & { type: "focus.completed"; data: FocusCompletedData })
  | (LearningHistoryEventBase & { type: "course.created"; data: CourseCreatedData })
  | (LearningHistoryEventBase & { type: "course.updated"; data: CourseUpdatedData })
  | (LearningHistoryEventBase & { type: "course.deleted"; data: CourseDeletedData })
  | (LearningHistoryEventBase & { type: "schedule.created"; data: ScheduleEventData })
  | (LearningHistoryEventBase & { type: "schedule.updated"; data: ScheduleEventData })
  | (LearningHistoryEventBase & { type: "schedule.deleted"; data: ScheduleEventData })
  | (LearningHistoryEventBase & { type: "semester.updated"; data: SemesterUpdatedData });

/** History Coverage 元数据（meta store） */
export interface LearningHistoryCoverage {
  schemaVersion: 1;
  /** 首次初始化时间：之后的核心学习事件有完整 coverage */
  historyStartedAt: number;
  initializedAt: number;
  focusBackfillCompleted: boolean;
  backfilledFocusSessions: number;
  /** 用户主动清空 History 后为 true：不再回填旧 Focus */
  focusBackfillDisabled?: boolean;
}
