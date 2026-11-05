"use client";

import React from "react";
import { Loader2, ChevronDown } from "lucide-react";
import {
  KiroAgentRunStatus,
  kiroAgentRunHeaderText,
} from "@/lib/ai/ui/kiroAgentRun";
import { KiroAgentRunControls } from "@/components/kiro/run/KiroAgentRunControls";
import { KiroReasoningIcon } from "@/components/kiro/KiroReasoningIcon";
import { cn } from "@/lib/utils";

/**
 * Streaming UX V5：Header 真实用时（叶子组件；1Hz，只重渲染自身）。
 * 从 Header 挂载起算，仅 active 状态显示；不伪造 Task 时间戳。
 */
function KiroAgentRunElapsed({ active }: { active: boolean }) {
  const startedAtRef = React.useRef(Date.now());
  const [now, setNow] = React.useState(startedAtRef.current);
  React.useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  if (!active) return null;
  const secs = Math.max(0, Math.floor((now - startedAtRef.current) / 1000));
  if (secs < 2) return null;
  return (
    <span
      aria-hidden="true"
      className="shrink-0 text-[10px] tabular-nums text-sandrift kiro-status-swap"
    >
      · {secs}s
    </span>
  );
}

/**
 * Kiro Agent Run Header（P4）：当前 Assistant Turn 的稳定状态行。
 *
 * - 与 Kiro Rail 是不同层级：Rail = 全局 Kiro 状态；Header = 本 Turn 状态（绝不反向 set Rail）；
 * - 状态来自纯推导（resolveKiroAgentRunStatus），低频文案（role=status aria-live=polite）；
 * - Streaming UX V5：running 时显示当前 Tool 的具体动作（如「正在搜索网络」），
 *   并附 1Hz 真实用时；不读取 Tool input/output；
 * - 整行是 disclosure toggle（Timeline 展开/收起）；停止是独立 button（不与 toggle 嵌套）；
 * - 结束态只显示「用时 …」/「已完成」——没有可靠 Task 时间戳时绝不伪造 duration。
 */
export function KiroAgentRunHeader({
  status,
  durationLabel,
  desktopActive,
  activeToolLabel,
  reasoning = false,
  answering = false,
  collapsible = true,
  expanded,
  onToggle,
  onStop,
}: {
  status: KiroAgentRunStatus;
  /** 真实 Task 用时（formatKiroAgentRunDuration；无 → undefined） */
  durationLabel?: string;
  /** GUI 操作进行中（Computer Session 事实） */
  desktopActive?: boolean;
  /** 当前 working Tool 的公开语义 label（不含“正在”） */
  activeToolLabel?: string | null;
  /** 当前仅存在 reasoning（尚未产生 commentary / Tool） */
  reasoning?: boolean;
  /** Final Answer 已开始流式输出（phase === answering） */
  answering?: boolean;
  /** 是否有可展开的 Timeline（reasoning-only / plan-only 时无 disclosure） */
  collapsible?: boolean;
  expanded: boolean;
  onToggle: () => void;
  onStop?: () => void;
}) {
  const active = status === "running" || status === "composing";
  const activityLabel =
    status === "running" && reasoning
      ? "正在思考"
      : status === "composing" && answering
        ? "正在回答"
        : status === "running" && desktopActive
          ? "正在操作电脑"
          : status === "running" && activeToolLabel
            ? `正在${activeToolLabel}`
            : kiroAgentRunHeaderText(status, { desktopActive });
  const label =
    status === "completed" && durationLabel
      ? durationLabel
      : activityLabel;

  const indicator =
    status === "running" && reasoning ? (
      <KiroReasoningIcon className="w-3.5 h-3.5 text-sandrift shrink-0" />
    ) : status === "composing" && !answering ? (
      <Loader2 className="w-3.5 h-3.5 animate-spin text-sandrift shrink-0" aria-hidden="true" />
    ) : status === "composing" ? (
      <span className="w-1.5 h-1.5 rounded-full bg-charcoal shrink-0 animate-pulse" aria-hidden="true" />
    ) : status === "running" ? (
      <span className="w-1.5 h-1.5 rounded-full bg-charcoal shrink-0 animate-pulse" aria-hidden="true" />
    ) : status === "waiting-approval" ? (
      <span className="w-1.5 h-1.5 rounded-full bg-danger shrink-0 animate-pulse" aria-hidden="true" />
    ) : status === "paused" ? (
      <span className="w-1.5 h-1.5 rounded-full bg-sandrift shrink-0" aria-hidden="true" />
    ) : null;

  const statusContent = (
    <>
      {indicator && (
        <span
          key={`icon-${status}-${reasoning ? "r" : ""}-${answering ? "a" : ""}`}
          className="inline-flex shrink-0 kiro-status-swap"
          aria-hidden="true"
        >
          {indicator}
        </span>
      )}
      <span
        className="truncate"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span key={label} className="inline-block max-w-full kiro-status-swap">
          <span className={active ? "kiro-stream-shimmer" : undefined}>{label}</span>
        </span>
      </span>
      <KiroAgentRunElapsed active={active} />
      {collapsible && (
        <ChevronDown
          className={cn(
            "w-3 h-3 text-sandrift shrink-0 ml-auto transition-transform duration-[var(--motion-fast)]",
            expanded && "rotate-180"
          )}
          aria-hidden="true"
        />
      )}
    </>
  );

  return (
    <div data-testid="kiro-agent-run-header" data-status={status} className="flex items-center gap-1">
      {collapsible ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex flex-1 min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] font-semibold text-sandrift hover:bg-alabaster/60 transition-colors"
        >
          {statusContent}
        </button>
      ) : (
        <div className="flex flex-1 min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] font-semibold text-sandrift">
          {statusContent}
        </div>
      )}
      {/* P0：Stop 在等待确认/暂停/整理时同样常驻（此前仅 running 有，最想停时没按钮，只能被迫先决策） */}
      {(status === "running" || status === "waiting-approval" || status === "paused" || status === "composing") &&
        onStop && <KiroAgentRunControls onStop={onStop} stopLabel={status === "waiting-approval" ? "拒绝并停止" : undefined} />}
    </div>
  );
}
