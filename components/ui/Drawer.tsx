"use client";

import React from "react";
import { OverlayLayer } from "@/components/ui/OverlayLayer";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Drawer primitive（UI Productization Task 2B2）：right-side contextual panel shell。
 * - lifecycle/shell 委托 OverlayLayer
 * - role="dialog" aria-modal="true"（不要因为叫 Drawer 使用不存在的 ARIA role）
 * - presentation="edge"（默认）：现有 full-height edge drawer，行为/class 完全不变
 * - presentation="floating"（opt-in）：bounded floating detail panel
 *   （viewport inset、rounded、full border + shadow；Task/DDL Detail Panel UX Refresh）
 * - 无 focus trap / scroll lock
 */
export type DrawerPresentation = "edge" | "floating";

export interface DrawerProps extends React.HTMLAttributes<HTMLDivElement> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  overlayId: string;
  stackZ?: number;
  exitMs?: number;
  closeOnBackdrop?: boolean;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  overlayClassName?: string;
  /** edge = 现状 full-height；floating = bounded floating panel（默认 edge） */
  presentation?: DrawerPresentation;
  /**
   * opt-in：open 期间该 key 变化（实体切换）→ focus restore 跟随最近 trigger。
   * 无该 prop 的 consumer 行为完全不变。
   */
  focusRestoreKey?: string | number | null;
}

/**
 * aria-modal 与 presentation 一致：
 * - edge（blocking modal）→ "true"（保持现状）
 * - floating（non-blocking contextual panel，背景可交互）→ 不声明 aria-modal（不冒充 modal）
 */
export function resolveDrawerAriaModal(
  presentation: DrawerPresentation
): "true" | undefined {
  return presentation === "edge" ? "true" : undefined;
}

/** 面板 enter/exit 视觉：edge = 右侧滑入；floating = 浮层位移 + 微缩放 */
export function resolveDrawerPresentation(
  presentation: DrawerPresentation,
  visible: boolean
): { overlayClassName: string; panelClassName: string } {
  if (presentation === "floating") {
    return {
      // 非阻塞浮层：backdrop 透传指针（面板打开时可直接点击其他任务 → 内容就地切换；
      // 关闭规则不变：closeOnBackdrop 对 floating 无效，关闭走 Esc / 关闭按钮）
      overlayClassName:
        "fixed inset-x-0 bottom-0 top-[var(--titlebar-h)] bg-black/20 backdrop-blur-sm flex justify-end overflow-hidden p-3 sm:p-4 pointer-events-none",
      panelClassName: cn(
        // 有界浮层：宽度 min(470px, 100vw-32px)；高度 max calc(100dvh-32px)；圆角 + 完整边框 + shadow
        "w-full sm:w-[470px] h-full max-h-[calc(100dvh-24px)] sm:max-h-[calc(100dvh-32px)]",
        "bg-surface rounded-2xl sm:rounded-[22px] border border-line-strong shadow-card",
        "flex flex-col overflow-hidden ux-drawer-panel !ease-[var(--ease-emphasized)] pointer-events-auto",
        // enter：20px→0 位移 + 微缩放 + 淡入（--motion-overlay 220ms，与 edge/Dialog 同档）；
        // exit：更快（--motion-exit-panel 160ms）
        visible
          ? "translate-x-0 scale-100 opacity-100 !duration-[var(--motion-overlay)]"
          : "translate-x-4 scale-[.994] opacity-0 !duration-[var(--motion-exit-panel)]"
      ),
    };
  }
  return {
    overlayClassName: "fixed inset-x-0 bottom-0 top-[var(--titlebar-h)] bg-black/30 backdrop-blur-sm flex justify-end overflow-hidden",
    panelClassName: cn(
      "h-full w-full bg-surface shadow-drawer border-l border-line flex flex-col overflow-hidden ux-drawer-panel",
      // 右侧来源感：enter = --motion-overlay（220ms，12px 位移）；exit = --motion-exit-panel（160ms 更快），
      // 与 floating 同一生命周期语义；不像是从屏幕外飞入
      visible
        ? "translate-x-0 opacity-100 !duration-[var(--motion-overlay)]"
        : "translate-x-3 opacity-0 !duration-[var(--motion-exit-panel)]"
    ),
  };
}

export function Drawer({
  open,
  onOpenChange,
  overlayId,
  stackZ = 40,
  // panel 档 exit（160ms）：与两种 presentation 的 CSS 退出过渡（--motion-exit-panel）一致
  exitMs = MOTION_EXIT_MS.panel,
  closeOnBackdrop = false,
  onEscapeKeyDown,
  overlayClassName,
  presentation = "edge",
  focusRestoreKey,
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
      focusRestoreKey={focusRestoreKey}
      className={cn(resolveDrawerPresentation(presentation, false).overlayClassName, overlayClassName)}
    >
      {({ visible }) => (
        <div
          role="dialog"
          aria-modal={resolveDrawerAriaModal(presentation)}
          className={cn(resolveDrawerPresentation(presentation, visible).panelClassName, className)}
          {...props}
        >
          {children}
        </div>
      )}
    </OverlayLayer>
  );
}
