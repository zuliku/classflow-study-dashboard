"use client";

import React, { useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Detail Content Stage（Workflow UX Motion Productization M2）：
 * Drawer / Peek Panel 内部「实体 A → 实体 B」的统一轻量切换层。
 *
 * Contract：
 * - entityKey 变化 → 本节点以新 key remount，播放一次 ux-detail-swap-in
 *   （opacity 0.94→1 + translateY 3px→0，--motion-snap）——「内容已经变了」的即时反馈，
 *   不是 Drawer 第二次进入动画
 * - 首次挂载（prevKey === null → entityKey）：不播 swap——Drawer 自身 enter 已提供进入动画
 * - 无 state / 无 timer / 无 crossfade 双挂载：语义 entity switch 立即生效，
 *   连续快速切换（J/K）直接 replace，永远追上用户输入
 * - Reduced Motion：全局 contract（html[data-motion-effective="reduced"]）直接落最终态，
 *   本组件是纯 CSS animation，不重复监听系统偏好
 *
 * entityKey 只能是实体 id（不可包含 status/progress/updatedAt——否则每次勾任务整页闪动）。
 */
export function DetailContentStage({
  entityKey,
  className,
  children,
  ...rest
}: {
  /** 当前展示实体 id；null = Drawer 关闭（保留最后内容供 exit presence，不触发 swap） */
  entityKey: string | null;
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "key" | "children">) {
  // Render-phase derivation（ref 派生，同 Sidebar prevSelectedId / PageTransition M1 contract）：
  // prevKey === null → 首次 open 不播 swap；A → B → 播放一次 swap-in
  const stageRef = useRef<{ key: string | null; animate: boolean }>({ key: null, animate: false });
  if (stageRef.current.key !== entityKey) {
    stageRef.current = {
      key: entityKey,
      animate: entityKey !== null && stageRef.current.key !== null,
    };
  }
  const { animate } = stageRef.current;

  return (
    <div
      {...rest}
      key={entityKey ?? "closed"}
      data-stage-swap={animate ? "true" : undefined}
      className={cn(animate && "ux-detail-swap-in", className)}
    >
      {children}
    </div>
  );
}
