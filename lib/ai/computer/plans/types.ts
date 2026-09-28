/**
 * Kiro Computer Agent — 执行计划（plan-approve 模式）。
 * Plan 模式（只读）下模型完成调研后调用 propose_execution_plan 提交结构化计划；
 * 用户批准后切换执行模式按计划执行；执行中超出计划的 mutation 强制回审批（偏离门）。
 *
 * 计划对象是纯数据（per-conversation，随会话记录落盘）；单次语义由 status 保证。
 */
import type { ComputerCapability } from "@/lib/ai/computer/types";

/** 计划内单步（偏离门匹配锚点；至少携带一个 scope 锚点，见 validatePlanStepAnchors） */
export interface PlanStepInput {
  title: string;
  detail?: string;
  toolName?: string;
  capability?: ComputerCapability;
  rootId?: string;
  /** 文件/文档目标相对路径（move 步骤填源路径） */
  path?: string;
  /** 路径前缀（批量/目录级步骤） */
  pathPrefix?: string;
  /** 终端命令前缀（shell 步骤必填；执行时按 startsWith 匹配） */
  commandPrefix?: string;
  /** 文档更新目标 artifact */
  artifactId?: string;
  /** desktop_action 动作名（click/type/key/…；GUI 步骤必填） */
  action?: string;
}

export interface ProposeExecutionPlanInput {
  title: string;
  goal?: string;
  steps: PlanStepInput[];
}

export interface PersistedPlanStep extends PlanStepInput {
  id: string;
  done: boolean;
}

export type ExecutionPlanStatus =
  | "proposed"
  | "approved"
  | "completed"
  | "deviated"
  | "cancelled"
  | "superseded";

export interface PersistedExecutionPlan {
  planId: string;
  conversationId: string;
  title: string;
  goal?: string;
  status: ExecutionPlanStatus;
  steps: PersistedPlanStep[];
  proposingToolCallId: string;
  /** 提案时的 owning assistant message（卡片绑定；live/恢复统一，不依赖 parts） */
  proposingMessageId: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  completedAt?: string;
  /** 超计划放行次数（>0 则状态至少为 deviated） */
  deviationCount: number;
}
