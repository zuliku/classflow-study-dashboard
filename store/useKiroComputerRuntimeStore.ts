"use client";

import { create } from "zustand";
import { ComputerApprovalRequest } from "@/lib/ai/computer/approval";

/**
 * Kiro Computer Agent V1 — Runtime UI Store（Part 3）。
 * 只保存 UI 展示所需的轻量状态：pendingApproval（对话框）、reviewTaskId（更改审查）。
 * 禁止保存：tool input / snapshot / File Handle / callbacks / adapterRef / beforeText——
 * 真正 pending executable 属于 useKiroChat refs（runtime-only）。
 */
export interface KiroComputerRuntimeState {
  pendingApproval: ComputerApprovalRequest | null;
  reviewTaskId: string | null;
  pendingQueueLength: number;
  /** S-fix：当前审批自动取消 deadline（unix ms；3 分钟超时计时起点）。
   * UI 倒计时唯一来源；决策/切换/清空时同步清理，过期由超时 effect 推进决策。 */
  approvalDeadlineAt: number | null;
  setPendingApproval: (request: ComputerApprovalRequest | null) => void;
  setReviewTaskId: (taskId: string | null) => void;
  setPendingQueueLength: (n: number) => void;
  setApprovalDeadlineAt: (t: number | null) => void;
  clearRuntime: () => void;
}

export const useKiroComputerRuntimeStore = create<KiroComputerRuntimeState>()((set) => ({
  pendingApproval: null,
  reviewTaskId: null,
  pendingQueueLength: 0,
  approvalDeadlineAt: null,
  // 审批消失（决策/推进到空）→ deadline 同步清理，避免残留倒计时
  setPendingApproval: (request) =>
    set(request ? { pendingApproval: request } : { pendingApproval: request, approvalDeadlineAt: null }),
  setReviewTaskId: (taskId) => set({ reviewTaskId: taskId }),
  setPendingQueueLength: (n) => set({ pendingQueueLength: n }),
  setApprovalDeadlineAt: (t) => set({ approvalDeadlineAt: t }),
  clearRuntime: () => set({ pendingApproval: null, reviewTaskId: null, pendingQueueLength: 0, approvalDeadlineAt: null }),
}));
