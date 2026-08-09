/**
 * Kiro Change Set（Task 8）：多写操作事务安全。
 * Multi-write intent → Validate all (projected) → Commit all or commit none.
 */

import { AppState } from "@/store/useAppStore";
import { PreparedWriteAction, PreparedActionView } from "@/lib/ai/tools/write/prepare";

/** 事务安全工具白名单（V1：已有实体操作，无动态 ID 依赖；create_* 单独执行） */
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
] as const;

export type TransactionSafeToolName = (typeof KIRO_TRANSACTION_SAFE_TOOL_NAMES)[number];

/** Change Set 内部最大 mutation 数（与 MAX_WRITE_TOOL_CALLS_PER_TURN 对齐，防绕过） */
export const MAX_CHANGE_SET_ACTIONS = 8;

export type ChangeSetRisk = "normal" | "bulk" | "destructive";

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
