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
  setPendingApproval: (request: ComputerApprovalRequest | null) => void;
  setReviewTaskId: (taskId: string | null) => void;
  clearRuntime: () => void;
}

export const useKiroComputerRuntimeStore = create<KiroComputerRuntimeState>()((set) => ({
  pendingApproval: null,
  reviewTaskId: null,
  setPendingApproval: (request) => set({ pendingApproval: request }),
  setReviewTaskId: (taskId) => set({ reviewTaskId: taskId }),
  clearRuntime: () => set({ pendingApproval: null, reviewTaskId: null }),
}));
