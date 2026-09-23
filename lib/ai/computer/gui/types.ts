/**
 * Computer Use Phase 2 — Desktop Action（renderer 侧类型契约）。
 */
import type { KiroComputerTurnSnapshot } from "@/lib/ai/contextBudget/types";
import type { ComputerPermissionRule, KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import type { ComputerOneShotApproval } from "@/lib/ai/computer/approval";
import type { ComputerExecutionAttempt } from "@/lib/ai/computer/result";
import type { DesktopObservationUiEvidence } from "@/lib/ai/computer/gui/uiEvidence";

export type { GuiControlCapabilityState } from "@/lib/ai/computer/gui/capability";
export type { GuiRiskContext, GuiRiskDecision } from "@/lib/ai/computer/gui/risk";

export const DESKTOP_ACTION_TOOL_NAME = "desktop_action";

export interface GuiActionCounters {
  readCount: number;
  mutationCount: number;
  terminalCount: number;
}

export interface ExecuteDesktopActionRequest {
  toolCallId: string;
  toolInput: unknown;
  snapshot: KiroComputerTurnSnapshot;
  liveWorkspaces: KiroWorkspaceMeta[];
  livePermissionRules: ComputerPermissionRule[];
  counters: GuiActionCounters;
  oneShotApprovals: ComputerOneShotApproval[];
  taskId: string;
  /** 与 executor 的 COMPUTER_MUTATION_LIMIT_PER_TURN 一致（参数化避免循环依赖） */
  mutationLimitPerTurn: number;
  /** Emergency Stop：Stop 后所有 GUI 动作拒绝执行 */
  isCancelled?: () => boolean;
  /**
   * P5：真实 re-observation 截图证据（UI-only「最近画面」）。
   * 只在 bridge.action 成功后、且存在新 observation / 截图 / 非受保护应用时触发；
   * 绝不改变 Tool Output（模型仍只收到 summarizeObservation）。
   */
  onObservationEvidence?: (evidence: DesktopObservationUiEvidence) => void;
  now?: () => number;
}

export type DesktopActionAttempt = ComputerExecutionAttempt;
