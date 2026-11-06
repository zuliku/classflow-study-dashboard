/**
 * Phase 0：Reminder cancellation / restore（纯函数，无 Zustand）。
 *
 * terminal 动作：
 * - manual / kiro scheduled → cancelled + provenance（可恢复）
 * - auto scheduled → 删除（派生数据，可重建）
 *
 * reopen：
 * - 只恢复 cancelledByTaskId 匹配、未来、目标仍有效的 manual/kiro reminders
 * - 已过去 / 目标失效 / 重复 scheduled → 不恢复
 */

import { Reminder } from "@/types";
import { parseLocalDDL } from "@/lib/ddl";

export type ReminderCancelReason = NonNullable<Reminder["cancelledReason"]>;

export interface CancelRemindersResult {
  reminders: Reminder[];
  /** 被标记 cancelled 的 manual/kiro IDs（可恢复） */
  cancelledIds: string[];
  /** 被删除的 auto IDs（派生数据，不恢复） */
  removedAutoIds: string[];
}

function isRestorableSource(reminder: Reminder): boolean {
  return reminder.source === "manual" || reminder.source === "kiro";
}

/**
 * 取消某 Assignment 的 scheduled reminders。
 * 只处理 status === scheduled；fired/skipped 历史保持。
 */
export function cancelScheduledAssignmentReminders(
  reminders: readonly Reminder[],
  assignmentId: string,
  reason: Extract<ReminderCancelReason, "task-submitted" | "task-completed" | "task-deleted">,
  now: string
): CancelRemindersResult {
  const cancelledIds: string[] = [];
  const removedAutoIds: string[] = [];
  const next: Reminder[] = [];

  for (const reminder of reminders) {
    const matches =
      reminder.targetType === "assignment" &&
      reminder.targetId === assignmentId &&
      reminder.status === "scheduled";
    if (!matches) {
      next.push(reminder);
      continue;
    }
    if (!isRestorableSource(reminder)) {
      removedAutoIds.push(reminder.id);
      continue;
    }
    cancelledIds.push(reminder.id);
    next.push({
      ...reminder,
      status: "cancelled",
      cancelledAt: now,
      cancelledByTaskId: assignmentId,
      cancelledReason: reason,
      updatedAt: now,
    });
  }

  return { reminders: next, cancelledIds, removedAutoIds };
}

/**
 * 取消 released StudyBlock 的 scheduled reminders。
 * auto reminders 删除；manual/kiro 标记 cancelled 并保留原任务 id。
 */
export function cancelScheduledRemindersForReleasedBlocks(
  reminders: readonly Reminder[],
  releasedIds: ReadonlySet<string>,
  blockTaskIds: ReadonlyMap<string, string | undefined>,
  now: string
): CancelRemindersResult {
  if (releasedIds.size === 0) {
    return { reminders: [...reminders], cancelledIds: [], removedAutoIds: [] };
  }

  const cancelledIds: string[] = [];
  const removedAutoIds: string[] = [];
  const next: Reminder[] = [];

  for (const reminder of reminders) {
    const matches =
      reminder.targetType === "studyBlock" &&
      reminder.targetId !== undefined &&
      releasedIds.has(reminder.targetId) &&
      reminder.status === "scheduled";
    if (!matches) {
      next.push(reminder);
      continue;
    }
    if (!isRestorableSource(reminder)) {
      removedAutoIds.push(reminder.id);
      continue;
    }
    const taskId = blockTaskIds.get(reminder.targetId!);
    cancelledIds.push(reminder.id);
    next.push({
      ...reminder,
      status: "cancelled",
      cancelledAt: now,
      ...(taskId ? { cancelledByTaskId: taskId } : {}),
      cancelledReason: "study-block-released",
      updatedAt: now,
    });
  }

  return { reminders: next, cancelledIds, removedAutoIds };
}

export interface RestoreCancelledRemindersInput {
  reminders: readonly Reminder[];
  taskId: string;
  /** terminal transition 的本地时间；只恢复此时间之后的取消 */
  transitionAt: string;
  /** 当前本地时间；只恢复 triggerAt > now */
  now: string;
  validAssignmentIds: ReadonlySet<string>;
  validStudyBlockIds: ReadonlySet<string>;
  validCalendarMarkIds: ReadonlySet<string>;
}

export interface RestoreCancelledRemindersResult {
  reminders: Reminder[];
  restoredIds: string[];
  skippedIds: string[];
}

function isTargetValid(reminder: Reminder, input: RestoreCancelledRemindersInput): boolean {
  switch (reminder.targetType) {
    case "assignment":
      return !!reminder.targetId && input.validAssignmentIds.has(reminder.targetId);
    case "studyBlock":
      return !!reminder.targetId && input.validStudyBlockIds.has(reminder.targetId);
    case "calendarMark":
      return !!reminder.targetId && input.validCalendarMarkIds.has(reminder.targetId);
    case "standalone":
      return false; // task terminal 不应取消 standalone；不在这里恢复
  }
}

function hasDuplicateScheduled(reminders: readonly Reminder[], candidate: Reminder): boolean {
  return reminders.some(
    (r) =>
      r.id !== candidate.id &&
      r.status === "scheduled" &&
      r.targetType === candidate.targetType &&
      r.targetId === candidate.targetId &&
      r.timingMode === candidate.timingMode &&
      r.offsetMinutes === candidate.offsetMinutes &&
      r.triggerAt === candidate.triggerAt
  );
}

/**
 * 恢复由某次 terminal transition 取消的 manual/kiro reminders。
 * - 只恢复 cancelledByTaskId === taskId、cancelledAt >= transitionAt
 * - 未来、目标有效、无重复 scheduled
 * - auto reminders 不在恢复范围（由 reconcileAllAuto 重建）
 */
export function restoreCancelledRemindersForTask(
  input: RestoreCancelledRemindersInput
): RestoreCancelledRemindersResult {
  const transitionMs = parseLocalDDL(input.transitionAt)?.getTime() ?? Infinity;
  const nowMs = parseLocalDDL(input.now)?.getTime() ?? 0;
  const restoredIds: string[] = [];
  const skippedIds: string[] = [];
  const next: Reminder[] = [];

  for (const reminder of input.reminders) {
    const isCandidate =
      reminder.status === "cancelled" &&
      reminder.cancelledByTaskId === input.taskId &&
      isRestorableSource(reminder);
    if (!isCandidate) {
      next.push(reminder);
      continue;
    }

    const cancelledMs = reminder.cancelledAt
      ? parseLocalDDL(reminder.cancelledAt)?.getTime() ?? null
      : null;
    const triggerMs = parseLocalDDL(reminder.triggerAt)?.getTime() ?? null;
    const canRestore =
      cancelledMs !== null &&
      cancelledMs >= transitionMs &&
      triggerMs !== null &&
      triggerMs > nowMs &&
      isTargetValid(reminder, input) &&
      !hasDuplicateScheduled(input.reminders, reminder);

    if (!canRestore) {
      skippedIds.push(reminder.id);
      next.push(reminder);
      continue;
    }

    restoredIds.push(reminder.id);
    next.push({
      ...reminder,
      status: "scheduled",
      cancelledAt: undefined,
      cancelledByTaskId: undefined,
      cancelledReason: undefined,
      updatedAt: input.now,
    });
  }

  return { reminders: next, restoredIds, skippedIds };
}
