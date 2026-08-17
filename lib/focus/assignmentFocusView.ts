/**
 * Task Execution Loop V1：Assignment Detail 的 Focus 只读投影（纯函数，无副作用）。
 * 输入 focusSessions 快照 + 当前任务 id → 输出 UI 所需全部派生事实：
 * - active 关系（current / other / null，仅第一个 running|paused 会话是 active）
 * - 当前任务的已完成统计（只统计 assignmentId 精确匹配且真实结算 actualActiveMs 的会话；
 *   不含 running / paused / plannedMinutes 名义值）
 * 不读 Store / 不读 Date.now()（剩余时长由消费方以 useFocusClock 实时推导，避免污染纯函数）。
 */

import { FocusSession } from "@/types";

export type FocusRelation = "current" | "other";

export interface AssignmentFocusView {
  /** 全局唯一 active 会话（running | paused），无则 null */
  active: FocusSession | null;
  /** active 与当前任务的关系；无 active 时 null */
  relation: FocusRelation | null;
  /**
   * other 关系的展示名：优先 assignmentTitleSnapshot → courseNameSnapshot → 关联任务标题
   * （只读快照；任务删除后仍可展示快照名）
   */
  otherLabel: string | null;
  /** 当前任务已完成会话数（实际计数，不看 plannedMinutes） */
  completedCount: number;
  /** 当前任务已完成真实 active 毫秒精确累计（不 round 分钟） */
  totalCompletedMs: number;
  /** 最近一次完成（endedAt 最大）的会话；无则 null */
  lastCompleted: FocusSession | null;
}

/**
 * 从 focusSessions 快照投影当前任务（assignmentId）的 Focus 视图。
 * - active = sessions 中第一个 running|paused（Domain 保证唯一，取首个保守）
 * - 统计仅归属 assignmentId === assignmentId 的会话（course-only / unbound 不混入）
 * - totalCompletedMs 精确毫秒累加，展示格式化由 formatAccumulatedMs 负责
 */
export function deriveAssignmentFocusView(
  focusSessions: FocusSession[],
  assignmentId: string
): AssignmentFocusView {
  const active = focusSessions.find((s) => s.status === "running" || s.status === "paused") ?? null;

  let relation: FocusRelation | null = null;
  let otherLabel: string | null = null;
  if (active) {
    if (active.assignmentId === assignmentId) {
      relation = "current";
    } else {
      relation = "other";
      otherLabel =
        active.assignmentTitleSnapshot ??
        active.courseNameSnapshot ??
        (active.assignmentId ? active.assignmentId : null);
    }
  }

  let completedCount = 0;
  let totalCompletedMs = 0;
  let lastCompleted: FocusSession | null = null;
  for (const s of focusSessions) {
    if (s.assignmentId !== assignmentId || s.status !== "completed") continue;
    if (s.actualActiveMs === undefined) continue;
    completedCount += 1;
    totalCompletedMs += s.actualActiveMs;
    if (!lastCompleted || (s.endedAt ?? 0) > (lastCompleted.endedAt ?? 0)) lastCompleted = s;
  }

  return { active, relation, otherLabel, completedCount, totalCompletedMs, lastCompleted };
}
