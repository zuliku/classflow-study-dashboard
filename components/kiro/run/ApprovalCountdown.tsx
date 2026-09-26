"use client";

import React from "react";
import { useKiroComputerRuntimeStore } from "@/store/useKiroComputerRuntimeStore";
import { cn } from "@/lib/utils";

/**
 * S-fix：审批自动取消倒计时（3 分钟超时可预期）。
 * - deadline 唯一来源：store.approvalDeadlineAt（超时 effect 计时起点写入；决策/清空同步清理）
 * - 本地 1s tick 只重渲染本小组件；role="timer"（聚焦播报，不用 aria-live 避免每秒打扰）
 * - 30s 内转 danger 强调；过期/无 deadline 渲染 null（超时决策落地即消失）
 */
export function formatApprovalCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes} 分 ${String(seconds).padStart(2, "0")} 秒` : `${seconds} 秒`;
}

export function ApprovalCountdown({ testid }: { testid?: string }) {
  const deadlineAt = useKiroComputerRuntimeStore((s) => s.approvalDeadlineAt);
  const [, force] = React.useReducer((x: number) => x + 1, 0);

  React.useEffect(() => {
    if (deadlineAt == null || deadlineAt - Date.now() <= 0) return;
    const timer = window.setInterval(force, 1000);
    return () => window.clearInterval(timer);
  }, [deadlineAt]);

  if (deadlineAt == null) return null;
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) return null;
  const urgent = remaining <= 30_000;

  return (
    <p
      role="timer"
      data-testid={testid ?? "approval-countdown"}
      className={cn(
        "text-[10px] leading-relaxed",
        urgent ? "font-bold text-danger" : "text-sandrift"
      )}
    >
      {urgent
        ? `${formatApprovalCountdown(remaining)}后自动取消`
        : `${formatApprovalCountdown(remaining)}内未决定将自动取消`}
    </p>
  );
}
