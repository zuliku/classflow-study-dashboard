/**
 * Visual Action Intake（Task B）Domain：
 * 截图来源的 ClassFlow 写操作一律先 Preview 再 Apply。
 * 每一项 action 的 change 必须能规范化为 ChangeSetActionInput（不另建一套业务 mutation）。
 * 本模块不保存 confidence 分数：display + evidence 是模型从截图读到的事实，不是概率。
 */
import {
  ChangeSetActionInput,
  TransactionSafeToolName,
} from "@/lib/ai/transactions/types";

export type VisualActionKind =
  | "assignment-create"
  | "assignment-update"
  | "ddl-update"
  | "schedule-cancel"
  | "schedule-move"
  | "schedule-extra"
  | "schedule-permanent-update";

/** V1 白名单（仅此 9 个工具可进入 Visual Proposal；destructive / 课程 / 小组 / 提醒一律拒绝） */
export const VISUAL_PROPOSAL_ALLOWED_TOOLS: ReadonlySet<string> = new Set<string>([
  "create_assignment",
  "update_assignment",
  "set_assignment_ddl",
  "set_assignment_priority",
  "cancel_schedule_occurrence",
  "move_schedule_occurrence",
  "create_extra_schedule_occurrence",
  // 永久修改（仅当截图明确「以后 / 从下周起 / 统一」才允许）
  "move_schedule",
  "update_schedule",
]);

export interface VisualProposalAction {
  id: string;
  /** 必须能直接交给 Change Set V2（真实 entity ID，absolute normalized time） */
  change: ChangeSetActionInput;
  /** 模型从截图读到、促成该 Action 的最短事实（120–160 chars 上限；不保存整张 OCR） */
  evidence: {
    text: string;
  };
  /** Preflight Facts 推导的展示（kind/title/subtitle 全部由 PreparedActionView + state 生成，模型不得决定） */
  display: {
    kind: VisualActionKind;
    title: string;
    subtitle?: string;
  };
}

/** V1.2：Pending 原因（只支持三种；不允许 low-confidence / other / conflict / stale / duplicate 等猜测性原因） */
export type VisualPendingReason =
  | "ambiguous-entity"
  | "missing-information"
  | "unsupported-action";

export const VISUAL_PENDING_REASONS: readonly VisualPendingReason[] = [
  "ambiguous-entity",
  "missing-information",
  "unsupported-action",
];

/** V1.2：已识别但当前不能安全执行的事项（完全不具备执行能力：无 change/tool/input） */
export interface VisualPendingItem {
  id: string;
  reason: VisualPendingReason;
  /** 模型从截图读到、促成该项的最短事实（120–160 chars 上限） */
  evidence: {
    text: string;
  };
  /** 为什么现在不能安全执行（如「无法唯一确定对应课程」）；不是 mutation fact */
  description: string;
}

export interface VisualActionProposal {
  id: string;
  sourceAttachmentIds: string[];
  summary: string;
  actions: VisualProposalAction[];
  /** V1.2：Runtime normalize 后始终存在（无 pending 时为 []），便于 Card 简化 */
  pendingItems: VisualPendingItem[];
  createdAt: number;
  /**
   * 创建 Proposal 时基于 preflight preview（normalized actions + before + 实体标识）生成；
   * Apply 时基于最新 Store 重新计算，不一致 → stale（0 mutation）。
   * actions.length === 0（pending-only）时不存在（undefined），绝不伪造。
   */
  previewFingerprint?: string;
  /**
   * 客户端事务层为 create 操作预留的实体 ID（仅客户端内部使用，不进 LLM schema）。
   * Apply 时 re-preflight 复用同一批 ID，保证 fingerprint 与 commit 实体 ID 一致。
   * 只来自 executable actions。
   */
  reservedIds: (string | undefined)[];
}

export const VISUAL_PROPOSAL_ALLOWED_TOOL_CHECK = (tool: string): tool is TransactionSafeToolName =>
  VISUAL_PROPOSAL_ALLOWED_TOOLS.has(tool);

/** 工具名 → 展示 kind（白名单内的确定性映射） */
export const VISUAL_KIND_OF_TOOL: Record<string, VisualActionKind> = {
  create_assignment: "assignment-create",
  update_assignment: "assignment-update",
  set_assignment_ddl: "ddl-update",
  set_assignment_priority: "assignment-update",
  cancel_schedule_occurrence: "schedule-cancel",
  move_schedule_occurrence: "schedule-move",
  create_extra_schedule_occurrence: "schedule-extra",
  move_schedule: "schedule-permanent-update",
  update_schedule: "schedule-permanent-update",
};

export const VISUAL_ACTION_KINDS: readonly VisualActionKind[] = [
  "assignment-create",
  "assignment-update",
  "ddl-update",
  "schedule-cancel",
  "schedule-move",
  "schedule-extra",
  "schedule-permanent-update",
];
