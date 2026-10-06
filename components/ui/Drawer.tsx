"use client";

import React, { useRef } from "react";
import { OverlayLayer } from "@/components/ui/OverlayLayer";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Drawer primitive（UI Productization Task 2B2）：right-side contextual panel shell。
 * - lifecycle/shell 委托 OverlayLayer
 * - role="dialog" aria-modal="true"（不要因为叫 Drawer 使用不存在的 ARIA role）
 * - presentation="edge"（默认）：现有 full-height edge drawer，行为/class 完全不变
 * - presentation="floating"（opt-in）：bounded floating detail panel
 *   （viewport inset、rounded、full border + shadow；Task/DDL Detail Panel UX Refresh）
 * - 真模态（blocking modal）：两种 presentation 打开时背景均不可操作——
 *   背板拦截指针（floating 下 backdrop 点击关闭）、焦点陷阱、aria-modal="true"。
 *   切换实体走“关闭 → 打开”（连续 Esc / backdrop 关闭后点选），不再支持开着面板
 *   直接点击背景任务就地切换——dim + blur 的模态视觉与透传点击错位，已下线。
 * - 无 scroll lock
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
   * 焦点陷阱（默认开启，S2-1：Modal 语义要求 Tab 不逃逸到背后页面）。
   * 显式传 false 可 opt-out（需同时自行保证背后不可达）。
   */
  trapFocus?: boolean;
  /**
   * opt-in：open 期间该 key 变化（实体切换）→ focus restore 跟随最近 trigger。
   * 无该 prop 的 consumer 行为完全不变。
   */
  focusRestoreKey?: string | number | null;
}

/**
 * aria-modal：两种 presentation 均为 blocking modal → "true"。
 */
export function resolveDrawerAriaModal(
  _presentation: DrawerPresentation
): "true" {
  return "true";
}

/** 面板 enter/exit 视觉：
 *  edge = 右侧滑入；
 *  floating = 浮层位移 + 淡入（Workflow UX Motion M4：Stable Edge Exit——
 *  floating contextual panel 是右侧 detail surface，不做 Modal 式向心缩放；
 *  产品 Motion Grammar：Dialog → scale + fade；Drawer → translate + fade）
 * Motion V3：进入 --ease-emphasized（历史视觉不变），退出 --ease-exit（加速离场）。 */
export function resolveDrawerPresentation(
  presentation: DrawerPresentation,
  visible: boolean
): { overlayClassName: string; panelClassName: string } {
  if (presentation === "floating") {
  return {
    // 真模态：柔和 dim 遮罩 + 拦截指针（背景不可操作；backdrop 点击关闭，
    // 关闭规则见 closeOnBackdrop 解析——floating 默认 backdrop 关闭）。
    // blur 由 OverlayLayer scrimBlurClass 按 visible 挂载（进退场不逐帧重模糊）
    overlayClassName:
      "fixed inset-x-0 bottom-0 top-[var(--titlebar-h)] bg-black/20 flex justify-end overflow-hidden p-3 sm:p-4",
      panelClassName: cn(
        // 有界浮层：宽度 min(470px, 100vw-32px)；高度 max calc(100dvh-32px)；圆角 + 完整边框 + shadow
        "w-full sm:w-[470px] h-full max-h-[calc(100dvh-24px)] sm:max-h-[calc(100dvh-32px)]",
        "bg-surface rounded-2xl sm:rounded-[22px] border border-line-strong shadow-card",
        "flex flex-col overflow-hidden ux-drawer-panel !ease-[var(--ease-emphasized)] pointer-events-auto",
        // enter：translate-x 0 + 淡入（--motion-overlay 220ms）；
        // exit：右侧轻移 + 淡出（--motion-exit-panel 160ms）；无 scale（M4 Stable Edge Exit）
        visible
          ? "translate-x-0 opacity-100 !duration-[var(--motion-overlay)]"
          : "translate-x-3 opacity-0 !duration-[var(--motion-exit-panel)] !ease-[var(--ease-exit)]"
      ),
    };
  }
  return {
    overlayClassName: "fixed inset-x-0 bottom-0 top-[var(--titlebar-h)] bg-black/30 flex justify-end overflow-hidden",
    panelClassName: cn(
      "h-full w-full bg-surface shadow-drawer border-l border-line flex flex-col overflow-hidden ux-drawer-panel",
      // 右侧来源感：enter = --motion-overlay（220ms，12px 位移）+ emphasized；exit = --motion-exit-panel（160ms 更快）+ exit，
      // 与 floating 同一生命周期语义；不像是从屏幕外飞入
      visible
        ? "translate-x-0 opacity-100 !duration-[var(--motion-overlay)] !ease-[var(--ease-emphasized)]"
        : "translate-x-3 opacity-0 !duration-[var(--motion-exit-panel)] !ease-[var(--ease-exit)]"
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
  // backdrop 关闭默认跟随 presentation：floating 默认 backdrop 点击关闭
  //（轻量 dismiss，与 Settings/ArrangeSheet 同语言；抽屉内编辑均为即时落库，无草稿丢失风险）；
  // edge 保持现状 false。显式传值可覆盖。
  closeOnBackdrop,
  onEscapeKeyDown,
  overlayClassName,
  presentation = "edge",
  trapFocus = true,
  focusRestoreKey,
  className,
  children,
  ...props
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const trapTab = useFocusTrap(panelRef, open && trapFocus);
  // S2-1：trap 与 consumer onKeyDown 组合（与 Dialog 同模式）
  const { onKeyDown: consumerOnKeyDown, ...rest } = props;
  // 未显式指定时：floating 默认 backdrop 点击关闭（真模态轻 dismiss），edge 保持 false
  const resolvedCloseOnBackdrop = closeOnBackdrop ?? presentation === "floating";
  return (
    <OverlayLayer
      open={open}
      onOpenChange={onOpenChange}
      overlayId={overlayId}
      stackZ={stackZ}
      exitMs={exitMs}
      closeOnBackdrop={resolvedCloseOnBackdrop}
      onEscapeKeyDown={onEscapeKeyDown}
      focusRestoreKey={focusRestoreKey}
      className={cn(resolveDrawerPresentation(presentation, false).overlayClassName, overlayClassName)}
      // 背板模糊只在完全可见时挂载（进退场不逐帧重模糊），与 Dialog 同模式
      scrimBlurClass="backdrop-blur-sm"
    >
      {({ visible }) => (
        <div
          role="dialog"
          aria-modal={resolveDrawerAriaModal(presentation)}
          ref={panelRef}
          onKeyDown={
            trapFocus
              ? (e) => {
                  trapTab(e);
                  consumerOnKeyDown?.(e);
                }
              : consumerOnKeyDown
          }
          className={cn(resolveDrawerPresentation(presentation, visible).panelClassName, className)}
          {...rest}
        >
          {children}
        </div>
      )}
    </OverlayLayer>
  );
}
