"use client";

import React, { useEffect, useRef } from "react";
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

/**
 * 通用浮层 surface（service 任何 popover 内容：Filter / Share 等）。
 * 注意：不默认 role="menu"（由 DropdownMenuPanel 添加）。
 */
export interface PopoverPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  placement?: PopoverPlacement;
}

export function PopoverPanel({
  placement = "bottom-end",
  className,
  children,
  ...props
}: PopoverPanelProps) {
  return (
    <div
      className={cn(
        "absolute z-40 bg-surface border border-line-strong rounded-2xl shadow-card ux-inline",
        "max-h-[min(420px,60vh)] overflow-y-auto",
        PLACEMENT_CLASSES[placement],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
