"use client";

import React, { useEffect, useRef } from "react";
import { usePresence } from "@/lib/usePresence";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * 全局 Popover primitive（UI Productization Task 2B1）：controlled-first。
 * Primitive 只负责：relative anchor、Esc dismiss、outside-pointer dismiss。
 * 业务拥有 open state / toggle / mutual exclusion / handlers。
 * 不维护内部 open state、无 Context、无 Portal、无 collision/focus trap。
 */
export type PopoverPlacement = "bottom-end" | "bottom-start" | "top-end" | "top-start" | "right-end";

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
  "top-start": "left-0 bottom-full mb-1.5",
  "right-end": "left-full right-auto bottom-0 ml-2",
};

/** 进入前位移方向（surface 从 trigger 方向出现）：bottom 上偏 3px / top 下偏 3px / right 左偏 3px */
const PLACEMENT_ENTER_OFFSET: Record<PopoverPlacement, string> = {
  "bottom-end": "-translate-y-[3px]",
  "bottom-start": "-translate-y-[3px]",
  "top-end": "translate-y-[3px]",
  "top-start": "translate-y-[3px]",
  "right-end": "-translate-x-[3px]",
};

/** kiro profile：source-aware surface motion（scale .985→1 + 方向位移；由 ancestor Kiro scope 变量定速） */
const KIRO_PLACEMENT_ORIGIN: Record<PopoverPlacement, string> = {
  "bottom-end": "origin-top-right",
  "bottom-start": "origin-top-left",
  "top-end": "origin-bottom-right",
  "top-start": "origin-bottom-left",
  "right-end": "origin-left",
};

/**
 * 通用浮层 surface（service 任何 popover 内容：Filter / Share 等）。
 * 注意：不默认 role="menu"（由 DropdownMenuPanel 添加）。
 * open 可选：传入后 panel 拥有 mounted/visible presence（close 有快速 exit，最终 unmount）；
 * 不传则保持常显（兼容旧 consumer）。位移 ≤3px。
 *
 * Motion Contract（default profile）：enter = --motion-fast / exit = --motion-exit-fast，
 * presence unmount = MOTION_EXIT_MS.fast —— 三者同源对应，快于 Dialog/Drawer。
 * kiro profile 特殊 duration（160）：Kiro scope CSS 变量（--kiro-motion-popover-*）按
 * workspace/sidecar 作用域取值（120/100ms），presence 取上限档保证 unmount 晚于任一 scope 的
 * 视觉退出；属 Kiro Brand Motion 域，不并入全局 contract。
 */
export interface PopoverPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  placement?: PopoverPlacement;
  open?: boolean;
  /**
   * Motion V1：kiro = 使用 ancestor Kiro scope CSS 变量（--kiro-motion-popover-*）+
   * scale .985→1 + 正确 transform-origin。默认行为保持全站不变。
   */
  motionProfile?: "default" | "kiro";
}

export function PopoverPanel({
  open,
  placement = "bottom-end",
  motionProfile = "default",
  className,
  children,
  ...props
}: PopoverPanelProps) {
  // kiro=160：见上方注释（Kiro scope 域独立定速）；default=fast exit（110）
  const { mounted, visible } = usePresence(
    open ?? true,
    motionProfile === "kiro" ? 160 : MOTION_EXIT_MS.fast
  );
  if (!mounted) return null;

  return (
    <div
      data-kiro-open={motionProfile === "kiro" ? String(visible) : undefined}
      className={cn(
        "absolute z-40 bg-surface border border-line-strong rounded-2xl shadow-card",
        "max-h-[min(420px,60vh)] overflow-y-auto",
        PLACEMENT_CLASSES[placement],
        motionProfile === "kiro" && cn(KIRO_PLACEMENT_ORIGIN[placement], "kiro-popover-motion"),
        motionProfile === "default" &&
          (visible
            ? "opacity-100 translate-x-0 translate-y-0 duration-[var(--motion-fast)] ux-inline"
            : cn(
                "opacity-0 !duration-[var(--motion-exit-fast)] ux-inline",
                // 仅 exit 阻塞 pointer（enter 是唯一 interaction owner，2 帧内可交互）
                !open && "pointer-events-none",
                PLACEMENT_ENTER_OFFSET[placement]
              )),
        motionProfile === "kiro" &&
          (visible
            ? "opacity-100 translate-x-0 translate-y-0 scale-100"
            : cn(
                "opacity-0",
                !open && "pointer-events-none",
                PLACEMENT_ENTER_OFFSET[placement],
                "scale-[0.985]"
              )),
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
