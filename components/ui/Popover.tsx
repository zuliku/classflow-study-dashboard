"use client";

import React, { useEffect, useId, useRef } from "react";
import { usePresence } from "@/lib/usePresence";
import { useInertOnHidden } from "@/lib/useInertOnHidden";
import { useRestoreFocus } from "@/lib/useRestoreFocus";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { pushOverlay, popOverlay, isTopmostOverlay } from "@/lib/overlayStack";
import { cn } from "@/lib/utils";

/**
 * 全局 Popover primitive（UI Productization Task 2B1）：controlled-first。
 * Primitive 只负责：relative anchor、Esc dismiss、outside-pointer dismiss。
 * 业务拥有 open state / toggle / mutual exclusion / handlers。
 * 不维护内部 open state、无 Context、无 Portal、无 collision/focus trap。
 */
export type PopoverPlacement =
  | "bottom-end"
  | "bottom-start"
  | "top-end"
  | "top-start"
  | "top-center"
  /** 由调用方通过 style 精确锚定（无内置位置 class；仍复用 enter/exit motion） */
  | "anchor"
  | "right-end";

export interface PopoverProps extends React.HTMLAttributes<HTMLDivElement> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function Popover({ open, onOpenChange, className, children, ...props }: PopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  // 关闭后焦点回到触发元素（Esc/点外关闭时焦点可能落在面板内）
  useRestoreFocus(open);
  // Esc topmost 语义：打开时进 overlay 栈（视觉层级 z-40），有 Dialog/Drawer 等更高层时
  // 后台 Popover 不再跟着一起关；嵌套 Popover 只关最上层。
  const overlayId = useId();

  useEffect(() => {
    if (!open) return;
    pushOverlay(overlayId, 40);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isTopmostOverlay(overlayId)) onOpenChange(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      const root = ref.current;
      if (root && !root.contains(event.target as Node)) onOpenChange(false);
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      popOverlay(overlayId);
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, onOpenChange, overlayId]);

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
  "top-center": "left-1/2 -translate-x-1/2 bottom-full mb-1.5",
  anchor: "",
  // right-end：rail 锚定菜单与壳体保留 12px 呼吸间距（此前 ml-2 在圆角边框旁视觉上贴线）
  "right-end": "left-full right-auto bottom-0 ml-3",
};

/** 进入前位移方向（surface 从 trigger 方向出现）：bottom 上偏 3px / top 下偏 3px / right 左偏 3px */
const PLACEMENT_ENTER_OFFSET: Record<PopoverPlacement, string> = {
  "bottom-end": "-translate-y-[3px]",
  "bottom-start": "-translate-y-[3px]",
  "top-end": "translate-y-[3px]",
  "top-start": "translate-y-[3px]",
  "top-center": "translate-y-[3px]",
  anchor: "translate-y-[3px]",
  "right-end": "-translate-x-[3px]",
};

/** V6：所有 profile 统一 source-aware surface motion：
 *  scale .985→1 + 方向位移；transform-origin 跟随 placement。 */
const PLACEMENT_ORIGIN: Record<PopoverPlacement, string> = {
  "bottom-end": "origin-top-right",
  "bottom-start": "origin-top-left",
  "top-end": "origin-bottom-right",
  "top-start": "origin-bottom-left",
  "top-center": "origin-bottom",
  anchor: "origin-bottom",
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
 * Motion V3：进入 --ease-standard，退出 --ease-exit（加速离场）。
 * V6：default profile 也使用 transform-origin + scale .985→1，菜单从触发点“长出来”，
 * 不再只是 3px 平移。kiro profile 特殊 duration（160）：Kiro scope CSS 变量取值，
 * presence 取上限档保证 unmount 晚于任一 scope 的视觉退出；属 Kiro Brand Motion 域。
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
  // 退出窗口内 inert：pointer-events-none 防不住 Tab，菜单项不可二次触发
  const inertRef = useInertOnHidden<HTMLDivElement>(!visible);
  if (!mounted) return null;

  return (
    <div
      ref={inertRef}
      data-kiro-open={motionProfile === "kiro" ? String(visible) : undefined}
      className={cn(
        "absolute z-40 bg-surface border border-line-strong rounded-2xl shadow-card",
        // 纵向滚动容器：必须显式 overflow-x-clip——否则 overflow-x 按规范计算为 auto，
        // 进入/退出 ±3px 位移与 drill ±4px 切换会在面板底部闪出横向滚动条。
        "max-h-[min(420px,60vh)] overflow-y-auto overflow-x-clip",
        PLACEMENT_CLASSES[placement],
        PLACEMENT_ORIGIN[placement],
        motionProfile === "kiro" && "kiro-popover-motion",
        motionProfile === "default" &&
          (visible
            ? "opacity-100 translate-x-0 translate-y-0 scale-100 duration-[var(--motion-fast)] ux-inline"
            : cn(
                "opacity-0 scale-[0.985] !duration-[var(--motion-exit-fast)] !ease-[var(--ease-exit)] ux-inline",
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
