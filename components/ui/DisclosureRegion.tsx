"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePresence } from "@/lib/usePresence";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * 共享 Disclosure 内容 primitive（Interaction Motion IM2B / 2026-11 layout fix）。
 *
 * Lifecycle contract：
 * - mounted：usePresence 控制是否存在于 DOM（open → 先 mount hidden → 下一帧 visible；
 *   close → visible=false 后 MOTION_EXIT_MS.base exit presence → unmount）。
 * - visible：驱动视觉 expanded/collapsed（height 0 ↔ measured content height + opacity）。
 * - aria-hidden / inert / data-state 由 open 决定：semantic close 立即释放（与 OverlayLayer 一致，
 *   visual exit 在其后）。
 * - Motion Contract：enter = --motion-base；close = --motion-exit-base（exit < enter，收起更快）；
 *   presence unmount = MOTION_EXIT_MS.base —— 与 CSS close 时长同源一致。
 *
 * 为什么用 measured height 而不是 grid 1fr↔0fr：
 * Chromium 在 SettingsGroup 等 auto-height + overflow 容器内会把 grid-template-rows 的
 * 过渡卡在起始值（视觉硬切）；height 过渡对所有宿主布局稳定，且 ResizeObserver 支持
 * 展开期间内容动态增高（如状态文案 / 嵌套 disclosure）。
 */
export interface DisclosureRegionProps {
  open: boolean;
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
  id?: string;
}

export function DisclosureRegion({
  open,
  children,
  className,
  innerClassName,
  id,
}: DisclosureRegionProps) {
  const { mounted, visible } = usePresence(open, MOTION_EXIT_MS.base);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [contentHeight, setContentHeight] = useState(0);

  // closed presence 期间禁止 Tab 聚焦（React 18 types 无 inert prop → 运行时属性）
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    if (open) el.removeAttribute("inert");
    else el.setAttribute("inert", "");
  }, [open]);

  useLayoutEffect(() => {
    if (!mounted) return;
    const el = innerRef.current;
    if (!el) return;
    const measure = () => setContentHeight(el.scrollHeight);
    measure();
    if (!visible) return;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [mounted, visible]);

  if (!mounted) return null;

  return (
    <div
      id={id}
      data-state={open ? "open" : "closed"}
      aria-hidden={!open}
      style={{ height: visible ? contentHeight : 0 }}
      className={cn(
        "overflow-hidden transition-[height,opacity] duration-[var(--motion-base)] ease-[var(--ease-standard)]",
        visible
          ? "opacity-100"
          : "opacity-0 pointer-events-none !duration-[var(--motion-exit-base)] !ease-[var(--ease-exit)]",
        className
      )}
    >
      <div ref={innerRef} className={cn("min-h-0 overflow-hidden", innerClassName)}>
        {children}
      </div>
    </div>
  );
}
