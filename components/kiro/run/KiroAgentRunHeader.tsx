"use client";

import React from "react";
import { Loader2, ChevronDown } from "lucide-react";
import {
  KiroAgentRunStatus,
  kiroAgentRunHeaderText,
} from "@/lib/ai/ui/kiroAgentRun";
import { KiroAgentRunControls } from "@/components/kiro/run/KiroAgentRunControls";
import { cn } from "@/lib/utils";

/**
 * Kiro Agent Run Header（P4）：当前 Assistant Turn 的稳定状态行。
 *
 * - 与 Kiro Rail 是不同层级：Rail = 全局 Kiro 状态；Header = 本 Turn 状态（绝不反向 set Rail）；
 * - 状态来自纯推导（resolveKiroAgentRunStatus），低频文案（role=status aria-live=polite）；
 * - 整行是 disclosure toggle（Timeline 展开/收起）；停止是独立 button（不与 toggle 嵌套）；
 * - 结束态只显示「用时 …」/「已完成」——没有可靠 Task 时间戳时绝不伪造 duration。
 */
export function KiroAgentRunHeader({
  status,
  durationLabel,
  desktopActive,
  expanded,
  onToggle,
  onStop,
}: {
  status: KiroAgentRunStatus;
  /** 真实 Task 用时（formatKiroAgentRunDuration；无 → undefined） */
  durationLabel?: string;
  /** GUI 操作进行中（Computer Session 事实） */
  desktopActive?: boolean;
  expanded: boolean;
  onToggle: () => void;
  onStop?: () => void;
}) {
  const label =
    status === "completed" && durationLabel
      ? durationLabel
      : kiroAgentRunHeaderText(status, { desktopActive });

  const indicator =
    status === "composing" ? (
      <Loader2 className="w-3.5 h-3.5 animate-spin text-sandrift shrink-0" aria-hidden="true" />
    ) : status === "running" ? (
      <span className="w-1.5 h-1.5 rounded-full bg-charcoal shrink-0 animate-pulse" aria-hidden="true" />
    ) : status === "waiting-approval" ? (
      <span className="w-1.5 h-1.5 rounded-full bg-danger shrink-0 animate-pulse" aria-hidden="true" />
    ) : status === "paused" ? (
      <span className="w-1.5 h-1.5 rounded-full bg-sandrift shrink-0" aria-hidden="true" />
    ) : null;

  return (
    <div data-testid="kiro-agent-run-header" data-status={status} className="flex items-center gap-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex flex-1 min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] font-semibold text-sandrift hover:bg-alabaster/60 transition-colors"
      >
        {indicator}
        <span
          className={cn("truncate", status === "running" && "text-charcoal")}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {label}
        </span>
        <ChevronDown
          className={cn(
            "w-3 h-3 text-sandrift shrink-0 ml-auto transition-transform duration-[var(--motion-fast)]",
            expanded && "rotate-180"
          )}
          aria-hidden="true"
        />
      </button>
      {status === "running" && onStop && <KiroAgentRunControls onStop={onStop} />}
    </div>
  );
}
