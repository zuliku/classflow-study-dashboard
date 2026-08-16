/**
 * Change Set Executor（Task 8）：
 * Preflight（projected）→ Risk → Confirm → Re-preflight（最新 Store）→ Commit with rollback → grouped Undo。
 * 任何失败：Commit None（preflight/confirm 阶段）或自动逆序回滚（commit 运行时异常）。
 * 禁止 useAppStore.setState 回滚；只通过现有 domain actions / undo 语义。
 */

import { AppState } from "@/store/useAppStore";
import { KiroWriteApi } from "@/lib/ai/tools/write/types";
import {
  ChangeSetActionInput,
  ChangeSetExecuteResult,
  ChangeSetSuccess,
} from "@/lib/ai/transactions/types";
import { preflightChangeSet, changeSetRequiresConfirm, changeSetConfirmText, reserveCreateIds } from "@/lib/ai/transactions/preflight";

export interface ConfirmRequestLike {
  title: string;
  description?: unknown;
  confirmLabel?: string;
  danger?: boolean;
  /** 由适配层填充 */
  onConfirm?: () => void;
  onCancel?: () => void;
}

export interface ExecuteChangeSetInput {
  actions: ChangeSetActionInput[];
  summary?: string;
  /** 最新 Store（useAppStore.getState()） */
  state: AppState;
  api: KiroWriteApi;
  toolCallId: string;
  /** 需要确认时调用（内部用 Promise 等待用户决定） */
  confirm: (req: ConfirmRequestLike) => Promise<boolean>;
  /**
   * Task 7：确认模式（内部 caller option，不进 LLM Tool schema）。
   * preapproved-visual-proposal：Visual Proposal Card 已明确点击「应用全部修改」——
   * 不重复弹 generic confirm（bulk/normal 直接执行）；destructive 一律拒绝。
   */
  confirmationMode?: import("@/lib/ai/transactions/types").ChangeSetConfirmationMode;
  /**
   * Visual Intake V1.5：internal caller-only —— Selective Apply 的确定性 identity。
   * 默认 reserveCreateIds(actions)（现有调用行为完全不变）。
   * 绝不暴露给 LLM schema / Tool input / 持久化；模型永远无法提供 reserved ID。
   * 长度必须与 actions 一致（由调用方保证；preflight 只取下标对齐项）。
   */
  reservedIds?: (string | undefined)[];
}

/**
 * 执行 Change Set。确认后 / 执行前会基于最新 Store 重新 Preflight。
 */
export async function executeChangeSet(input: ExecuteChangeSetInput): Promise<ChangeSetExecuteResult> {
  const { actions, summary, api, toolCallId, confirmationMode = "normal" } = input;

  // Task 7：create 操作的实体 ID 只预留一次 → Preflight / Re-preflight / Commit 使用同一批 ID
  // Visual Intake V1.5：Selective Apply 传入与执行计划对齐的 reservedIds（caller-only；默认行为不变）
  const reservedIds = input.reservedIds ?? reserveCreateIds(actions);
  if (reservedIds.length !== actions.length) {
    // 防御：长度不对齐会破坏 create ID 的 Preflight→Commit 一致性，绝不静默降级
    return {
      ok: false,
      code: "TRANSACTION_PREFLIGHT_FAILED",
      message: "修改计划校验失败（reserved ID 与操作数不一致），没有执行任何修改。",
      applied: 0,
    };
  }

  // 1. Preflight（projected）
  const preflight = preflightChangeSet({ actions, reservedIds }, input.state);
  if (!preflight.ok) {
    return {
      ok: false,
      code: "TRANSACTION_PREFLIGHT_FAILED",
      failedActionIndex: preflight.failedActionIndex,
      message: preflight.message,
      applied: 0,
    };
  }

  // 2. Risk → Confirm
  if (confirmationMode === "preapproved-visual-proposal") {
    // Visual Proposal 已确认：跳过 generic confirm；destructive 永远拒绝（Task B V1 无 destructive）
    if (preflight.risk === "destructive") {
      return {
        ok: false,
        code: "TRANSACTION_PREFLIGHT_FAILED",
        message: "该修改包含高风险操作（删除类），不能通过视觉提案预批准执行。",
        applied: 0,
      };
    }
  } else if (changeSetRequiresConfirm(preflight.risk)) {
    const lines = changeSetConfirmText(preflight.preview);
    const confirmed = await input.confirm({
      title: `Kiro 准备执行 ${preflight.preview.length} 项修改`,
      description: lines.map((l) => `• ${l}`).join("\n"),
      confirmLabel: "确认执行",
      danger: preflight.risk === "destructive",
    });
    if (!confirmed) {
      return { ok: false, code: "USER_CANCELLED", message: "用户取消了操作。", applied: 0 };
    }
  }

  // 3. Re-preflight：以最新 Store 重新校验（确认期间数据可能已变化）
  const freshState = api.getState();
  const re = preflightChangeSet({ actions, reservedIds }, freshState);
  if (!re.ok) {
    return {
      ok: false,
      code: "TRANSACTION_REPREFLIGHT_FAILED",
      failedActionIndex: re.failedActionIndex,
      message: "相关数据刚刚发生变化，我没有执行这组修改。可以重新检查后再继续。",
      applied: 0,
    };
  }

  // 4. Commit with rollback stack（commit 内部使用现有 domain actions）
  const rollbackStack: (() => void)[] = [];
  try {
    for (const prep of re.actions) {
      const r = prep.commit(api, toolCallId);
      if (r === null) throw new Error(`commit failed: ${prep.view.tool}`);
      if (r.undo) rollbackStack.push(r.undo);
    }
  } catch (err) {
    // 逆序回滚（最后执行 → 最先撤销）
    for (let i = rollbackStack.length - 1; i >= 0; i--) {
      try {
        rollbackStack[i]();
      } catch {
        /* 回滚失败不阻断继续回滚 */
      }
    }
    return {
      ok: false,
      code: "EXECUTION_FAILED",
      message: "执行过程中出现异常，已自动回滚，没有留下部分修改。",
      applied: 0,
    };
  }

  // 5. 成功：注册一个整体 Undo（一次性撤销整组）
  const undoAll = () => {
    for (let i = rollbackStack.length - 1; i >= 0; i--) {
      try {
        rollbackStack[i]();
      } catch {
        /* 忽略 */
      }
    }
  };
  api.registerUndo(toolCallId, undoAll);

  const changeSet: ChangeSetSuccess = {
    count: re.actions.length,
    summary: (summary ?? "").trim() || `已完成 ${re.actions.length} 项修改`,
    actions: re.actions.map((p) => p.view),
    canUndo: true,
  };
  return { ok: true, changeSet, applied: re.actions.length };
}
