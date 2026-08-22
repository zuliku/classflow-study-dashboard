"use client";

import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from "lucide-react";
import { useToastStore, ToastType } from "@/store/useToastStore";
import { MOTION_MS } from "@/lib/motion";
import { cn } from "@/lib/utils";

// accent 走 semantic color class（= token 值：success/warning/danger/sandrift），不再散落 HEX
const TYPE_META: Record<ToastType, { icon: React.ElementType; accentClass: string }> = {
  success: { icon: CheckCircle2, accentClass: "text-success" },
  warning: { icon: AlertTriangle, accentClass: "text-warning" },
  error: { icon: XCircle, accentClass: "text-danger" },
  info: { icon: Info, accentClass: "text-sandrift" },
};

/**
 * Motion Contract：toast 视觉退出走 ux-inline（--motion-fast），
 * EXIT_MS = MOTION_MS.fast 与之同源——动画结束即移除，不空等也不截断。
 */
const EXIT_MS = MOTION_MS.fast;

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

  // 自动消失：带操作按钮的提示等待更久，便于用户撤销。
  // 每条 Toast 只调度一次定时器（用 ref 去重），
  // 避免其他 Toast 到期触发 effect cleanup 时把本 Toast 的定时器重置。
  const scheduledRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    toasts.forEach((t) => {
      if (scheduledRef.current.has(t.id)) return;
      scheduledRef.current.add(t.id);
      const duration = t.duration ?? (t.actionLabel ? 6000 : 4000);
      window.setTimeout(() => dismiss(t.id), duration);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toasts]);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed z-[70] bottom-24 sm:bottom-5 right-4 left-4 sm:left-auto sm:right-5 flex flex-col items-end sm:items-end gap-2 pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const { icon: Icon, accentClass } = TYPE_META[toast.type];
        const isExiting = exiting.has(toast.id);
        return (
          <div
            key={toast.id}
            className={cn(
              "pointer-events-auto w-full sm:w-auto sm:max-w-sm bg-surface border border-line rounded-xl shadow-card p-3 flex items-start gap-2.5",
              "ux-inline",
              isExiting ? "opacity-0 translate-y-1" : "opacity-100 translate-y-0"
            )}
            role="status"
          >
            <Icon className={cn("w-4 h-4 shrink-0 mt-0.5", accentClass)} />
            <p className="flex-1 text-xs text-charcoal font-medium leading-relaxed min-w-0">
              {toast.message}
            </p>
            {toast.actionLabel && (
              <button
                onClick={() => {
                  toast.onAction?.();
                  dismiss(toast.id);
                }}
                className="shrink-0 px-1.5 py-0.5 -m-0.5 rounded-lg text-[11px] font-bold text-charcoal hover:bg-alabaster transition-colors duration-[var(--motion-fast)]"
              >
                {toast.actionLabel}
              </button>
            )}
            <button
              onClick={() => dismiss(toast.id)}
              className="shrink-0 p-0.5 text-sandrift hover:text-charcoal rounded transition-colors"
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
