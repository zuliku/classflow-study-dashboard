"use client";

import React, { useEffect, useRef } from "react";
import { MOTION_EXIT_MS } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * 共享 collapse primitive（Interaction Motion IM4B，V6 双向）：
 * 真实数据 mutation（删除 / 离开当前数据集）时包裹内容轻 fade + 结构折叠；
 * 也支持反向进入（如 SettingsSaveBar 的 dirty 按钮组）：
 * - present：grid 1fr + opacity-100；进入过渡 = --motion-fast + --ease-standard
 * - exiting：grid 0fr + opacity-0 + pointer-events-none + inner inert（不可 Tab 聚焦）；
 *   退出过渡 = --motion-exit-panel + --ease-exit
 * - 首次 render 为 present 时没有旧状态变化，不会播放无意义动画。
 * - axis="horizontal"：横向折叠（grid-cols 1fr→0fr；附件 tray / chip 行），纵向语义不变。
 * - 内层只在 exiting 期间 overflow-hidden（折叠轨道收拢所需）；平时 overflow-visible，
 *   行内 absolute 浮层（课程卡任务/资料弹窗、行内菜单等）必须逃出卡片边界——
 *   常驻裁剪曾导致弹窗被卡片拦腰截断。enter 位移动画（±3px）本身不依赖裁剪。
 * - Reduced Motion：全局 data-motion-effective 会把 transition 近即时化（无需组件内额外处理）。
 */
export interface ExitCollapseProps {
  exiting: boolean;
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
  /** 折叠方向：vertical（默认，行列表）/ horizontal（chip 行 / tray） */
  axis?: "vertical" | "horizontal";
}

export function ExitCollapse({
  exiting,
  children,
  className,
  innerClassName,
  axis = "vertical",
}: ExitCollapseProps) {
  const innerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    if (exiting) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  }, [exiting]);

  const horizontal = axis === "horizontal";

  return (
    <div
      data-state={exiting ? "exiting" : "present"}
      data-axis={axis}
      className={cn(
        // Enter 走 fast/standard，Exit 走 panel/exit（共享 primitive 同时支持两向）
        "grid",
        !exiting
          ? "duration-[var(--motion-fast)] ease-[var(--ease-standard)]"
          : "duration-[var(--motion-exit-panel)] ease-[var(--ease-exit)]",
        horizontal
          ? "transition-[grid-template-columns,opacity]"
          : "transition-[grid-template-rows,opacity]",
        exiting
          ? horizontal
            ? "grid-cols-[0fr] opacity-0 pointer-events-none"
            : "grid-rows-[0fr] opacity-0 pointer-events-none"
          : horizontal
            ? "grid-cols-[1fr] opacity-100"
            : "grid-rows-[1fr] opacity-100",
        className
      )}
    >
      <div
        ref={innerRef}
        className={cn(
          horizontal ? "min-w-0" : "min-h-0",
          // 仅退出折叠期间裁剪；平时可见，让行内 absolute 浮层逃出边界
          exiting ? "overflow-hidden" : "overflow-visible",
          innerClassName
        )}
      >
        {children}
      </div>
    </div>
  );
}
