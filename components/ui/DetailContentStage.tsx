"use client";

import React, { useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Detail Content Stage（Workflow UX Motion Productization M2 / M4 exit stability）：
 * Drawer / Peek Panel 内部「实体 A → 实体 B」的统一轻量切换层。
 *
 * 双层结构：
 * - 外层 wrapper（稳定，永不 remount）：持有 transition 派生 ref + layout className +
 *   data-stage-key（持久化，测试/调试用）
 * - 内层 keyed div：key = visualKey。A → B 时 key 变化 → remount 并携带
 *   ux-detail-swap-in（opacity 0.94→1 + translateY 3px→0，--motion-snap）播放一次轻量 swap
 *
 * 行为矩阵（visualKey contract）：
 * - null → A 首次打开：无 swap（Drawer 自身 enter 已提供进入动画）
 * - A → B 已打开切换：swap 一次
 * - B 同实体 rerender：不重新标记（contract 干净）
 * - B → null 关闭：visualKey 冻结为 B → 内层 DOM identity 不变、无 remount/闪动，
 *   整个 panel 以统一 exit presence 退场（Exit Stability Contract）
 * - 关闭后重开 C：无 swap（Drawer enter 覆盖）
 *
 * Reduced Motion：全局 contract（html[data-motion-effective="reduced"]）直接落最终态；
 * 本组件是纯 CSS animation，不监听系统偏好。
 *
 * entityKey 只能是实体 id（不可包含 status/progress/updatedAt——否则每次勾任务整页闪动）。
 */
export function DetailContentStage({
  entityKey,
  className,
  children,
  ...rest
}: {
  /** 当前展示实体 id；null = Drawer 关闭（视觉冻结在最后一个实体，exit presence 后卸载） */
  entityKey: string | null;
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "key" | "children">) {
  // 稳定 wrapper 上的派生 ref：跨内层 remount 存续，才能正确判定「已打开状态切换」。
  // Render-phase derivation，无 setState / timer / crossfade 双挂载。
  const last = useRef<{ key: string | null; wasOpen: boolean }>({ key: null, wasOpen: false });

  let animate = false;
  let visualKey: string;
  if (entityKey !== null) {
    animate =
      last.current.wasOpen && last.current.key !== null && last.current.key !== entityKey;
    visualKey = entityKey;
    last.current = { key: entityKey, wasOpen: true };
  } else {
    // close：冻结 visualKey 于最后实体 → 内层 key 不变 → 无 remount / 无 swap
    visualKey = last.current.key ?? "closed";
    last.current = { ...last.current, wasOpen: false };
  }

  return (
    <div {...rest} data-stage-key={visualKey} className={className}>
      <div
        key={visualKey}
        data-stage-swap={animate ? "true" : undefined}
        className={cn("h-full", animate && "ux-detail-swap-in")}
      >
        {children}
      </div>
    </div>
  );
}
