"use client";

import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from "lucide-react";
import { useToastStore, Toast, ToastType } from "@/store/useToastStore";
import { cn } from "@/lib/utils";

const TYPE_META: Record<ToastType, { icon: React.ElementType; accent: string }> = {
  success: { icon: CheckCircle2, accent: "#4A7C59" },
  warning: { icon: AlertTriangle, accent: "#D97706" },
  error: { icon: XCircle, accent: "#D94F4F" },
  info: { icon: Info, accent: "#A48F82" },
};

const EXIT_MS = 200;

export function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);
  const [exiting, setExiting] = useState<Set<string>>(new Set());
  const toastsRef = useRef(toasts);
  toastsRef.current = toasts;

  const dismiss = (id: string) => {
    const toast = toastsRef.current.find((t) => t.id === id);
    setExiting((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    window.setTimeout(() => {
      setExiting((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      removeToast(id);
      toast?.onDismiss?.();
    }, EXIT_MS);
  };

  // 自动消失：带操作按钮的提示等待更久，便于用户撤销
  useEffect(() => {
    const timers: number[] = [];
    toasts.forEach((t) => {
      const duration = t.duration ?? (t.actionLabel ? 6000 : 4000);
      timers.push(window.setTimeout(() => dismiss(t.id), duration));
    });
    return () => timers.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toasts]);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed z-[70] bottom-4 right-4 left-4 sm:left-auto sm:bottom-5 sm:right-5 flex flex-col items-end sm:items-end gap-2 pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const { icon: Icon, accent } = TYPE_META[toast.type];
        const isExiting = exiting.has(toast.id);
        return (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto w-full sm:w-auto sm:max-w-sm bg-[#FAF8F5] border border-[#E7E3DD] rounded-xl shadow-card p-3 flex items-start gap-2.5",
              "ux-inline",
              isExiting ? "opacity-0 translate-y-1" : "opacity-100 translate-y-0"
            )}
            role="status"
          >
            <Icon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: accent }} />
            <p className="flex-1 text-xs text-charcoal font-medium leading-relaxed min-w-0">
              {toast.message}
            </p>
            {toast.actionLabel && (
              <button
                onClick={() => {
                  toast.onAction?.();
                  dismiss(toast.id);
                }}
                className="shrink-0 px-1.5 py-0.5 -m-0.5 rounded-lg text-[11px] font-bold text-charcoal hover:bg-[#F0EBE1] transition-colors duration-[var(--motion-fast)]"
              >
                {toast.actionLabel}
              </button>
            )}
            <button
              onClick={() => dismiss(toast.id)}
              className="shrink-0 p-0.5 text-[#8C827A] hover:text-charcoal rounded transition-colors"
              aria-label="关闭提示"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
