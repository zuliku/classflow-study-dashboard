"use client";

import React, { useEffect, useRef } from "react";
import { OverlayLayer } from "@/components/ui/OverlayLayer";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { cn } from "@/lib/utils";

/**
 * Dialog primitive（UI Productization Task 2B2）：centered modal shell。
 * - lifecycle/shell 全部委托 OverlayLayer
 * - role="dialog" aria-modal="true"（consumer 可覆盖为 alertdialog）
 * - 不自动生成 close button / title context；close button 属于 consumer
 * - 焦点陷阱默认开启（S2-1：Modal 语义要求 Tab 不逃逸到背后页面）；
 *   嵌套 Dialog 由 useFocusTrap 嵌套守卫隔离（子 portal 冒泡事件父陷阱忽略）；
 *   确需非阻塞行为时显式传 false（并自行保证背后不可达链路一致）；
 * - 无 scroll lock（body 锁定仅 KiroImagePreviewDialog 自持，见 S2-1 备注）
 *
 * Motion Contract：enter = --motion-overlay（250ms，与 Drawer/Command 同档）；
 * exit = --motion-exit-base（160ms）；presence unmount = MOTION_EXIT_MS.base —— 三者同源对应。
 * V6：面板用 spatial spring（--ease-spatial）落位；opacity + scale(.98→1) + 4px 上移；
 * 退出 --ease-exit 加速离场。
 */
export interface DialogProps extends React.HTMLAttributes<HTMLDivElement> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  overlayId: string;
  stackZ?: number;
  exitMs?: number;
  closeOnBackdrop?: boolean;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  /** Full-screen overlay 视觉（背景/布局） */
  overlayClassName?: string;
  /**
   * 焦点陷阱（默认开启，S2-1：Modal 语义要求 Tab 不逃逸到背后页面）。
   * 嵌套 Dialog 各自处理包裹处的 Tab（子陷阱 stopPropagation + 父陷阱嵌套守卫忽略子树外事件）。
   * 仅当面板确需非阻塞行为时显式传 false（同时背板不得拦截指针，保持视觉与交互一致）。
   */
  trapFocus?: boolean;
  /**
   * opt-in 初始焦点：open 后 rAF 聚焦到该元素（如搜索框/输入框）。
   * 不传则保持现状（不抢焦点，兼容各消费方自持 autoFocus）。
   */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

export function Dialog({
  open,
  onOpenChange,
  overlayId,
  stackZ = 50,
  exitMs = MOTION_EXIT_MS.base,
  closeOnBackdrop = false,
  onEscapeKeyDown,
  overlayClassName,
  trapFocus = true,
  initialFocusRef,
  className,
  children,
  ...props
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const trapTab = useFocusTrap(panelRef, open && trapFocus);
  useEffect(() => {
    if (!open || !initialFocusRef?.current) return;
    const target = initialFocusRef.current;
    const raf = requestAnimationFrame(() => {
      if (document.contains(target) && typeof target.focus === "function") {
        target.focus();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [open, initialFocusRef]);
  // S2-1：trap 与 consumer onKeyDown 组合（此前 {...props} 后置会整体覆盖 trap）
  const { onKeyDown: consumerOnKeyDown, ...rest } = props;
  return (
    <OverlayLayer
      open={open}
      onOpenChange={onOpenChange}
      overlayId={overlayId}
      stackZ={stackZ}
      exitMs={exitMs}
      closeOnBackdrop={closeOnBackdrop}
      onEscapeKeyDown={onEscapeKeyDown}
      className={cn("fixed inset-x-0 bottom-0 top-[var(--titlebar-h)]", overlayClassName)}
      scrimTone="standard"
    >
      {({ visible }) => (
        <div className="flex h-full w-full items-center justify-center p-3 sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            ref={panelRef}
            onKeyDown={
              trapFocus
                ? (e) => {
                    trapTab(e);
                    consumerOnKeyDown?.(e);
                  }
                : consumerOnKeyDown
            }
            className={cn(
              "w-full max-w-md bg-surface border border-line rounded-2xl shadow-drawer overflow-hidden ux-modal-panel",
              // enter 250ms spatial spring（scale .98→1 + 4px 上移归零）；exit 160ms（scale 1→.98 + 4px），exit < enter
              visible
                ? "opacity-100 scale-100 translate-y-0 !duration-[var(--motion-overlay)] ease-[var(--ease-spatial)]"
                : "opacity-0 scale-[0.98] translate-y-1 !duration-[var(--motion-exit-base)] !ease-[var(--ease-exit)]",
              className
            )}
            {...rest}
          >
            {children}
          </div>
        </div>
      )}
    </OverlayLayer>
  );
}
