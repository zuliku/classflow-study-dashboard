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
  /** 队列超限被挤出：ToastViewport 播放高度折叠后再真正移除 */
  retiring?: boolean;
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
      // 同文案 2s 内去重，避免批量操作刷屏（正在退出的不参与）
      const now = Date.now();
      const lastSame = [...state.toasts]
        .reverse()
        .find(
          (t) =>
            !t.retiring &&
            t.message === toast.message &&
            t.type === (toast.type ?? "success")
        );
      if (lastSame) {
        const ts = Number(lastSame.id.split("_")[1]);
        if (!Number.isNaN(ts) && now - ts < 2000) return state;
      }

      const retiring = state.toasts.filter((t) => t.retiring);
      // 极端 burst 防无界：最多保留一条正在退出的 Toast，更早的直接清理。
      const dropped = retiring.slice(0, -1);
      for (const t of dropped) {
        try {
          t.onDismiss?.();
        } catch {
          /* 忽略清理回调异常 */
        }
      }
      const keepRetiring = retiring.slice(-1);
      const active = state.toasts.filter((t) => !t.retiring);
      const next = [...active, { ...toast, type: toast.type ?? "success", id }];

      // 队列上限 3：优先挤最旧的非紧急（success/info），error/warning 关键信息不被随后 success 顶掉；
      // 挤出不再直接 splice，而是标记 retiring，让 ToastViewport 播放高度折叠后再移除。
      if (next.length > 3) {
        const victimIdx = next.findIndex(
          (t) =>
            t.id !== id &&
            !t.retiring &&
            t.type !== "error" &&
            t.type !== "warning"
        );
        const idx = victimIdx >= 0 ? victimIdx : next.findIndex((t) => t.id !== id && !t.retiring);
        if (idx >= 0) next[idx] = { ...next[idx], retiring: true };
      }
      return { toasts: [...keepRetiring, ...next] };
    });
  },
  removeToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
