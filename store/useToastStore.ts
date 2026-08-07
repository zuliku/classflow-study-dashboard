import { create } from "zustand";

export type ToastType = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  actionLabel?: string;
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
    set((state) => ({
      toasts: [...state.toasts, { ...toast, type: toast.type ?? "success", id }],
    }));
  },
  removeToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
