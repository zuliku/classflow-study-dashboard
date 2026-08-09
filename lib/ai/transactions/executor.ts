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
import { preflightChangeSet, changeSetRequiresConfirm, changeSetConfirmText } from "@/lib/ai/transactions/preflight";

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
}

/**
 * 执行 Change Set。确认后 / 执行前会基于最新 Store 重新 Preflight。
 */
export async function executeChangeSet(input: ExecuteChangeSetInput): Promise<ChangeSetExecuteResult> {
  const { actions, summary, api, toolCallId } = input;

  // 1. Preflight（projected）
  const preflight = preflightChangeSet({ actions }, input.state);
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
  if (changeSetRequiresConfirm(preflight.risk)) {
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
  const re = preflightChangeSet({ actions }, freshState);
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
