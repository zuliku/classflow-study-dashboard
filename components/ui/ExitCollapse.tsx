"use client";

import React, { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * 共享 Exit-only collapse primitive（Interaction Motion IM4B）：
 * 真实数据 mutation（删除 / 离开当前数据集）时，包裹内容轻 fade + 结构折叠（grid 1fr→0fr + opacity）。
 *
 * - normal：grid-rows-1fr + opacity-100（首次 render 不播放 entry）。
 * - exiting：grid-rows-0fr + opacity-0 + pointer-events-none + inner inert（不可 Tab 聚焦），约 160ms。
 * - 只做 exit；enter / presence 由调用方（useEnterOnAdd / useExitPresenceList）负责。
 * - Reduced Motion：全局 data-motion-effective 会把 transition 近即时化（无需组件内额外处理）。
 */
export interface ExitCollapseProps {
  exiting: boolean;
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
}

export function ExitCollapse({
  exiting,
  children,
  className,
  innerClassName,
}: ExitCollapseProps) {
  const innerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    if (exiting) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  }, [exiting]);

  return (
    <div
      data-state={exiting ? "exiting" : "present"}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-[160ms] ease-[var(--ease-standard)]",
        exiting
          ? "grid-rows-[0fr] opacity-0 pointer-events-none"
          : "grid-rows-[1fr] opacity-100",
        className
      )}
    >
      <div ref={innerRef} className={cn("min-h-0 overflow-hidden", innerClassName)}>
        {children}
      </div>
    </div>
  );
}
