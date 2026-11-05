"use client";

import React, { useEffect, useState } from "react";
import { Check, Loader2, Search, ShieldCheck, ListChecks, AlertCircle } from "lucide-react";
import { useKiroSubagentStore, type KiroSubagentRun, type KiroSubagentStepStatus } from "@/store/useKiroSubagentStore";
import { SUBAGENT_ROLE_LABELS } from "@/lib/ai/agent/subagent";
import { cn } from "@/lib/utils";

function useElapsedSeconds(startedAt: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return Math.max(0, Math.round((now - startedAt) / 1000));
}

function stepIcon(status: KiroSubagentStepStatus) {
  if (status === "done") return <Check className="w-3 h-3 text-success shrink-0" aria-hidden="true" />;
  if (status === "error") return <AlertCircle className="w-3 h-3 text-danger shrink-0" aria-hidden="true" />;
  return <Loader2 className="w-3 h-3 text-charcoal animate-spin shrink-0" aria-hidden="true" />;
}

const ROLE_ICONS = {
  researcher: Search,
  planner: ListChecks,
  reviewer: ShieldCheck,
} as const;

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

/**
 * 子代理内联卡片（Worklog 内；随主对话流式区域出现）：
 * - 运行中实时显示步骤状态与正文 tail（不强制把 Worklog 展开成完整 transcript）；
 * - 完成/失败保留低权重摘要；完整结果在右侧 Inspector 子代理栏目查看；
 * - 历史消息没有 live run → 显示归档占位（避免伪造进度）。
 */
export function KiroSubagentInlineCard({
  toolCallId,
  fallbackLabel,
  fallbackStatus,
}: {
  toolCallId: string;
  fallbackLabel: string;
  fallbackStatus: "working" | "done" | "error";
}) {
  const run = useKiroSubagentStore((s) => s.runs[toolCallId]);
  const elapsed = useElapsedSeconds(run?.startedAt ?? Date.now(), run?.status === "running");

  if (!run) {
    return (
      <div
        data-testid="kiro-subagent-inline"
        className="flex items-center gap-1.5 px-2 h-7 text-[11px] rounded-lg border border-transparent text-satin-grey"
      >
        {fallbackStatus === "error" ? (
          <AlertCircle className="w-3.5 h-3.5 text-danger shrink-0" aria-hidden="true" />
        ) : (
          <ListChecks className="w-3.5 h-3.5 text-sandrift shrink-0" aria-hidden="true" />
        )}
        <span className="truncate">{fallbackLabel}</span>
        <span className="ml-auto shrink-0 text-[9px] text-sandrift">结果已归档</span>
      </div>
    );
  }

  const Icon = ROLE_ICONS[run.role];
  const activeSteps = run.steps.filter((s) => s.status !== "done").slice(-1);
  const shownSteps = (activeSteps.length > 0 ? activeSteps : run.steps.slice(-2)).slice(-2);
  const tail = run.text.length > 700 ? run.text.slice(-700) : run.text;

  return (
    <div
      data-testid="kiro-subagent-inline"
      data-status={run.status}
      className={cn(
        "rounded-xl border border-line-soft bg-alabaster/35 px-3 py-2.5 min-w-0 animate-enter",
        run.status === "failed" && "border-danger-border/60 bg-danger-bg/30"
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="w-3.5 h-3.5 text-sandrift shrink-0" aria-hidden="true" />
        <span className="text-[11px] font-bold text-charcoal truncate">
          {SUBAGENT_ROLE_LABELS[run.role]}
        </span>
        <span className="text-[10px] text-sandrift truncate min-w-0 hidden sm:inline">
          {run.task}
        </span>
        <span
          className={cn(
            "ml-auto shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold leading-none",
            statusTone(run)
          )}
        >
          {statusLabel(run)}
        </span>
        <span className="shrink-0 text-[9px] tabular-nums text-sandrift">
          {run.status === "running" ? `${elapsed}s` : run.completedAt ? `${Math.max(0, Math.round((run.completedAt - run.startedAt) / 1000))}s` : ""}
        </span>
      </div>

      {shownSteps.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {shownSteps.map((step) => (
            <span key={step.id} className="flex items-center gap-1 min-w-0 text-[10px] text-satin-grey">
              {stepIcon(step.status)}
              <span className="truncate max-w-[220px]">{step.label}</span>
              {step.detail && <span className="text-sandrift truncate max-w-[180px]">· {step.detail}</span>}
            </span>
          ))}
        </div>
      )}

      {tail ? (
        <div className="mt-1.5 max-h-24 overflow-y-auto overscroll-contain rounded-lg bg-surface/70 px-2 py-1.5">
          <p className="whitespace-pre-wrap break-words text-[10px] leading-relaxed text-satin-grey">
            {tail}
          </p>
        </div>
      ) : run.status === "running" ? (
        <p className="mt-1.5 text-[10px] text-sandrift">
          {run.steps.length > 0 ? "正在检索并整理结果…" : "子代理正在分析…"}
        </p>
      ) : null}

      {run.status === "completed" && (
        <p className="mt-1 text-[9px] text-sandrift/90">完整结果见右侧「子代理」栏目</p>
      )}
      {run.error && <p className="mt-1 text-[10px] text-danger">{run.error}</p>}
    </div>
  );
}
