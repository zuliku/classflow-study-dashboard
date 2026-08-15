/**
 * Task Execution Loop V1.1：Assignment Detail 的 Follow-up 实体归属（纯函数，无副作用）。
 *
 * 问题：Follow-up（「本次专注完成」）必须只属于「当前 Assignment Detail 真实观察过
 * 自己 active Focus（running/paused）→ completed」的会话，不能因为"某个全局 active
 * session 完成了"就在无关任务（course-only / unbound / 其他任务）上冒出来。
 *
 * 状态模型（仅 Drawer UI session 持有，不建 Zustand store）：
 * - observed：当前 Detail 已 armed 的「当前任务 active session」边界
 *   { assignmentId, sessionId }；armed 条件 = currentAssignmentId 且
 *   active.assignmentId === currentAssignmentId（running|paused 均算 active）
 * - 结算条件 = observed.sessionId 对应 session status === completed 且
 *   currentAssignmentId 仍是 observed.assignmentId
 * - entity switch / close（currentAssignmentId 变化或为 null）→ 立即 disarm，
 *   不产生 follow-up；返回原实体后若其 Focus 仍 active 可重新 arm
 */

import { FocusSession } from "@/types";

export interface ObservedAssignmentFocus {
  assignmentId: string;
  sessionId: string;
}

export interface ReconcileObservedAssignmentFocusInput {
  /** 当前 selected/displayed Assignment id；drawer 关闭时为 null */
  currentAssignmentId: string | null;
  /** 上一轮观察状态（Drawer 持有） */
  observed: ObservedAssignmentFocus | null;
  /** store focusSessions 快照 */
  focusSessions: FocusSession[];
}

export interface ReconcileObservedAssignmentFocusOutput {
  /** 下一轮应持有的观察状态（null = 未 armed / 已 disarm） */
  nextObserved: ObservedAssignmentFocus | null;
  /** 本轮的 follow-up 会话 id（仅当前实体自己的 observed session 完成时非 null） */
  completedSessionId: string | null;
}

/** 找全局唯一 active（running|paused）会话；Domain 保证唯一，取首个保守 */
function findActiveSession(sessions: FocusSession[]): FocusSession | null {
  return sessions.find((s) => s.status === "running" || s.status === "paused") ?? null;
}

/** 当前实体有 active 会话 → arm（sessionId 变化时替换为新 active） */
function armForCurrentEntity(
  currentAssignmentId: string | null,
  active: FocusSession | null,
  observed: ObservedAssignmentFocus | null
): ObservedAssignmentFocus | null {
  if (!currentAssignmentId || !active || active.assignmentId !== currentAssignmentId) return null;
  if (observed && observed.sessionId === active.id) return observed;
  return { assignmentId: currentAssignmentId, sessionId: active.id };
}

export function reconcileObservedAssignmentFocus({
  currentAssignmentId,
  observed,
  focusSessions,
}: ReconcileObservedAssignmentFocusInput): ReconcileObservedAssignmentFocusOutput {
  const active = findActiveSession(focusSessions);

  // 已有 armed 观察：先处理结算 / 取消
  if (observed) {
    // 实体已切换或关闭 → disarm；若新实体有自己的 active 则立即重新 arm
    if (currentAssignmentId !== observed.assignmentId) {
      return {
        nextObserved: armForCurrentEntity(currentAssignmentId, active, null),
        completedSessionId: null,
      };
    }
    const observedSession = focusSessions.find((s) => s.id === observed.sessionId);
    // observed session 已从快照消失（异常/恢复/备份替换）→ disarm，不猜 follow-up
    if (!observedSession) {
      return {
        nextObserved: armForCurrentEntity(currentAssignmentId, active, null),
        completedSessionId: null,
      };
    }
    // 当前实体自己的 observed session 完成 → 唯一合法的 follow-up 来源
    if (observedSession.status === "completed") {
      return { nextObserved: null, completedSessionId: observed.sessionId };
    }
  }

  // 正常态：arm / 保持当前实体的 active 观察
  return { nextObserved: armForCurrentEntity(currentAssignmentId, active, observed), completedSessionId: null };
}
