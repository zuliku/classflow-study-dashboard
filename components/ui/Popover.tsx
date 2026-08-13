"use client";

import React, { useEffect, useRef } from "react";
import { usePresence } from "@/lib/usePresence";
import { cn } from "@/lib/utils";

/**
 * 全局 Popover primitive（UI Productization Task 2B1）：controlled-first。
 * Primitive 只负责：relative anchor、Esc dismiss、outside-pointer dismiss。
 * 业务拥有 open state / toggle / mutual exclusion / handlers。
 * 不维护内部 open state、无 Context、无 Portal、无 collision/focus trap。
 */
export type PopoverPlacement = "bottom-end" | "bottom-start" | "top-end" | "right-end";

export interface PopoverProps extends React.HTMLAttributes<HTMLDivElement> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function Popover({ open, onOpenChange, className, children, ...props }: PopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      const root = ref.current;
      if (root && !root.contains(event.target as Node)) onOpenChange(false);
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={ref} className={cn("relative", className)} {...props}>
      {children}
    </div>
  );
}

const PLACEMENT_CLASSES: Record<PopoverPlacement, string> = {
  "bottom-end": "right-0 top-full mt-1.5",
  "bottom-start": "left-0 top-full mt-1.5",
  "top-end": "right-0 bottom-full mb-1.5",
  "right-end": "left-full right-auto bottom-0 ml-2",
};

/** 进入前位移方向（surface 从 trigger 方向出现）：bottom 上偏 3px / top 下偏 3px / right 左偏 3px */
const PLACEMENT_ENTER_OFFSET: Record<PopoverPlacement, string> = {
  "bottom-end": "-translate-y-[3px]",
  "bottom-start": "-translate-y-[3px]",
  "top-end": "translate-y-[3px]",
  "right-end": "-translate-x-[3px]",
};

/**
 * 通用浮层 surface（service 任何 popover 内容：Filter / Share 等）。
 * 注意：不默认 role="menu"（由 DropdownMenuPanel 添加）。
 * open 可选：传入后 panel 拥有 mounted/visible presence（close 有快速 exit，最终 unmount）；
 * 不传则保持常显（兼容旧 consumer）。位移 ≤3px，enter 140ms / exit 120ms（快于 Dialog/Drawer）。
 */
export interface PopoverPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  placement?: PopoverPlacement;
  open?: boolean;
}

export function PopoverPanel({
  open,
  placement = "bottom-end",
  className,
  children,
  ...props
}: PopoverPanelProps) {
  const { mounted, visible } = usePresence(open ?? true, 120);
  if (!mounted) return null;

  return (
    <div
      className={cn(
        "absolute z-40 bg-surface border border-line-strong rounded-2xl shadow-card ux-inline",
        "max-h-[min(420px,60vh)] overflow-y-auto",
        PLACEMENT_CLASSES[placement],
        visible
          ? "opacity-100 translate-x-0 translate-y-0 !duration-[140ms]"
          : cn("opacity-0 pointer-events-none !duration-[120ms]", PLACEMENT_ENTER_OFFSET[placement]),
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
