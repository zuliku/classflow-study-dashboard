/**
 * Task Breakdown（Part C）：Kiro 任务拆解 + 估时 Proposal。
 * - Proposal：AI 推理生成的建议（结构化，非 Markdown），UI 侧严格 schema 校验；
 *   仅 UI 展示，绝不直接写入 Store。
 * - Apply：用户确认后写入 Subtask.title（沿用现有 Subtask Domain，不扩 schema）
 *   与 Assignment.estimatedMinutes（用户确认勾选时）。
 * - 安全边界：已有 Subtasks 必须显式选择 追加/替换；submitted/completed 任务禁止 Apply；
 *   Undo 恢复完整快照（Subtasks / estimatedMinutes / progress / status）。
 */

import { z } from "zod";
import { Assignment } from "@/types";
import { createId } from "@/lib/utils";

/** Proposal 内每个步骤的估时（proposal-only，Apply 时不写入 Subtask） */
export interface TaskBreakdownSubtaskProposal {
  title: string;
  estimatedMinutes?: number;
}

/** Kiro 任务拆解 Proposal（模型生成 → UI 校验 → 用户确认 → Apply） */
export interface TaskBreakdownProposal {
  assignmentId: string;
  /** AI 估计总耗时（source=ai-estimate；未确认写入前不代表 Health 事实） */
  suggestedEstimatedMinutes?: number;
  /** 2～8 个有意义可执行的阶段（估时专用场景可为空） */
  subtasks: TaskBreakdownSubtaskProposal[];
  /** 拆解依据（简要） */
  rationale?: string[];
}

export const TaskBreakdownSubtaskSchema = z.object({
  title: z.string().trim().min(1).max(120),
  estimatedMinutes: z.number().int().min(1).max(10080).optional(),
});

export const TaskBreakdownProposalSchema = z
  .object({
    assignmentId: z.string().trim().min(1).max(120),
    subtasks: z.array(TaskBreakdownSubtaskSchema).min(2).max(8).optional(),
    suggestedEstimatedMinutes: z.number().int().min(1).max(10080).optional(),
    rationale: z.array(z.string().trim().min(1).max(300)).max(8).optional(),
  })
  .refine((v) => (v.subtasks && v.subtasks.length > 0) || v.suggestedEstimatedMinutes !== undefined, {
    message: "拆解建议至少包含步骤或预计耗时。",
  });

/** 校验模型生成的 Proposal；非法返回 null（UI 不显示 Apply） */
export function parseTaskBreakdownProposal(input: unknown): TaskBreakdownProposal | null {
  const parsed = TaskBreakdownProposalSchema.safeParse(input);
  if (!parsed.success) return null;
  return {
    assignmentId: parsed.data.assignmentId,
    suggestedEstimatedMinutes: parsed.data.suggestedEstimatedMinutes,
    subtasks: (parsed.data.subtasks ?? []).map((s) => ({
      title: s.title,
      estimatedMinutes: s.estimatedMinutes,
    })),
    rationale: parsed.data.rationale,
  };
}

export type ApplyBreakdownMode = "append" | "replace";

export interface ApplyTaskBreakdownInput {
  assignmentId: string;
  subtaskTitles: string[];
  mode: ApplyBreakdownMode;
  /** 用户确认写入的预计耗时（未确认则不传） */
  estimatedMinutes?: number;
}

export type ApplyTaskBreakdownResult =
  | { ok: true; assignment: Assignment; undo: () => void }
  | { ok: false; code: "NOT_FOUND" | "NOT_ACTIVE" | "EMPTY"; message: string };

/** Apply 所需的 Store 最小接口（调用方传入最新 Store） */
export interface ApplyTaskBreakdownState {
  assignments: Assignment[];
  updateAssignment: (a: Assignment) => void;
}

/**
 * Apply 任务拆解（Domain Action，唯一实现）：
 * - replace：用新步骤替换（已完成步骤一并移除，必须用户显式确认）→ progress/status 按新步骤重算（全未完成 → 0/todo）
 * - append：保留现有步骤与进度，新步骤追加
 * - estimatedMinutes 仅用户确认后写入
 * - undo：恢复完整快照（Subtasks / estimatedMinutes / progress / status）
 */
export function applyTaskBreakdown(
  input: ApplyTaskBreakdownInput,
  state: ApplyTaskBreakdownState
): ApplyTaskBreakdownResult {
  const assignment = state.assignments.find((a) => a.id === input.assignmentId);
  if (!assignment) {
    return { ok: false, code: "NOT_FOUND", message: "任务不存在或已被删除。" };
  }
  if (assignment.status === "submitted" || assignment.status === "completed") {
    return {
      ok: false,
      code: "NOT_ACTIVE",
      message: "已提交/已完成的任务不能应用拆解（防止把状态改回待完成）。",
    };
  }
  const titles = input.subtaskTitles.map((t) => t.trim()).filter((t) => t.length > 0);
  if (titles.length === 0) {
    return { ok: false, code: "EMPTY", message: "拆解步骤为空。" };
  }

  const existing = assignment.subtasks ?? [];
  const newSubtasks = titles.map((title) => ({ id: createId("st"), title, completed: false }));
  let subtasks = newSubtasks;
  let progress = assignment.progress;
  // 注意：前面已排除 submitted/completed，但 status 在此处的窄化类型仅为 todo|doing，需显式宽化
  let status: Assignment["status"] = assignment.status;

  if (input.mode === "append") {
    subtasks = [...existing, ...newSubtasks];
  } else {
    // replace：按新步骤重算（新步骤全未完成 → progress 0 / todo）
    const compCount = subtasks.filter((st) => st.completed).length;
    progress = Math.round((compCount / subtasks.length) * 100);
    status = progress === 100 ? "completed" : progress > 0 ? "doing" : "todo";
  }

  const next: Assignment = {
    ...assignment,
    subtasks,
    progress,
    status,
    estimatedMinutes:
      input.estimatedMinutes !== undefined ? input.estimatedMinutes : assignment.estimatedMinutes,
  };

  state.updateAssignment(next);

  return {
    ok: true,
    assignment: next,
    // 完整快照撤销：恢复原 Assignment 原样（同 id 覆盖，DDL CalendarMark 由 store 自动同步）
    undo: () => state.updateAssignment(assignment),
  };
}
