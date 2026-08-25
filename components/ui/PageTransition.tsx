"use client";

import React, { useRef } from "react";
import { cn } from "@/lib/utils";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import { resolveWorkspaceMotionDirection } from "@/components/layout/navItems";

/**
 * 页面 Tab 切换 wrapper（Workflow UX Motion Productization M1）：
 * - 以 activeTab 为 key，切换时新节点进入（不做 Old/New crossfade、不保存旧 snapshot）
 * - MAIN workspace 之间有方向感：Sidebar 视觉顺序向下 = 从 +4px 轻进入；向上 = −4px
 *   （opacity 0.94 → 1 + translateX(±4px) → 0，--motion-page / --ease-standard）
 * - Kiro（非 MAIN）与首次挂载 → neutral fade（无方向位移）；Reduced Motion → neutral
 * - 仅水平 ±4px + wrapper overflow-x: clip：避免动画期 scroll overflow / scrollbar jank
 * - 方向为 render-phase resolver（prevRef 模式，同 Sidebar prevSelectedId contract）：
 *   首帧 prevRef=null → neutral（App 启动直接落最终页面，无「整 App 滑入」）
 */

export function PageTransition({
  tab,
  className,
  children,
}: {
  tab: string;
  className?: string;
  children: React.ReactNode;
}) {
  const reducedMotion = useEffectiveReducedMotion();
  // Render-phase derivation（ref 保存上一 tab；无 setState / 无 effect ordering 竞态）：
  // 首帧 prev=null → neutral（App 启动直接落最终页面）；Reduced Motion → neutral
  const motionRef = useRef<{ tab: string | null; direction: "forward" | "backward" | "neutral" }>({
    tab: null,
    direction: "neutral",
  });
  if (motionRef.current.tab !== tab) {
    const prev = motionRef.current.tab;
    motionRef.current = {
      tab,
      direction:
        prev === null || reducedMotion
          ? "neutral"
          : resolveWorkspaceMotionDirection(prev, tab),
    };
  }
  const { direction } = motionRef.current;

  return (
    <div className="overflow-x-clip flex flex-col flex-1 min-h-0">
      <div
        key={tab}
        data-motion-direction={direction}
        className={cn(
          "ux-page flex flex-col flex-1 min-h-0",
          direction !== "neutral" && `ux-page-${direction}`,
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}
