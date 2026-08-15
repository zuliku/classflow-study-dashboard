/**
 * Kiro Change Set（Task 8）：多写操作事务安全。
 * Multi-write intent → Validate all (projected) → Commit all or commit none.
 */

import { AppState } from "@/store/useAppStore";
import { PreparedWriteAction, PreparedActionView } from "@/lib/ai/tools/write/prepare";

/** 事务安全工具白名单（V2：新增 create_assignment + 三个一次性排课 override create；
 *  create 的实体 ID 由客户端事务层 reserve（reserveCreateIds），Preflight → Re-preflight → Commit 保持一致；
 *  不加入 create_course / create_group_project / create_reminder） */
export const KIRO_TRANSACTION_SAFE_TOOL_NAMES = [
  "update_assignment",
  "set_assignment_ddl",
  "set_assignment_priority",
  "set_assignment_status",
  "set_assignment_progress",
  "toggle_assignment_subtask",
  "delete_assignment",
  "move_schedule",
  "resize_schedule",
  "update_schedule",
  "exclude_schedule_week",
  "delete_schedule",
  "update_course",
  "update_group_project",
  "update_group_member",
  "update_group_task",
  "assign_group_task",
  "set_group_task_ddl",
  "toggle_group_task",
  // Task 7 Change Set V2：create actions（reserved-ID 事务化）
  "create_assignment",
  "cancel_schedule_occurrence",
  "move_schedule_occurrence",
  "create_extra_schedule_occurrence",
] as const;

export type TransactionSafeToolName = (typeof KIRO_TRANSACTION_SAFE_TOOL_NAMES)[number];

/** Change Set 内部最大 mutation 数（与 MAX_WRITE_TOOL_CALLS_PER_TURN 对齐，防绕过） */
export const MAX_CHANGE_SET_ACTIONS = 8;

export type ChangeSetRisk = "normal" | "bulk" | "destructive";

/** Task 7：Change Set 确认模式（内部 caller option，不进 LLM Tool schema）。
 *  normal：保持现有行为（bulk/destructive 弹 generic confirm）。
 *  preapproved-visual-proposal：Visual Proposal Card 已明确点击「应用全部修改」——
 *  不重复弹 generic confirm；destructive 一律拒绝（Task B V1 不允许 destructive）。 */
export type ChangeSetConfirmationMode = "normal" | "preapproved-visual-proposal";

export interface ChangeSetActionInput {
  tool: TransactionSafeToolName;
  input: unknown;
}

export type ChangeSetPreflightResult =
  | {
      ok: true;
      actions: PreparedWriteAction[];
      risk: ChangeSetRisk;
      preview: PreparedActionView[];
      projected: AppState;
    }
  | {
      ok: false;
      failedActionIndex: number;
      code: string;
      message: string;
      details?: unknown;
    };

export interface ChangeSetSuccess {
  count: number;
  summary: string;
  actions: PreparedActionView[];
  canUndo: boolean;
}

export type ChangeSetExecuteResult =
  | { ok: true; changeSet: ChangeSetSuccess; applied: number }
  | {
      ok: false;
      code: string;
      failedActionIndex?: number;
      message: string;
      applied: number;
      details?: unknown;
    };
