import { create } from "zustand";

export type ToastType = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  actionLabel?: string;
  /** 动作按钮读屏名（缺省用“动作+消息”合成；撤销类请传带对象名，如“撤销删除 3 项任务”） */
  actionAriaLabel?: string;
  onAction?: () => void;
  duration?: number;
  /** 提示自动消失（未撤销）时回调，用于延迟清理（如 IndexedDB Blob） */
  onDismiss?: () => void;
}

interface ToastState {
  toasts: Toast[];
  pushToast: (toast: Omit<Toast, "id" | "type"> & { type?: ToastType }) => void;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  pushToast: (toast) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    set((state) => {
      // 同文案 2s 内去重，避免批量操作刷屏
      const now = Date.now();
      const lastSame = [...state.toasts]
        .reverse()
        .find((t) => t.message === toast.message && t.type === (toast.type ?? "success"));
      if (lastSame) {
        const ts = Number(lastSame.id.split("_")[1]);
        if (!Number.isNaN(ts) && now - ts < 2000) return state;
      }
      const next = [...state.toasts, { ...toast, type: toast.type ?? "success", id }];
      // 队列上限 3：优先挤最旧的非紧急（success/info），error/warning 关键信息不被随后 success 顶掉；
      // 全是紧急时才动最旧紧急；挤掉时补调 onDismiss，避免 Blob 清理泄漏
      if (next.length > 3) {
        const victimIdx = next.findIndex((t) => t.id !== id && t.type !== "error" && t.type !== "warning");
        const idx = victimIdx >= 0 ? victimIdx : 0;
        const [evicted] = next.splice(idx, 1);
        try {
          evicted?.onDismiss?.();
        } catch {
          /* 忽略清理回调异常 */
        }
        return { toasts: next.slice(-3) };
      }
      return { toasts: next };
    });
  },
  removeToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
