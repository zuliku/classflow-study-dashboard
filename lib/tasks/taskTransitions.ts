/**
 * Phase 0：terminal transition preview / reopen preview（纯函数）。
 *
 * 这里只计算“将要发生什么”，不写 Store。
 * 真正 apply / undo 在 useAppStore 中完成，确保：
 * - preview 无副作用
 * - apply 原子
 * - undo/reopen 可解释、可报告 skipped
 */

import { Assignment, FocusSession, Reminder, StudyBlock, TaskTransitionSource } from "@/types";
import { isStudyBlockEnded } from "@/lib/planning/studyBlockLifecycle";
import { getNextRecurringDoDateAfter, getNextRecurringOccurrenceAfter } from "@/lib/tasks/taskRecurrence";
import {
  getTaskDeadlineInstant,
  isActiveTask,
  isClosedTask,
  localDateKey,
} from "@/lib/tasks/taskLifecycle";
import { studyBlockMinutes } from "@/lib/tasks/taskPlanning";
import { timeToMinutes } from "@/lib/timeline/timelineGeometry";

export type TaskTerminalStatus = "submitted" | "completed";

/** Phase 0：updateTaskFields 允许的字段（lifecycle / 时间戳 / 账本字段由专用命令写） */
export type TaskFieldPatch = Partial<
  Omit<
    Assignment,
    | "id"
    | "status"
    | "progress"
    | "submittedAt"
    | "completedAt"
    | "lastTerminalTransition"
    | "recurrenceSpawnedAt"
    | "recurrenceSeriesId"
    | "recurrenceParentId"
  >
>;

export type TaskTransitionBlocker =
  | "not-found"
  | "focus-running"
  | "already-completed";

export type TaskTransitionWarning =
  | "incomplete-subtasks"
  | "do-date-after-ddl"
  | "submission-required-direct-complete"
  | "recurrence-will-skip-missed";

export interface TaskTransitionSideEffects {
  releaseStudyBlocks: {
    count: number;
    minutes: number;
    ids: string[];
  };
  cancelReminders: {
    count: number;
    manualCount: number;
    autoCount: number;
    ids: string[];
  };
  recurrence: {
    willGenerate: boolean;
    nextDdl?: string;
    nextDoDate?: string;
    seriesId?: string;
  };
  incompleteSubtasks: {
    count: number;
    ids: string[];
  };
  activeFocus: {
    sessionId: string;
    relation: "current" | "other";
  } | null;
}

export interface TaskTransitionPreview {
  taskId: string;
  transitionId: string;
  fromStatus: Assignment["status"];
  toStatus: TaskTerminalStatus;
  academicDoneAt: string;
  sideEffects: TaskTransitionSideEffects;
  blockers: TaskTransitionBlocker[];
  warnings: TaskTransitionWarning[];
}

export interface BuildTaskTransitionPreviewInput {
  task: Assignment;
  studyBlocks: readonly StudyBlock[];
  reminders: readonly Reminder[];
  focusSessions: readonly FocusSession[];
  assignments: readonly Assignment[];
  now: Date;
  /** 本地墙钟 "YYYY-MM-DDTHH:mm:ss" */
  nowLocal: string;
  transitionId: string;
  toStatus: TaskTerminalStatus;
}

function hasActiveFocus(
  focusSessions: readonly FocusSession[]
): { sessionId: string; assignmentId?: string } | null {
  const active = focusSessions.find(
    (session) => session.status === "running" || session.status === "paused"
  );
  return active ? { sessionId: active.id, assignmentId: active.assignmentId } : null;
}

function willGenerateRecurrence(
  task: Assignment,
  assignments: readonly Assignment[],
  toStatus: TaskTerminalStatus
): boolean {
  if (!task.recurrence || !task.ddl) return false;
  if (!isActiveTask(task)) return false;
  if (task.recurrenceSpawnedAt) return false;
  if (assignments.some((candidate) => candidate.recurrenceParentId === task.id)) return false;
  // submitted → completed 不重复生成；active → submitted/completed 才生成
  void toStatus;
  return true;
}

function recurrencePreview(
  task: Assignment,
  assignments: readonly Assignment[],
  now: Date,
  toStatus: TaskTerminalStatus
): TaskTransitionSideEffects["recurrence"] {
  if (!willGenerateRecurrence(task, assignments, toStatus)) {
    return { willGenerate: false };
  }
  return {
    willGenerate: true,
    nextDdl: getNextRecurringOccurrenceAfter(task.ddl, task.recurrence, now) ?? undefined,
    nextDoDate: getNextRecurringDoDateAfter(task.doDate, task.recurrence, now),
    seriesId: task.recurrenceSeriesId,
  };
}

export function buildTaskTransitionPreview(
  input: BuildTaskTransitionPreviewInput
): TaskTransitionPreview {
  const { task, studyBlocks, reminders, focusSessions, assignments, now, nowLocal, transitionId, toStatus } = input;

  const releaseCandidates = studyBlocks.filter(
    (block) =>
      block.assignmentId === task.id &&
      block.planningState !== "released" &&
      !isStudyBlockEnded(block, now.getTime())
  );
  const releaseIds = releaseCandidates.map((block) => block.id);
  const releaseIdSet = new Set(releaseIds);

  const assignmentReminders = reminders.filter(
    (reminder) =>
      reminder.targetType === "assignment" &&
      reminder.targetId === task.id &&
      reminder.status === "scheduled"
  );
  const blockReminders = reminders.filter(
    (reminder) =>
      reminder.targetType === "studyBlock" &&
      reminder.targetId !== undefined &&
      releaseIdSet.has(reminder.targetId) &&
      reminder.status === "scheduled"
  );
  const affectedReminders = [...assignmentReminders, ...blockReminders];
  const manualCount = affectedReminders.filter(
    (reminder) => reminder.source === "manual" || reminder.source === "kiro"
  ).length;
  const autoCount = affectedReminders.filter((reminder) => reminder.source === "auto").length;

  const incompleteSubtasks = (task.subtasks ?? []).filter((subtask) => !subtask.completed);
  const activeFocus = hasActiveFocus(focusSessions);
  const blockers: TaskTransitionBlocker[] = [];
  if (toStatus === "completed" && task.status === "completed") blockers.push("already-completed");
  if (activeFocus && activeFocus.assignmentId === task.id) blockers.push("focus-running");

  const warnings: TaskTransitionWarning[] = [];
  if (incompleteSubtasks.length > 0) warnings.push("incomplete-subtasks");
  if (task.doDate && task.ddl) {
    const deadline = getTaskDeadlineInstant(task);
    if (deadline && task.doDate > localDateKey(deadline)) warnings.push("do-date-after-ddl");
  }
  if (toStatus === "completed" && task.submissionRequired && isActiveTask(task)) {
    warnings.push("submission-required-direct-complete");
  }

  return {
    taskId: task.id,
    transitionId,
    fromStatus: task.status,
    toStatus,
    academicDoneAt: nowLocal,
    sideEffects: {
      releaseStudyBlocks: {
        count: releaseCandidates.length,
        minutes: releaseCandidates.reduce((sum, block) => sum + studyBlockMinutes(block), 0),
        ids: releaseIds,
      },
      cancelReminders: {
        count: affectedReminders.length,
        manualCount,
        autoCount,
        ids: affectedReminders.map((reminder) => reminder.id),
      },
      recurrence: recurrencePreview(task, assignments, now, toStatus),
      incompleteSubtasks: {
        count: incompleteSubtasks.length,
        ids: incompleteSubtasks.map((subtask) => subtask.id),
      },
      activeFocus: activeFocus
        ? {
            sessionId: activeFocus.sessionId,
            relation: activeFocus.assignmentId === task.id ? "current" : "other",
          }
        : null,
    },
    blockers,
    warnings,
  };
}

export interface TaskReopenPreviewItemBlock {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
}

export interface TaskReopenPreviewItemReminder {
  id: string;
  title: string;
  triggerAt: string;
}

export interface TaskReopenPreview {
  taskId: string;
  fromStatus: "submitted" | "completed";
  toStatus: "todo" | "doing";
  restorableStudyBlocks: TaskReopenPreviewItemBlock[];
  restorableReminders: TaskReopenPreviewItemReminder[];
  recurrenceChild: {
    id: string;
    title: string;
    ddl?: string;
    pristine: boolean;
  } | null;
  warnings: Array<"ddl-in-past" | "recurrence-child-exists" | "study-block-conflict">;
}

export interface BuildTaskReopenPreviewInput {
  task: Assignment;
  studyBlocks: readonly StudyBlock[];
  reminders: readonly Reminder[];
  assignments: readonly Assignment[];
  now: Date;
  nowLocal: string;
}

function blocksOverlap(a: StudyBlock, b: StudyBlock): boolean {
  if (a.date !== b.date) return false;
  const startA = timeToMinutes(a.startTime);
  const endA = timeToMinutes(a.endTime);
  const startB = timeToMinutes(b.startTime);
  const endB = timeToMinutes(b.endTime);
  if (startA === null || endA === null || startB === null || endB === null) return false;
  return startA < endB && startB < endA;
}

function isPristineRecurrenceChild(
  child: Assignment,
  studyBlocks: readonly StudyBlock[],
  reminders: readonly Reminder[]
): boolean {
  if (child.status !== "todo") return false;
  if (child.submittedAt || child.completedAt || child.lastTerminalTransition) return false;
  if ((child.subtasks ?? []).some((subtask) => subtask.completed)) return false;
  if (studyBlocks.some((block) => block.assignmentId === child.id)) return false;
  if (
    reminders.some(
      (reminder) =>
        reminder.targetType === "assignment" &&
        reminder.targetId === child.id &&
        reminder.status === "scheduled" &&
        reminder.source !== "auto"
    )
  ) {
    return false;
  }
  return true;
}

export function buildTaskReopenPreview(input: BuildTaskReopenPreviewInput): TaskReopenPreview | null {
  const { task, studyBlocks, reminders, assignments, now, nowLocal } = input;
  if (!isClosedTask(task)) return null;

  const restorableStudyBlocks = studyBlocks.filter(
    (block) =>
      block.assignmentId === task.id &&
      block.planningState === "released" &&
      block.releasedByTaskId === task.id &&
      (block.releasedBy === "task-submitted" || block.releasedBy === "task-completed") &&
      !isStudyBlockEnded(block, now.getTime())
  );
  const restorableBlockIds = new Set(restorableStudyBlocks.map((block) => block.id));

  const activeBlockIds = new Set(
    studyBlocks
      .filter((block) => block.assignmentId === task.id && block.planningState !== "released")
      .map((block) => block.id)
  );

  const transitionAt = task.lastTerminalTransition?.at;
  const restorableReminders = reminders.filter((reminder) => {
    if (reminder.status !== "cancelled" || reminder.cancelledByTaskId !== task.id) return false;
    if (reminder.source !== "manual" && reminder.source !== "kiro") return false;
    if (!reminder.cancelledAt) return false;
    if (transitionAt && reminder.cancelledAt < transitionAt) return false;
    const trigger = reminder.triggerAt;
    if (!trigger || trigger <= nowLocal) return false;
    if (reminder.targetType === "assignment") return reminder.targetId === task.id;
    if (reminder.targetType === "studyBlock") {
      return !!reminder.targetId && (restorableBlockIds.has(reminder.targetId) || activeBlockIds.has(reminder.targetId));
    }
    return false;
  });

  const deadline = getTaskDeadlineInstant(task);
  const child = assignments.find((candidate) => candidate.recurrenceParentId === task.id);
  const activeBlocks = studyBlocks.filter((block) => block.planningState !== "released");
  const hasRestoreConflict = restorableStudyBlocks.some((block) =>
    activeBlocks.some((active) => active.id !== block.id && blocksOverlap(active, block))
  );
  const warnings: TaskReopenPreview["warnings"] = [];
  if (deadline && deadline.getTime() < now.getTime()) warnings.push("ddl-in-past");
  if (child) warnings.push("recurrence-child-exists");
  if (hasRestoreConflict) warnings.push("study-block-conflict");

  return {
    taskId: task.id,
    fromStatus: task.status === "submitted" ? "submitted" : "completed",
    toStatus: task.lastTerminalTransition?.activeStatusBeforeTerminal ?? "doing",
    restorableStudyBlocks: restorableStudyBlocks.map((block) => ({
      id: block.id,
      title: block.title,
      date: block.date,
      startTime: block.startTime,
      endTime: block.endTime,
    })),
    restorableReminders: restorableReminders.map((reminder) => ({
      id: reminder.id,
      title: reminder.title,
      triggerAt: reminder.triggerAt,
    })),
    recurrenceChild: child
      ? {
          id: child.id,
          title: child.title,
          ddl: child.ddl,
          pristine: isPristineRecurrenceChild(child, studyBlocks, reminders),
        }
      : null,
    warnings,
  };
}

export interface TaskReopenInput {
  restoreStudyBlocks: boolean;
  restoreReminders: boolean;
  deletePristineRecurrence: boolean;
  /** 用于幂等 / 审计；当前 reopen 不需要 terminal transitionId */
  transitionId?: string;
  source: TaskTransitionSource;
}

export interface TaskTransitionResult {
  ok: true;
  transitionId: string;
  taskId: string;
  appliedStatus: TaskTerminalStatus;
  releasedStudyBlockIds: string[];
  cancelledReminderIds: string[];
  generatedRecurrenceId?: string;
}

export interface TaskTransitionRejected {
  ok: false;
  blocker: TaskTransitionBlocker;
}

export interface TaskTransitionUndoSkip {
  kind: "study-block" | "reminder" | "recurrence";
  id: string;
  reason: string;
}

export interface TaskTransitionUndoResult {
  ok: boolean;
  restoredStatus: Assignment["status"];
  restoredStudyBlockIds: string[];
  restoredReminderIds: string[];
  deletedRecurrenceId?: string;
  skipped: TaskTransitionUndoSkip[];
}

export interface TaskReopenResult {
  ok: boolean;
  taskId: string;
  appliedStatus: "todo" | "doing";
  restoredStudyBlockIds: string[];
  restoredReminderIds: string[];
  deletedRecurrenceId?: string;
  skipped: TaskTransitionUndoSkip[];
}
