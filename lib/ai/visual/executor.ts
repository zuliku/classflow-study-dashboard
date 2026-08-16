/**
 * Visual Action Intake Executor（Task B）：
 * 用户点击「应用全部修改」后由 Proposal Card 客户端直接调用（不经过模型再次调用 Write Tool）。
 * 1. 最新 Store re-preflight（同一批 reserved IDs）→ fingerprint stale 检查（改变 → stale，0 mutation）
 * 2. executeChangeSet with confirmationMode: "preapproved-visual-proposal"（不再弹 generic confirm；
 *    destructive 由 Change Set V2 拒绝）
 * 3. 保留事务安全：schema validation / preflight / re-preflight / conflict detection / atomic commit / rollback / grouped Undo
 */
import { AppState, useAppStore } from "@/store/useAppStore";
import { KiroWriteApi } from "@/lib/ai/tools/write/types";
import { createKiroWriteApi } from "@/lib/ai/tools/write/api";
import { executeChangeSet } from "@/lib/ai/transactions/executor";
import { VisualActionProposal } from "@/lib/ai/visual/types";
import {
  buildVisualProposalExecutionPlan,
  VISUAL_SELECTION_DEPENDENCY_CHANGED_CODE,
} from "@/lib/ai/visual/executionPlan";

export type ExecuteVisualActionProposalResult =
  | {
      ok: true;
      applied: number;
      count: number;
      /** V1.5：本次真正应用的 action ids（runtime-only identity；Undo 只撤销这批） */
      appliedActionIds: string[];
      /** V1.5：本次应用的 action 在 proposal.actions 中的 original index（display projection 用） */
      appliedActionIndexes: number[];
      undo: () => void;
    }
  | { ok: false; stale: true; code: "VISUAL_PROPOSAL_STALE"; message: string; applied: number }
  | { ok: false; stale?: undefined; code: string; message: string; applied: number };

export interface ExecuteVisualActionProposalInput {
  proposal: VisualActionProposal;
  /**
   * V1.5 Selective Apply：用户勾选的 action ids。
   * 默认 undefined = 全部 executable actions（旧调用与测试完全兼容）。
   * 内部永远走 buildVisualProposalExecutionPlan（FULL stale 检查不可绕过）。
   */
  selectedActionIds?: string[];
  /** 默认 useAppStore.getState()（Apply 时最新 Store） */
  state?: AppState;
  /** 默认 createKiroWriteApi（内部捕获 grouped Undo 返回给调用方） */
  api?: KiroWriteApi;
  pushToast?: (t: { message: string; actionLabel?: string; onAction?: () => void; type?: "success" | "warning" | "error" | "info" }) => void;
  /** 默认 async () => true（preapproved；只确认一次由 UI 承担） */
  confirm?: (req: { title: string; description?: unknown; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
}

export async function executeVisualActionProposal(
  input: ExecuteVisualActionProposalInput
): Promise<ExecuteVisualActionProposalResult> {
  const { proposal } = input;
  const state = input.state ?? useAppStore.getState();

  // V1.2：pending-only Proposal 没有可执行内容，防御性拒绝 Apply（UI 不应展示 Apply）
  if (proposal.actions.length === 0) {
    return {
      ok: false,
      stale: undefined,
      code: "VISUAL_PROPOSAL_EMPTY",
      message: "这份截图方案没有可应用的修改。",
      applied: 0,
    };
  }

  // V1.5：Selective Apply —— 执行计划（FULL stale 检查 + subset 语义校验；全程 0 mutation）
  const plan = buildVisualProposalExecutionPlan({
    proposal,
    selectedActionIds: input.selectedActionIds ?? proposal.actions.map((a) => a.id),
    state,
  });
  if (!plan.ok) {
    if (plan.code === "VISUAL_PROPOSAL_STALE") {
      return {
        ok: false,
        stale: true,
        code: "VISUAL_PROPOSAL_STALE",
        message: "这组修改所依据的数据已经变化，需要重新检查。",
        applied: 0,
      };
    }
    return {
      ok: false,
      stale: undefined,
      code: plan.code === VISUAL_SELECTION_DEPENDENCY_CHANGED_CODE ? VISUAL_SELECTION_DEPENDENCY_CHANGED_CODE : plan.code,
      message: plan.message,
      applied: 0,
    };
  }

  // 2. Change Set V2：preapproved-visual-proposal（跳过 generic confirm；destructive 拒绝）
  let capturedUndo: (() => void) | null = null;
  const api =
    input.api ??
    createKiroWriteApi({
      toolCallId: proposal.id,
      pushToast: input.pushToast ?? (() => {}),
      registerUndo: (_id, undo) => {
        capturedUndo = undo;
      },
      onCancelOutput: () => {},
    });

  const result = await executeChangeSet({
    actions: plan.actions,
    reservedIds: plan.reservedIds,
    summary: proposal.summary,
    state,
    api,
    toolCallId: proposal.id,
    confirm: input.confirm ?? (async () => true),
    confirmationMode: "preapproved-visual-proposal",
  });

  if (!result.ok) {
    // 确认后 / 执行瞬间数据再次变化 → re-preflight 失败（视为 stale，UI 引导重新分析）
    if (result.code === "TRANSACTION_REPREFLIGHT_FAILED" || result.code === "TRANSACTION_PREFLIGHT_FAILED") {
      return {
        ok: false,
        stale: true,
        code: "VISUAL_PROPOSAL_STALE",
        message: "这组修改所依据的数据已经变化，需要重新检查。",
        applied: 0,
      };
    }
    return { ok: false, code: result.code, message: result.message, applied: result.applied ?? 0 };
  }

  return {
    ok: true,
    applied: result.applied,
    count: result.changeSet.count,
    // V1.5：本次真正应用的 action（runtime identity；subset 原子语义不变）
    appliedActionIds: plan.selectedIndexes.map((i) => proposal.actions[i].id),
    appliedActionIndexes: [...plan.selectedIndexes],
    undo: () => {
      if (capturedUndo) capturedUndo();
    },
  };
}
