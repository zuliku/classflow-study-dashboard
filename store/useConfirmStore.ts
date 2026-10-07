import { create } from "zustand";
import React from "react";

export interface ConfirmRequest {
  id: string;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  /** 取消时回调（Esc / X / 取消按钮统一触发）；确认按钮不触发 */
  onCancel?: () => void;
}

interface ConfirmState {
  /** 队首即当前展示（兼容旧单例读取）；队列保证连发确认不互相覆盖 */
  request: ConfirmRequest | null;
  queue: ConfirmRequest[];
  /** 发起一个需要用户明确决策的危险操作确认 */
  confirm: (req: Omit<ConfirmRequest, "id">) => void;
  close: () => void;
}

export const useConfirmStore = create<ConfirmState>((set) => ({
  request: null,
  queue: [],
  confirm: (req) =>
    set((state) => {
      const next = { ...req, id: `confirm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` };
      const queue = [...state.queue, next];
      return { queue, request: queue[0] ?? null };
    }),
  close: () =>
    set((state) => {
      // 兼容测试直写 request：队列为空时直接清 request
      if (state.queue.length === 0) return { request: null };
      const queue = state.queue.slice(1);
      return { queue, request: queue[0] ?? null };
    }),
}));
