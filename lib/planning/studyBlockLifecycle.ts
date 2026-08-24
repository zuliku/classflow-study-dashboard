/**
 * Workflow UX V15：StudyBlock Release Lifecycle（纯函数，不写 Zustand）。
 *
 * Assignment planning terminal（submitted / completed）后：
 * - 尚未结束的 linked StudyBlocks → planningState = "released"
 * - 已结束的 blocks 保持原样（Learning History / Analytics 的历史证据）
 * - released block 不占 Free Time / 不制造 hard conflict / 不计 scheduledMinutes /
 *   不参与 Rebalance / Focus anchor；记录仍可查看、打开原任务、手动删除
 *
 * 为什么持久化在 StudyBlock 自身而非由 parent status 动态推导：
 * released 时段可能已被其它 active 任务重新占用；若 reopen 时按推导自动恢复，
 * 会破坏 StudyBlock ↔ StudyBlock hard conflict invariant。Reopen ≠ Restore。
 */

import { Assignment, Reminder, StudyBlock } from "@/types";
import { isAssignmentPlanningEligible } from "@/lib/tasks/taskSemantics";
import { timeToMinutes } from "@/lib/timeline/timelineGeometry";

// ---- 状态判定（业务层禁止各自比较 planningState 字面量，统一走这里）----

export function isStudyBlockPlanningActive(
  block: Pick<StudyBlock, "planningState">
): boolean {
  return block.planningState !== "released";
}

export function isStudyBlockReleased(
  block: Pick<StudyBlock, "planningState">
): boolean {
  return block.planningState === "released";
}

/** block 结束时刻（本地墙钟）；时间非法 → null（调用方自行决定语义） */
function blockEndMs(block: Pick<StudyBlock, "date" | "endTime">): number | null {
  const e = timeToMinutes(block.endTime);
  if (e === null) return null;
  const [y, m, d] = block.date.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, Math.floor(e / 60), e % 60).getTime();
}

/**
 * Workflow UX V15：block 是否已结束（end-exclusive history boundary）。
 * blockEnd <= now → historical（保持原样）；blockEnd > now → current/future → 可释放。
 */
export function isStudyBlockEnded(
  block: Pick<StudyBlock, "date" | "endTime">,
  now: number
): boolean {
  const end = blockEndMs(block);
  if (end === null) return true; // 非法时间视为已结束（不参与 release）
  return end <= now;
}

/** eligible → terminal transition 判定（todo/doing → submitted/completed） */
export function didAssignmentLosePlanningEligibility(
  before: Assignment["status"],
  after: Assignment["status"]
): boolean {
  return isAssignmentPlanningEligible({ status: before }) && !isAssignmentPlanningEligible({ status: after });
}

// ---- Workflow UX V17：Planning Write Boundary（Store 最终 mutation invariant）----
// Preflight（Kiro / UX）是 transaction protection；这里是 data integrity protection，
// 两者不可互替。任何 caller（Timeline / Kiro / MCP / 未来 API）最终走到 Store mutation 时，
// 都不能写出违反 V14/V15 的状态。

export type StudyBlockPlanningWriteRejection =
  | "released" // historical plan：不可编辑（delete 允许）
  | "parent-missing" // linked Assignment 不存在（orphan 写入拒绝）
  | "parent-terminal"; // linked Assignment submitted/completed

export interface StudyBlockPlanningWriteOk {
  ok: true;
}
export interface StudyBlockPlanningWriteRejected {
  ok: false;
  reason: StudyBlockPlanningWriteRejection;
}

/**
 * 单个 StudyBlock 是否允许被 Store 层 mutate（update / batch update 共用）：
 * - released → 拒绝（historical plan 不可编辑；与 parent 现状无关——reopen 不复活）
 * - active + 有 assignmentId → parent 必须存在且 planning eligible
 *   （覆盖 V15 遗留：terminal parent 的过去 block 虽无 released 标记，同样不可移动）
 * - standalone active → 允许
 */
export function validateStudyBlockPlanningWrite(
  block: Pick<StudyBlock, "planningState" | "assignmentId">,
  assignments: ReadonlyArray<Pick<Assignment, "id" | "status">>
): StudyBlockPlanningWriteOk | StudyBlockPlanningWriteRejected {
  if (isStudyBlockReleased(block)) return { ok: false, reason: "released" };
  if (!block.assignmentId) return { ok: true };
  const parent = assignments.find((a) => a.id === block.assignmentId);
  if (!parent) return { ok: false, reason: "parent-missing" };
  if (!isAssignmentPlanningEligible(parent)) return { ok: false, reason: "parent-terminal" };
  return { ok: true };
}

/**
 * Linked create 校验（addStudyBlock / addStudyBlocksBatch 共用）：
 * assignmentId 存在 → parent 必须存在且 todo/doing；standalone（无 assignmentId）→ 允许。
 * 失败 = 一次被拒绝的 planning write：调用方必须 0 side effect（不降级 standalone、
 * 不自动建 released block、不写 History/Reminder）。
 */
export function validateStudyBlockLinkedCreate(
  assignmentId: string | undefined,
  assignments: ReadonlyArray<Pick<Assignment, "id" | "status">>
): StudyBlockPlanningWriteOk | StudyBlockPlanningWriteRejected {
  if (!assignmentId) return { ok: true };
  const parent = assignments.find((a) => a.id === assignmentId);
  if (!parent) return { ok: false, reason: "parent-missing" };
  if (!isAssignmentPlanningEligible(parent)) return { ok: false, reason: "parent-terminal" };
  return { ok: true };
}

// ---- Release mutation ----

export interface ReleaseFutureStudyBlocksInput {
  studyBlocks: StudyBlock[];
  assignmentId: string;
  /** 本地 now（epoch ms）；只释放尚未结束的 blocks */
  now: number;
}

export interface ReleaseFutureStudyBlocksResult {
  /** immutable：未命中的 block 原引用保留；released block 为浅拷贝 */
  studyBlocks: StudyBlock[];
  releasedIds: string[];
}

/**
 * 释放某 Assignment 尚未结束的 linked StudyBlocks。
 * - immutable / deterministic / idempotent（already released 不重复改）
 * - 只改 matching assignmentId；past block 与 standalone block 不触碰
 */
export function releaseFutureStudyBlocksForAssignment({
  studyBlocks,
  assignmentId,
  now,
}: ReleaseFutureStudyBlocksInput): ReleaseFutureStudyBlocksResult {
  const releasedIds: string[] = [];
  const next = studyBlocks.map((b) => {
    if (b.assignmentId !== assignmentId) return b;
    if (isStudyBlockReleased(b)) return b; // idempotent
    if (isStudyBlockEnded(b, now)) return b; // past：历史证据保持
    releasedIds.push(b.id);
    return { ...b, planningState: "released" as const };
  });
  return { studyBlocks: next, releasedIds };
}

// ---- Reminder cleanup ----

/**
 * Release 后清理对应 scheduled StudyBlock reminder（fired / skipped 历史保留）——
 * 与 Assignment completed 清 scheduled reminders 同类语义。
 */
export function clearScheduledRemindersForReleasedBlocks(
  reminders: Reminder[],
  releasedIds: ReadonlySet<string>
): Reminder[] {
  if (releasedIds.size === 0) return reminders;
  return reminders.filter(
    (r) =>
      !(
        r.targetType === "studyBlock" &&
        r.targetId !== undefined &&
        releasedIds.has(r.targetId) &&
        r.status === "scheduled"
      )
  );
}

// ---- Legacy reconciliation（hydrate / backup restore 共用；幂等）----

export interface ReconcileTerminalAssignmentStudyBlocksInput {
  assignments: Assignment[];
  studyBlocks: StudyBlock[];
  reminders: Reminder[];
  now: number;
}

export interface ReconcileTerminalAssignmentStudyBlocksResult {
  studyBlocks: StudyBlock[];
  reminders: Reminder[];
}

/**
 * Legacy Terminal Data Reconciliation：旧版本允许「terminal Assignment + 未来 active block +
 * scheduled reminder」共存。升级 / backup import 时幂等修复：
 * terminal parent + 未结束 + 未 released → released，并清理其 scheduled reminder。
 * 过去 block 保持；active parent 完全不触碰。无变化时返回原引用集合（no-op 安全）。
 */
export function reconcileTerminalAssignmentStudyBlocks({
  assignments,
  studyBlocks,
  reminders,
  now,
}: ReconcileTerminalAssignmentStudyBlocksInput): ReconcileTerminalAssignmentStudyBlocksResult {
  const terminalIds = new Set(
    assignments.filter((a) => !isAssignmentPlanningEligible(a)).map((a) => a.id)
  );
  let changed = false;
  const releasedIds = new Set<string>();
  const nextBlocks = studyBlocks.map((b) => {
    if (!b.assignmentId || !terminalIds.has(b.assignmentId)) return b;
    if (isStudyBlockReleased(b) || isStudyBlockEnded(b, now)) return b;
    changed = true;
    releasedIds.add(b.id);
    return { ...b, planningState: "released" as const };
  });
  const nextReminders = changed
    ? clearScheduledRemindersForReleasedBlocks(reminders, releasedIds)
    : reminders;
  return changed ? { studyBlocks: nextBlocks, reminders: nextReminders } : { studyBlocks, reminders };
}
