"use client";

import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "@/lib/usePresence";
import { useRestoreFocus } from "@/lib/useRestoreFocus";
import { pushOverlay, popOverlay, isTopmostOverlay } from "@/lib/overlayStack";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * OverlayLayer（UI Productization Task 2B2）——共享浮层生命周期基础设施。
 * 职责 ONLY：portal / presence / overlay stack / Esc（topmost only）/ backdrop request-close / focus restore。
 * 不绑定 Dialog 或 Drawer 的视觉（背景由调用方 className 提供）。
 *
 * - 不维护 open state（controlled）
 * - callback 经 latest ref，stack 注册只依赖 open/overlayId/stackZ（退出视觉不再占用交互栈）
 * - 不新增 Context / Portal registry / scroll lock / focus trap
 */
export interface OverlayLayerRenderState {
  visible: boolean;
}

export interface OverlayLayerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  overlayId: string;
  stackZ: number;
  exitMs?: number;
  closeOnBackdrop?: boolean;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  className?: string;
  /**
   * opt-in：open 期间该 key 变化（如 Detail Panel 实体切换）→ 更新 focus restore 目标
   * 为最近一次触发切换的可聚焦元素。无该 prop 的 consumer 行为完全不变。
   */
  focusRestoreKey?: string | number | null;
  children: (state: OverlayLayerRenderState) => React.ReactNode;
}

export function OverlayLayer({
  open,
  onOpenChange,
  overlayId,
  stackZ,
  // 默认 panel 档 exit：与 Drawer CSS 退出过渡（--motion-exit-panel）一致
  exitMs = MOTION_EXIT_MS.panel,
  closeOnBackdrop = false,
  onEscapeKeyDown,
  className,
  focusRestoreKey,
  children,
}: OverlayLayerProps) {
  const { mounted, visible } = usePresence(open, exitMs);
  useRestoreFocus(open, focusRestoreKey);

  // latest refs：Esc/backdrop 回调 identity 变化不触发栈重排
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const onEscapeKeyDownRef = useRef(onEscapeKeyDown);
  onEscapeKeyDownRef.current = onEscapeKeyDown;

  // Stack 只表达交互所有权；退出视觉可继续 mounted，但关闭后立即释放栈。
  useEffect(() => {
    if (!open) return;
    pushOverlay(overlayId, stackZ);
    return () => popOverlay(overlayId);
  }, [open, overlayId, stackZ]);

  // Esc：只有 topmost overlay 处理；consumer 可 preventDefault 拦截默认关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!isTopmostOverlay(overlayId)) return;
      onEscapeKeyDownRef.current?.(event);
      if (!event.defaultPrevented) {
        // React 提交 open=false 前同步释放交互栈，允许连续 Esc 命中下一层。
        popOverlay(overlayId);
        onOpenChangeRef.current(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, overlayId]);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={cn(
        "ux-overlay",
        visible ? "opacity-100" : "opacity-0",
        !open && "pointer-events-none",
        className
      )}
      style={{ zIndex: stackZ }}
      onPointerDown={(event) => {
        // backdrop request-close：仅点击背景本身（target === currentTarget），面板内点击不关闭
        if (closeOnBackdrop && event.target === event.currentTarget) {
          popOverlay(overlayId);
          onOpenChangeRef.current(false);
        }
      }}
    >
      {children({ visible })}
    </div>,
    document.body
  );
}
