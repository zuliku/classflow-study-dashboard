"use client";

import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, XCircle, X } from "lucide-react";
import { useToastStore, ToastType } from "@/store/useToastStore";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import { ExitCollapse } from "@/components/ui/ExitCollapse";
import { cn } from "@/lib/utils";

// accent 走 semantic color class（= token 值：success/warning/danger/sandrift），不再散落 HEX
const TYPE_META: Record<ToastType, { icon: React.ElementType; accentClass: string }> = {
  success: { icon: CheckCircle2, accentClass: "text-success" },
  warning: { icon: AlertTriangle, accentClass: "text-warning" },
  error: { icon: XCircle, accentClass: "text-danger" },
  info: { icon: Info, accentClass: "text-sandrift" },
};

/**
 * Motion Contract：toast 视觉退出先走 120ms opacity/translate，外层 ExitCollapse
 * 同步做 190ms 高度折叠；卸载等待取 panel 档，保证退出尾段不被截断。
 * 这样关闭一条 Toast 时，其余 Toast 会随折叠平滑上移，而不是硬跳。
 */
const EXIT_MS = MOTION_EXIT_MS.panel;

export function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);
  const reducedMotion = useEffectiveReducedMotion();
  const [exiting, setExiting] = useState<Set<string>>(new Set());
  // action 单发守卫：按钮在退出动画期间仍可点击，双击会把「撤销」执行两次
  //（restoreSchedule 曾因此插入重复 id 实体）。点击一次后立即禁用。
  const actionTakenRef = useRef<Set<string>>(new Set());
  /** 退出窗口内防重复：关闭按钮/自动计时器可能同时触发 dismiss。 */
  const dismissingRef = useRef<Set<string>>(new Set());
  const toastsRef = useRef(toasts);
  toastsRef.current = toasts;

  const dismiss = (id: string) => {
    if (dismissingRef.current.has(id)) return;
    dismissingRef.current.add(id);
    const toast = toastsRef.current.find((t) => t.id === id);
    // reduced-motion 下 CSS 过渡已近即时：跳过退出等待，直接移除（usePresence reduced 语义）
    if (reducedMotion) {
      dismissingRef.current.delete(id);
      removeToast(id);
      toast?.onDismiss?.();
      return;
    }
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
      dismissingRef.current.delete(id);
      removeToast(id);
      toast?.onDismiss?.();
    }, EXIT_MS);
  };

  // 自动消失：带操作按钮的提示等待更久，便于用户撤销。
  // 每条 Toast 只调度一次定时器（用 ref 去重），hover/focus 暂停、离开恢复，
  // 避免键盘聚焦中被移除（a11y）与“撤销”来不及点。
  const scheduledRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Map<string, number>>(new Map());
  const remainingRef = useRef<Map<string, number>>(new Map());
  const startedAtRef = useRef<Map<string, number>>(new Map());

  const scheduleDismiss = (id: string, delay: number) => {
    startedAtRef.current.set(id, Date.now());
    remainingRef.current.set(id, delay);
    const timer: number = window.setTimeout(() => dismiss(id), delay);
    timersRef.current.set(id, timer);
  };

  useEffect(() => {
    toasts.forEach((t) => {
      if (scheduledRef.current.has(t.id)) return;
      scheduledRef.current.add(t.id);
      const duration = t.duration ?? (t.actionLabel ? 6000 : 4000);
      scheduleDismiss(t.id, duration);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toasts]);

  const pauseDismiss = (id: string) => {
    const timer = timersRef.current.get(id);
    if (!timer) return;
    window.clearTimeout(timer);
    timersRef.current.delete(id);
    const startedAt = startedAtRef.current.get(id) ?? Date.now();
    const remaining = remainingRef.current.get(id) ?? 0;
    const elapsed = Date.now() - startedAt;
    remainingRef.current.set(id, Math.max(0, remaining - elapsed));
  };

  const resumeDismiss = (id: string) => {
    if (exiting.has(id)) return;
    if (timersRef.current.has(id)) return;
    const remaining = remainingRef.current.get(id);
    if (remaining == null || remaining <= 0) return;
    scheduleDismiss(id, remaining);
  };

  // 队列超限：store 只标记 retiring；这里统一走 exit 折叠，折叠完成后再真正移除。
  useEffect(() => {
    for (const toast of toasts) {
      if (toast.retiring) dismiss(toast.id);
    }
    // dismiss 内部用 dismissingRef 防重复；只需对 toasts 变化响应
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
        const isExiting = exiting.has(toast.id) || toast.retiring === true;
        return (
          <ExitCollapse key={toast.id} exiting={isExiting} className="w-full sm:w-auto">
            <div
              data-testid="toast-item"
              onMouseEnter={() => pauseDismiss(toast.id)}
              onMouseLeave={() => resumeDismiss(toast.id)}
              onFocus={() => pauseDismiss(toast.id)}
              onBlur={() => resumeDismiss(toast.id)}
              className={cn(
                "pointer-events-auto w-full sm:w-auto sm:max-w-sm bg-surface border border-line rounded-xl shadow-card p-3 flex items-start gap-2.5",
                // BUG-071：入场用一次性 animation（挂载即播）；退出 opacity 120ms，
                // 外层 ExitCollapse 同步折叠高度（190ms），其余 Toast 平滑上移。
                "ux-toast-enter ux-inline",
                isExiting
                  ? "opacity-0 translate-y-1 !duration-[var(--motion-exit-fast)] !ease-[var(--ease-exit)]"
                  : "opacity-100 translate-y-0"
              )}
              role={toast.type === "error" || toast.type === "warning" ? "alert" : "status"}
            >
              <Icon className={cn("w-4 h-4 shrink-0 mt-0.5", accentClass)} />
              <p className="flex-1 text-xs text-charcoal font-medium leading-relaxed min-w-0">
                {toast.message}
              </p>
              {toast.actionLabel && (
                <button
                  disabled={actionTakenRef.current.has(toast.id)}
                  aria-label={toast.actionAriaLabel ?? `${toast.actionLabel}：${toast.message}`}
                  onClick={() => {
                    if (actionTakenRef.current.has(toast.id)) return;
                    actionTakenRef.current.add(toast.id);
                    toast.onAction?.();
                    dismiss(toast.id);
                  }}
                  className="shrink-0 px-1.5 py-0.5 -m-0.5 rounded-lg text-[11px] font-bold text-charcoal hover:bg-alabaster transition-colors duration-[var(--motion-fast)] disabled:opacity-40 disabled:pointer-events-none"
                >
                  {toast.actionLabel}
                </button>
              )}
              <button
                onClick={() => dismiss(toast.id)}
                className="shrink-0 p-0.5 text-sandrift hover:text-charcoal rounded transition-colors duration-[var(--motion-fast)]"
                aria-label="关闭提示"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </ExitCollapse>
        );
      })}
    </div>
  );
}
