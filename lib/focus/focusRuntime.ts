/**
 * Task 3：Focus Runtime 纯决策层（复用 Task 2 deriveFocusClock，不复制时间算法）。
 * booting：页面 hydrate 后的 recovered 结算（只站内 Toast，不补响铃/系统通知）。
 * running：live 完成（Toast + 提示音 + Browser Notification，仅 ok:true 后）。
 */

import { FocusSession } from "@/types";
import { deriveFocusClock } from "@/lib/focus/focusDomain";

export type FocusRuntimePhase = "booting" | "running";

export type FocusRuntimeDecision =
  | "none"
  | "complete-recovered"
  | "complete-live";

export function getFocusRuntimeDecision(
  session: FocusSession | null | undefined,
  now: number,
  phase: FocusRuntimePhase
): FocusRuntimeDecision {
  if (!session) return "none";
  if (session.status !== "running") return "none";
  const clock = deriveFocusClock(session, now);
  if (clock.remainingMs > 0) return "none";
  return phase === "booting" ? "complete-recovered" : "complete-live";
}

// ============================================================
// Workflow UX V11：live timer 完成 → 任务 follow-up handoff（纯决策）
// 只服务本次 App runtime 内实时发生的 timer completion；
// recovered / manual 不产生「查看任务」action（前者时效性不足、后者已有 Drawer-local follow-up）。
// ============================================================

export interface TimerCompletionHandoffInput {
  /** 完成会话的 assignmentId（course-only / unbound 为 undefined） */
  assignmentId: string | undefined;
  sessionId: string;
  /** 完成瞬间的 Drawer 状态：已打开同一任务 → 无需 handoff（现有 observer 已覆盖） */
  selectedAssignmentId: string | null;
  assignments: { id: string }[];
}

/**
 * live timer 完成时是否随 Toast 提供「查看任务」action：
 * - 有有效 assignmentId
 * - Assignment 仍存在
 * - AssignmentDrawer 未正打开同一任务（否则重复提示）
 * 返回 null = 不加 action；非 null = 携带于 Toast 的 handoff 目标
 */
export function resolveTimerCompletionHandoff(
  input: TimerCompletionHandoffInput
): { assignmentId: string; sessionId: string } | null {
  if (!input.assignmentId) return null;
  if (input.selectedAssignmentId !== null && input.selectedAssignmentId === input.assignmentId) {
    return null; // Drawer 已在眼前：observer 会显示 follow-up，Toast 不再重复引导
  }
  if (!input.assignments.some((a) => a.id === input.assignmentId)) return null;
  return { assignmentId: input.assignmentId, sessionId: input.sessionId };
}

export interface TimerCompletionHandoffRevalidationInput {
  assignmentId: string;
  sessionId: string;
  assignments: { id: string }[];
  focusSessions: FocusSession[];
}

/**
 * Toast action 点击时刻的 safety revalidation（不用闭包旧 snapshot 判断）：
 * 全部满足才返回 intent——Assignment 仍存在；session 仍是 completed timer 且归属一致。
 * 任一不满足 → null（no-op，不写 stale selection、不创建 orphan intent）。
 */
export function revalidateTimerCompletionHandoff(
  input: TimerCompletionHandoffRevalidationInput
): { assignmentId: string; sessionId: string } | null {
  if (!input.assignments.some((a) => a.id === input.assignmentId)) return null;
  const session = input.focusSessions.find((s) => s.id === input.sessionId);
  if (!session) return null;
  if (session.status !== "completed" || session.endReason !== "timer") return null;
  if (session.assignmentId !== input.assignmentId) return null;
  return { assignmentId: input.assignmentId, sessionId: input.sessionId };
}
