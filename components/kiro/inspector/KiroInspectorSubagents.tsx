"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ListChecks, Loader2, Search, ShieldCheck, AlertCircle } from "lucide-react";
import {
  useOptionalKiroSession,
} from "@/components/kiro/KiroSessionProvider";
import {
  useKiroSubagentStore,
  type KiroSubagentRun,
  type KiroSubagentStepStatus,
} from "@/store/useKiroSubagentStore";
import { SUBAGENT_ROLE_LABELS } from "@/lib/ai/agent/subagent";
import {
  KiroInspectorEmptyState,
  KiroInspectorSection,
} from "@/components/kiro/inspector/KiroInspectorSection";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { cn } from "@/lib/utils";

const ROLE_ICONS = {
  researcher: Search,
  planner: ListChecks,
  reviewer: ShieldCheck,
} as const;

function useElapsedSeconds(startedAt: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return Math.max(0, Math.round((now - startedAt) / 1000));
}

function statusLabel(run: KiroSubagentRun): string {
  if (run.status === "running") return "运行中";
  if (run.status === "completed") return "已完成";
  if (run.status === "cancelled") return "已停止";
  return "失败";
}

function statusTone(run: KiroSubagentRun): string {
  if (run.status === "running") return "text-charcoal bg-pastel-mint/70 border-line";
  if (run.status === "completed") return "text-success bg-success/10 border-success/20";
  if (run.status === "cancelled") return "text-sandrift bg-alabaster border-line";
  return "text-danger bg-danger-bg border-danger-border";
}

function stepIcon(status: KiroSubagentStepStatus) {
  if (status === "done")
    return <Check className="w-3 h-3 text-success shrink-0 kiro-check-settle" aria-hidden="true" />;
  if (status === "error")
    return <AlertCircle className="w-3 h-3 text-danger shrink-0" aria-hidden="true" />;
  return <Loader2 className="w-3 h-3 text-charcoal animate-spin shrink-0" aria-hidden="true" />;
}

/**
 * Inspector — 子代理（Agent Superpowers V1.2）：
 * - 按当前 Conversation 过滤；显示研究员 / 规划师 / 审查员
 * - 运行中实时显示步骤 + 流式正文；完成后可展开完整摘要
 * - 只读展示；不提供重跑/写操作
 */
export function KiroInspectorSubagents() {
  const session = useOptionalKiroSession();
  const currentConversationId = session?.currentConversationId ?? null;
  const runs = useKiroSubagentStore((s) => s.runs);
  const order = useKiroSubagentStore((s) => s.order);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const visible = useMemo(
    () =>
      order
        .map((id) => runs[id])
        .filter((run): run is KiroSubagentRun => !!run && run.conversationId === currentConversationId)
        .reverse(),
    [order, runs, currentConversationId]
  );
  const runningCount = visible.filter((r) => r.status === "running").length;

  return (
    <KiroInspectorSection title="子代理" count={visible.length} testId="kiro-inspector-subagents">
      {visible.length === 0 ? (
        <KiroInspectorEmptyState text="暂无子代理" />
      ) : (
        <div className="space-y-1">
          {visible.map((run) => (
            <SubagentRow
              key={run.id}
              run={run}
              expanded={expandedId === run.id}
              onToggle={() => setExpandedId((current) => (current === run.id ? null : run.id))}
            />
          ))}
          {runningCount > 0 && (
            <p className="px-2 pt-0.5 text-[9px] text-sandrift">
              {runningCount} 个子代理正在运行
            </p>
          )}
        </div>
      )}
    </KiroInspectorSection>
  );
}

function SubagentRow({
  run,
  expanded,
  onToggle,
}: {
  run: KiroSubagentRun;
  expanded: boolean;
  onToggle: () => void;
}) {
  const Icon = ROLE_ICONS[run.role];
  const elapsed = useElapsedSeconds(run.startedAt, run.status === "running");
  const duration = run.completedAt
    ? `${Math.max(0, Math.round((run.completedAt - run.startedAt) / 1000))}s`
    : `${elapsed}s`;
  const text = run.text;

  return (
    <div
      data-testid={`kiro-subagent-row-${run.id}`}
      data-status={run.status}
      className="rounded-lg border border-line-soft bg-alabaster/30 px-2 py-1.5 animate-enter"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={`${SUBAGENT_ROLE_LABELS[run.role]}：${run.task}`}
        className="w-full text-left"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon className="w-3.5 h-3.5 text-sandrift shrink-0" aria-hidden="true" />
          <span className="text-[11px] font-bold text-charcoal shrink-0">
            {SUBAGENT_ROLE_LABELS[run.role]}
          </span>
          <span
            className={cn(
              "shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold leading-none transition-colors duration-[var(--motion-fast)]",
              statusTone(run)
            )}
          >
            <span key={run.status} className="inline-block kiro-status-swap">
              {statusLabel(run)}
            </span>
          </span>
          <span className="ml-auto shrink-0 text-[9px] tabular-nums text-sandrift">{duration}</span>
          <ChevronDown
            className={cn(
              "w-3 h-3 text-sandrift shrink-0 transition-transform duration-[var(--motion-fast)]",
              expanded && "rotate-180"
            )}
            aria-hidden="true"
          />
        </div>
        <p className="mt-0.5 text-[10px] leading-relaxed text-satin-grey line-clamp-2 break-words">
          {run.task}
        </p>
      </button>

      {/* 运行中：始终展示流式正文 tail + 步骤，不要求用户展开 */}
      {run.status === "running" && (
        <>
          {run.steps.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {run.steps.slice(-3).map((step) => (
                <p key={step.id} className="flex items-center gap-1 text-[9px] text-satin-grey min-w-0">
                  {stepIcon(step.status)}
                  <span className="truncate">{step.label}</span>
                  {step.detail && <span className="truncate text-sandrift">· {step.detail}</span>}
                </p>
              ))}
            </div>
          )}
          {text && (
            <div className="mt-1 max-h-24 overflow-y-auto overscroll-contain rounded-md bg-surface/80 px-1.5 py-1">
              <p className="whitespace-pre-wrap break-words text-[9px] leading-relaxed text-satin-grey">
                {text.slice(-800)}
              </p>
            </div>
          )}
        </>
      )}

      {expanded && (
        <DisclosureRegion open>
          <div className="mt-1.5 space-y-1.5 border-t border-line-soft pt-1.5">
            {run.steps.length > 0 && (
              <div className="space-y-0.5">
                {run.steps.map((step) => (
                  <p key={step.id} className="flex items-center gap-1 text-[9px] text-satin-grey min-w-0">
                    {stepIcon(step.status)}
                    <span className="truncate">{step.label}</span>
                    {step.detail && <span className="truncate text-sandrift">· {step.detail}</span>}
                  </p>
                ))}
              </div>
            )}
            {text ? (
              <div className="max-h-40 overflow-y-auto overscroll-contain rounded-md bg-surface/80 px-1.5 py-1">
                <p className="whitespace-pre-wrap break-words text-[10px] leading-relaxed text-satin-grey">
                  {text}
                </p>
              </div>
            ) : (
              <p className="text-[10px] text-sandrift">暂无输出。</p>
            )}
            {run.error && <p className="text-[10px] text-danger">{run.error}</p>}
          </div>
        </DisclosureRegion>
      )}
    </div>
  );
}
