"use client";

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "@/lib/usePresence";
import { useInertOnHidden } from "@/lib/useInertOnHidden";
import { useRestoreFocus } from "@/lib/useRestoreFocus";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { pushOverlay, popOverlay, isTopmostOverlay, getTopOverlayZExcept } from "@/lib/overlayStack";
import {
  computeAnchoredPopoverPosition,
  type AnchoredPopoverPlacement,
} from "@/lib/contextMenuPosition";
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

interface PopoverContextValue {
  popoverId: string;
  onOpenChange: (open: boolean) => void;
  isTopmost: () => boolean;
}

const PopoverContext = React.createContext<PopoverContextValue | null>(null);

/** DropdownMenuPanel / PopoverPanel 共享：portal 面板需参与 outside-click 与 Esc 所有权 */
export function usePopoverContext(): PopoverContextValue | null {
  return React.useContext(PopoverContext);
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
      const target = event.target as Element | null;
      if (root && target && root.contains(target)) return;
      // portal 面板不在 root DOM 子树内：用 popoverId 识别，避免点菜单先触发 outside close
      if (target?.closest(`[data-popover-id="${overlayId}"]`)) return;
      onOpenChange(false);
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      popOverlay(overlayId);
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, onOpenChange, overlayId]);

  const contextValue = React.useMemo<PopoverContextValue>(
    () => ({
      popoverId: overlayId,
      onOpenChange,
      isTopmost: () => isTopmostOverlay(overlayId),
    }),
    [overlayId, onOpenChange]
  );

  return (
    <PopoverContext.Provider value={contextValue}>
      <div ref={ref} className={cn("relative", className)} {...props}>
        {children}
      </div>
    </PopoverContext.Provider>
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
   * Portal 到 body + fixed 定位（opt-in）：用于可能被祖先 overflow/transform 裁切的菜单。
   * 锚点 = 面板原宿主元素 rect；空间不足自动翻转 + clamp。placement="anchor" 保持调用方手工定位。
   */
  portal?: boolean;
  /**
   * Motion V1：kiro = 使用 ancestor Kiro scope CSS 变量（--kiro-motion-popover-*）+
   * scale .985→1 + 正确 transform-origin。默认行为保持全站不变。
   */
  motionProfile?: "default" | "kiro";
}

interface PortalPosition {
  left: number;
  top: number;
  zIndex: number;
}

export const PopoverPanel = React.forwardRef<HTMLDivElement, PopoverPanelProps>(function PopoverPanel(
  {
    open,
    placement = "bottom-end",
    portal = false,
    motionProfile = "default",
    className,
    style,
    children,
    ...props
  },
  forwardedRef
) {
  // kiro=160：见上方注释（Kiro scope 域独立定速）；default=fast exit（110）
  const { mounted, visible } = usePresence(
    open ?? true,
    motionProfile === "kiro" ? 160 : MOTION_EXIT_MS.fast
  );
  // 退出窗口内 inert：pointer-events-none 防不住 Tab，菜单项不可二次触发
  // 进入期不加 inert：open=true 后焦点/键盘立即可用，不必等 opacity 过渡完成
  const inertRef = useInertOnHidden<HTMLDivElement>(open === false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const popoverContext = usePopoverContext();
  const anchorMarkerRef = useRef<HTMLSpanElement | null>(null);
  const [portalPosition, setPortalPosition] = useState<PortalPosition | null>(null);
  const shouldPortal = portal && placement !== "anchor";

  const setPanelRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      panelRef.current = node;
      inertRef(node);
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [inertRef, forwardedRef]
  );

  // Portal 定位：用未 portal 的 marker 找到原宿主锚点；每次 open/尺寸变化重新测量。
  // 只负责把面板放进 viewport（翻转 + clamp），不改变内容宽度/高度策略。
  useLayoutEffect(() => {
    if (!shouldPortal || !mounted || !visible) return;
    let raf = 0;
    const measure = () => {
      const anchor = anchorMarkerRef.current?.parentElement;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const anchorRect = anchor.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      if (panelRect.width < 1) return;
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const position = computeAnchoredPopoverPosition({
        anchorRect,
        menuWidth: panelRect.width,
        menuHeight: Math.min(panelRect.height, viewportHeight - 16),
        placement: placement as AnchoredPopoverPlacement,
        viewportWidth,
        viewportHeight,
      });
      const next: PortalPosition = {
        left: Math.round(position.x),
        top: Math.round(position.y),
        // 排除 Popover 自身 z40：Dialog 内保持 >= 宿主层级（同层后挂载 → 视觉在上）
        zIndex: Math.max(40, getTopOverlayZExcept(popoverContext?.popoverId)),
      };
      setPortalPosition((prev) =>
        prev && prev.left === next.left && prev.top === next.top && prev.zIndex === next.zIndex
          ? prev
          : next
      );
    };
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };
    schedule();
    const onScroll = (event: Event) => {
      // 面板内部滚动不改变锚点位置
      if (panelRef.current?.contains(event.target as Node)) return;
      schedule();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", schedule);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    const anchor = anchorMarkerRef.current?.parentElement;
    if (observer && anchor) observer.observe(anchor);
    if (observer && panelRef.current) observer.observe(panelRef.current);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
    };
  }, [shouldPortal, mounted, visible, placement, popoverContext?.popoverId]);

  if (!mounted) return null;

  const panel = (
    <div
      ref={setPanelRef}
      data-kiro-open={motionProfile === "kiro" ? String(visible) : undefined}
      data-overlay-ignore="true"
      data-popover-id={shouldPortal ? popoverContext?.popoverId : undefined}
      style={
        shouldPortal
          ? {
              position: "fixed",
              left: portalPosition?.left ?? 0,
              top: portalPosition?.top ?? 0,
              right: "auto",
              bottom: "auto",
              margin: 0,
              zIndex:
                portalPosition?.zIndex ??
                Math.max(40, getTopOverlayZExcept(popoverContext?.popoverId)),
              visibility: portalPosition ? undefined : "hidden",
              ...style,
            }
          : style
      }
      className={cn(
        "bg-surface border border-line-strong rounded-2xl shadow-card",
        // 纵向滚动容器：必须显式 overflow-x-clip——否则 overflow-x 按规范计算为 auto，
        // 进入/退出 ±3px 位移与 drill ±4px 切换会在面板底部闪出横向滚动条。
        "max-h-[min(420px,60vh)] overflow-y-auto overflow-x-clip",
        shouldPortal ? "z-40" : cn("absolute z-40", PLACEMENT_CLASSES[placement]),
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

  if (!shouldPortal) return panel;

  return (
    <>
      {/* 保持一个未 portal 的锚点标记：parentElement 即原宿主（Popover wrapper / relative ref） */}
      <span ref={anchorMarkerRef} hidden aria-hidden="true" data-popover-anchor-marker="" />
      {createPortal(panel, document.body)}
    </>
  );
});
PopoverPanel.displayName = "PopoverPanel";
