"use client";

import React from "react";
import { OverlayLayer } from "@/components/ui/OverlayLayer";
import { cn } from "@/lib/utils";

/**
 * Drawer primitive（UI Productization Task 2B2）：right-side contextual panel shell。
 * - lifecycle/shell 委托 OverlayLayer
 * - role="dialog" aria-modal="true"（不要因为叫 Drawer 使用不存在的 ARIA role）
 * - 本轮只实现 right drawer；宽度由 consumer className 控制（max-w-lg / sm:w-[...] 等）
 * - 无 focus trap / scroll lock
 */
export interface DrawerProps extends React.HTMLAttributes<HTMLDivElement> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  overlayId: string;
  stackZ?: number;
  exitMs?: number;
  closeOnBackdrop?: boolean;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  overlayClassName?: string;
}

export function Drawer({
  open,
  onOpenChange,
  overlayId,
  stackZ = 40,
  exitMs = 200,
  closeOnBackdrop = false,
  onEscapeKeyDown,
  overlayClassName,
  className,
  children,
  ...props
}: DrawerProps) {
  return (
    <OverlayLayer
      open={open}
      onOpenChange={onOpenChange}
      overlayId={overlayId}
      stackZ={stackZ}
      exitMs={exitMs}
      closeOnBackdrop={closeOnBackdrop}
      onEscapeKeyDown={onEscapeKeyDown}
      className={cn("fixed inset-0 bg-black/30 backdrop-blur-sm flex justify-end overflow-hidden", overlayClassName)}
    >
      {({ visible }) => (
        <div
          role="dialog"
          aria-modal="true"
          className={cn(
            "h-full w-full bg-surface shadow-drawer border-l border-line flex flex-col overflow-hidden ux-drawer-panel",
            // 右侧来源感：enter ≈220ms（12px 位移）；exit ≈160ms（更快），不像是从屏幕外飞入
            visible
              ? "translate-x-0 opacity-100 !duration-[220ms]"
              : "translate-x-3 opacity-0 !duration-[160ms]",
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
