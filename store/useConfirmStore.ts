import { create } from "zustand";
import React from "react";

export interface ConfirmRequest {
  id: string;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  /** 取消时回调（Esc / X / 取消按钮统一触发）；确认按钮不触发 */
  onCancel?: () => void;
}

interface ConfirmState {
  request: ConfirmRequest | null;
  /** 发起一个需要用户明确决策的危险操作确认 */
  confirm: (req: Omit<ConfirmRequest, "id">) => void;
  close: () => void;
}

export const useConfirmStore = create<ConfirmState>((set) => ({
  request: null,
  confirm: (req) =>
    set({ request: { ...req, id: `confirm_${Date.now()}` } }),
  close: () => set({ request: null }),
}));
