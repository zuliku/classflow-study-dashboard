"use client";

import React, { useRef } from "react";
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
 *   确需非阻塞行为用 Drawer floating，不要关 trap；
 * - 无 scroll lock（body 锁定仅 KiroImagePreviewDialog 自持，见 S2-1 备注）
 *
 * Motion Contract：enter = --motion-overlay（220ms，与 Drawer panel enter 同档）；
 * exit = --motion-exit-base（150ms）；presence unmount = MOTION_EXIT_MS.base —— 三者同源对应。
 * Motion V3：进入 --ease-standard（历史视觉不变），退出 --ease-exit（加速离场，进出不对称）。
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
   * 焦点陷阱（默认开启，S2-1）：开启后 Tab / Shift+Tab 在面板内循环，不逃逸到背后页面。
   * 嵌套 Dialog 各自处理包裹处的 Tab（子陷阱 stopPropagation + 父陷阱嵌套守卫忽略子树外事件）。
   * 仅当面板确需非阻塞行为时显式传 false（优先改用 Drawer floating）。
   */
  trapFocus?: boolean;
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
  className,
  children,
  ...props
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const trapTab = useFocusTrap(panelRef, open && trapFocus);
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
      className={cn(
        "fixed inset-x-0 bottom-0 top-[var(--titlebar-h)] bg-black/40 backdrop-blur-sm",
        overlayClassName
      )}
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
              // enter ≈220ms（scale 0.99→1 + 2px 上移归零）；exit =150ms（scale 1→0.99 + 2px），exit < enter
              visible
                ? "opacity-100 scale-100 translate-y-0 !duration-[var(--motion-overlay)] ease-[var(--ease-standard)]"
                : "opacity-0 scale-[0.99] translate-y-0.5 !duration-[var(--motion-exit-base)] !ease-[var(--ease-exit)]",
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
