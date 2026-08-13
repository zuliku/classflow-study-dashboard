"use client";

import React from "react";
import { OverlayLayer } from "@/components/ui/OverlayLayer";
import { cn } from "@/lib/utils";

/**
 * Dialog primitive（UI Productization Task 2B2）：centered modal shell。
 * - lifecycle/shell 全部委托 OverlayLayer
 * - role="dialog" aria-modal="true"（consumer 可覆盖为 alertdialog）
 * - 不自动生成 close button / title context；close button 属于 consumer
 * - 无 focus trap / scroll lock
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
}

export function Dialog({
  open,
  onOpenChange,
  overlayId,
  stackZ = 50,
  exitMs = 190,
  closeOnBackdrop = false,
  onEscapeKeyDown,
  overlayClassName,
  className,
  children,
  ...props
}: DialogProps) {
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
        "fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4",
        overlayClassName
      )}
    >
      {({ visible }) => (
        <div
          role="dialog"
          aria-modal="true"
          className={cn(
            "w-full max-w-md bg-surface border border-line rounded-2xl shadow-drawer overflow-hidden ux-modal-panel",
            // enter ≈200ms（scale 0.985 + 4px 上移）；exit ≈150ms（scale 0.99 + 2px），exit < enter
            visible
              ? "opacity-100 scale-100 translate-y-0 !duration-[200ms]"
              : "opacity-0 scale-[0.99] translate-y-0.5 !duration-[150ms]",
            className
          )}
          {...props}
        >
          {children}
        </div>
      )}
    </OverlayLayer>
  );
}
