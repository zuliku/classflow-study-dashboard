"use client";

import React, { useEffect, useRef } from "react";
import { usePresence } from "@/lib/usePresence";
import { cn } from "@/lib/utils";

/**
 * 共享 Disclosure 内容 primitive（Interaction Motion IM2B）：
 * 现有布局内部的结构性展开/收起（Worklog / Tool detail / Quick Add）。
 *
 * Lifecycle contract（IM6B audit）：
 * - mounted：usePresence 控制是否存在于 DOM（open → 先 mount hidden → 下一帧 visible；
 *   close → visible=false 后 180ms exit presence → unmount）。
 * - visible：驱动视觉 expanded/collapsed（grid-rows 1fr↔0fr + opacity）——真正进入动画由 visible 驱动，
 *   而不是 open 直切（open 是 semantic ownership）。
 * - aria-hidden / inert / data-state 由 open 决定：semantic close 立即释放（与 OverlayLayer 一致，
 *   visual exit 在其后）。
 * - duration 统一 180ms（CSS 与 usePresence 对齐，避免 unmount 早于 transition 完成）。
 * - reduced motion 由 usePresence + 全局 data-motion-effective 自然降级。
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
  const { mounted, visible } = usePresence(open, 180);
  const innerRef = useRef<HTMLDivElement | null>(null);

  // closed presence 期间禁止 Tab 聚焦（React 18 types 无 inert prop → 运行时属性）
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    if (open) el.removeAttribute("inert");
    else el.setAttribute("inert", "");
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      id={id}
      data-state={open ? "open" : "closed"}
      aria-hidden={!open}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-[180ms] ease-[var(--ease-standard)]",
        visible
          ? "grid-rows-[1fr] opacity-100"
          : "grid-rows-[0fr] opacity-0 pointer-events-none",
        className
      )}
    >
      <div ref={innerRef} className={cn("min-h-0 overflow-hidden", innerClassName)}>
        {children}
      </div>
    </div>
  );
}
