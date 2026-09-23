/**
 * Kiro Agent Run V1（P4）— Agent Run 状态 / 结果摘要（纯 Presentation Domain）。
 *
 * 契约：
 * - 状态只能由真实 Runtime Fact 推导（turn lifecycle / phase / Task status / pending approval /
 *   Desktop Session），绝不提供 UI 可直接 set 的 status store；
 * - 不修改任何 Runtime（本模块无副作用、无 store 依赖）；
 * - 优先级固定：waiting-approval > paused > running/composing > failed/cancelled > completed；
 * - 普通 Turn 没有可靠 startedAt/completedAt 时绝不伪造 duration（只显示「已完成」）。
 */
import type { KiroTurnPhase } from "@/lib/ai/presentation/turnPresentation";
import type { KiroAgentTaskStatus } from "@/lib/ai/computer/task";

export type KiroAgentRunStatus =
  | "running"
  | "composing"
  | "waiting-approval"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface KiroAgentRunFacts {
  /** 真实 turn lifecycle：turnExecution !== "settled" */
  turnInFlight: boolean;
  /** Assistant Turn phase（begin_final_answer lane contract；可选——无 turn 时缺省） */
  phase?: KiroTurnPhase;
  /** owning Computer Task 的真实 status（live；历史任务不进入 resolver） */
  taskStatus?: KiroAgentTaskStatus;
  /** 存在属于本 Run 的待决策审批（approval.taskId === task.id） */
  waitingApproval: boolean;
  /** Desktop GUI Session 已暂停（仅 live run 生效） */
  desktopPaused?: boolean;
}

/**
 * 纯推导 Agent Run Status。
 * - waiting-approval：任何审批等待都必须优先表达（Rail 同源）
 * - paused：Desktop Session 暂停且 Run 仍在进行（暂停是控制面事实，不是失败）
 * - failed / cancelled：只在 Run 已结束（turn settled）后由 Task 终态表达——
 *   in-flight 期间单步失败/拒绝仍属于进行中的 Run（模型会继续处理）
 * - composing：boundary 已到、Final Answer 首 token 未到（唯一严格含义）
 */
export function resolveKiroAgentRunStatus(facts: KiroAgentRunFacts): KiroAgentRunStatus {
  if (facts.waitingApproval) return "waiting-approval";
  if (facts.turnInFlight) {
    if (facts.desktopPaused) return "paused";
    return facts.phase === "composing" || facts.phase === "answering" ? "composing" : "running";
  }
  if (facts.taskStatus === "failed") return "failed";
  if (facts.taskStatus === "cancelled") return "cancelled";
  return "completed";
}

/** Header 文案（低频状态；绝不进入 token hot path） */
export const KIRO_AGENT_RUN_STATUS_TEXT: Record<KiroAgentRunStatus, string> = {
  running: "正在执行",
  composing: "正在整理回答",
  "waiting-approval": "等待你的确认",
  paused: "已暂停",
  completed: "已完成",
  failed: "操作未完成",
  cancelled: "已停止",
};

/** Header 文案：GUI 操作进行中 → 「正在操作电脑」（Computer Session 事实优先于泛化文案） */
export function kiroAgentRunHeaderText(
  status: KiroAgentRunStatus,
  opts?: { desktopActive?: boolean }
): string {
  if (status === "running" && opts?.desktopActive) return "正在操作电脑";
  return KIRO_AGENT_RUN_STATUS_TEXT[status];
}

/** 是否处于进行中（Header 活跃信号 / 停止入口） */
export function isKiroAgentRunActive(status: KiroAgentRunStatus): boolean {
  return (
    status === "running" ||
    status === "composing" ||
    status === "waiting-approval" ||
    status === "paused"
  );
}

/** 已结束（Result 区只在终态显示） */
export function isKiroAgentRunTerminal(status: KiroAgentRunStatus): boolean {
  return !isKiroAgentRunActive(status);
}

/**
 * 真实任务用时（只用 Task 的 startedAt/completedAt；无可靠时间戳 → null，绝不伪造）。
 * 输出例：用时 42s / 用时 1m 42s / 用时 1h 2m。
 */
export function formatKiroAgentRunDuration(input: {
  startedAt?: string;
  completedAt?: string;
}): string | null {
  const started = Date.parse(input.startedAt ?? "");
  const completed = Date.parse(input.completedAt ?? "");
  if (!Number.isFinite(started) || !Number.isFinite(completed)) return null;
  const ms = completed - started;
  if (ms < 0) return null;
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `用时 ${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `用时 ${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `用时 ${hours}h ${minutes % 60}m`;
}

/** Result 摘要事实（Terminal execute 绝不混入「文件更改」） */
export interface ComputerTaskResultSummary {
  fileChangeCount: number;
  commandCount: number;
  totalCount: number;
}

export function summarizeComputerTaskResult(task: {
  changes: Array<{ operation: string }>;
}): ComputerTaskResultSummary {
  let fileChangeCount = 0;
  let commandCount = 0;
  for (const change of task.changes) {
    if (change.operation === "execute") commandCount += 1;
    else fileChangeCount += 1;
  }
  return { fileChangeCount, commandCount, totalCount: fileChangeCount + commandCount };
}

/**
 * 泛化 Result Summary（§22）：
 * - 只文件变更 → 已完成 N 项文件更改
 * - 只 Terminal → 已运行 N 个命令
 * - 混合 → 已完成 N 项操作
 * - 无 changes 且完成 → 已完成
 * - failed / cancelled 且无 changes → 操作未完成 / 已停止（不谎称完成）
 */
export function formatComputerTaskResultSummary(task: {
  status: KiroAgentTaskStatus;
  changes: Array<{ operation: string }>;
}): string {
  const { fileChangeCount, commandCount, totalCount } = summarizeComputerTaskResult(task);
  if (totalCount === 0) {
    if (task.status === "failed") return "操作未完成";
    if (task.status === "cancelled") return "已停止";
    if (task.status === "undone") return "已撤销";
    return "已完成";
  }
  if (commandCount > 0 && fileChangeCount === 0) return `已运行 ${commandCount} 个命令`;
  if (commandCount === 0) return `已完成 ${fileChangeCount} 项文件更改`;
  return `已完成 ${totalCount} 项操作`;
}

/**
 * Approval ownership（§9）：pendingApproval.taskId → owning assistant message id。
 * 只按真实 ComputerApprovalRequest.taskId 与 owning Computer Task id 精确匹配；
 * 找不到（row 尚未建立 / 恢复竞态 / unexpected state）→ null → orphan fallback Dialog。
 */
export function findApprovalOwnerMessageId(
  messages: Array<{ id: string; computerTask?: { id: string } | null }>,
  taskId: string | null | undefined
): string | null {
  if (!taskId) return null;
  for (const message of messages) {
    if (message.computerTask?.id === taskId) return message.id;
  }
  return null;
}
