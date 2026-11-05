"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, ListChecks, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { isSafeWebUrl } from "@/lib/ai/citations/parser";
import type {
  MiniChatActivitySummary,
  MiniChatApprovalSummary,
  MiniChatPlanSummary,
  MiniChatSourceSummary,
} from "@/lib/ai/miniChat/protocol";

const PLAN_STATUS_LABEL: Record<MiniChatPlanSummary["status"], string> = {
  proposed: "待批准",
  approved: "执行中",
  deviated: "有偏离",
  completed: "已完成",
  cancelled: "已取消",
  superseded: "已取代",
};

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function MiniChatStatusStrip({
  plan,
  activity,
  approval,
  sources,
  error,
  approvalBusy,
  onApprove,
  onDeny,
  onFocusMain,
}: {
  plan: MiniChatPlanSummary | null;
  activity: MiniChatActivitySummary | null;
  approval: MiniChatApprovalSummary | null;
  sources: MiniChatSourceSummary[];
  /** 本轮运行时错误（phase=error）；显示独立错误卡，取代计划/来源等次要信息 */
  error: boolean;
  approvalBusy: boolean;
  onApprove: () => void;
  onDeny: () => void;
  onFocusMain: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!approval?.pending || approval.deadlineAt == null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [approval?.pending, approval?.deadlineAt]);

  if (!plan && !activity && !approval && sources.length === 0 && !error) return null;

  const remainingMs =
    approval?.deadlineAt != null ? Math.max(0, approval.deadlineAt - now) : null;
  const urgent = remainingMs != null && remainingMs <= 30_000;
  const compactPlan =
    !!plan &&
    (!!approval?.pending ||
      plan.status === "completed" ||
      plan.status === "cancelled" ||
      plan.status === "superseded");

  return (
    <div className="shrink-0 space-y-1 px-2.5 pb-1.5" data-testid="kiro-mini-status-strip">
      {error && (
        <div
          data-testid="kiro-mini-error"
          className="rounded-xl border border-danger-border/70 bg-danger-bg/40 px-2.5 py-2 text-[11px] animate-enter"
        >
          <div className="flex items-center gap-1.5 font-bold text-danger">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>本轮回答失败</span>
          </div>
          <p className="mt-0.5 break-words text-[11px] text-satin-grey">
            可以回主窗口查看详细错误，或重新发送。
          </p>
          <button
            type="button"
            onClick={onFocusMain}
            className="mini-no-drag mt-1.5 inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-semibold text-satin-grey hover:bg-alabaster hover:text-charcoal"
          >
            主窗口查看
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      )}

      {!error && approval?.pending && (
        <div
          data-testid="kiro-mini-approval"
          data-risk={approval.highRisk ? "high" : "low"}
          className={cn(
            "rounded-xl border px-2.5 py-2 text-[11px] animate-enter",
            approval.highRisk
              ? "border-danger-border/70 bg-danger-bg/40 text-danger"
              : "border-line bg-alabaster/60 text-charcoal"
          )}
        >
          <div className="flex items-center gap-1.5 font-bold">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{approval.title ?? "Kiro 需要确认"}</span>
            {approval.queueLength != null && approval.queueLength > 1 && (
              <span className="shrink-0 text-[9px] font-semibold text-satin-grey">
                +{approval.queueLength - 1}
              </span>
            )}
            {remainingMs != null && (
              <span
                data-testid="kiro-mini-approval-countdown"
                className={cn(
                  "ml-auto shrink-0 tabular-nums text-[9px] font-semibold",
                  urgent ? "text-danger" : "text-satin-grey"
                )}
              >
                {urgent && remainingMs <= 0 ? "即将取消" : `剩余 ${formatRemaining(remainingMs)}`}
              </span>
            )}
          </div>
          {approval.primary && (
            <p className="mt-0.5 break-words text-[11px] text-satin-grey">{approval.primary}</p>
          )}
          {approval.warnings && approval.warnings.length > 0 && (
            <p className="mt-1 flex items-start gap-1 text-[10px] leading-relaxed">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" aria-hidden="true" />
              <span className="text-satin-grey">{approval.warnings[0]}</span>
            </p>
          )}
          <div className="mt-1.5 flex items-center gap-1.5">
            <button
              type="button"
              disabled={approvalBusy}
              onClick={onDeny}
              className="mini-no-drag h-7 rounded-md border border-line bg-surface px-2.5 text-[10px] font-semibold text-satin-grey hover:text-danger disabled:opacity-40"
            >
              拒绝
            </button>
            {approval.canApproveInMini && (
              <button
                type="button"
                disabled={approvalBusy}
                onClick={onApprove}
                className="mini-no-drag h-7 rounded-md bg-charcoal px-2.5 text-[10px] font-bold text-white hover:opacity-90 disabled:opacity-40"
              >
                允许一次
              </button>
            )}
            <button
              type="button"
              onClick={onFocusMain}
              className="mini-no-drag ml-auto inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[10px] font-semibold text-satin-grey hover:text-charcoal"
            >
              主窗口处理
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {!error && compactPlan && plan && (
        <div
          data-testid="kiro-mini-plan"
          data-compact="true"
          className="flex items-center gap-1.5 rounded-lg bg-alabaster/45 px-2 py-1.5 text-[10px] animate-enter"
        >
          <ListChecks className="h-3 w-3 shrink-0 text-satin-grey" aria-hidden="true" />
          <span className="truncate font-semibold text-satin-grey">{plan.title}</span>
          <span className="ml-auto shrink-0 tabular-nums text-satin-grey">
            {plan.completed}/{plan.total}
          </span>
          <span className="shrink-0 text-[9px] font-bold text-charcoal/70">
            {PLAN_STATUS_LABEL[plan.status]}
          </span>
        </div>
      )}

      {!error && !compactPlan && plan && (
        <div data-testid="kiro-mini-plan" className="rounded-lg bg-alabaster/45 px-2 py-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-satin-grey">
            <ListChecks className="h-3 w-3 shrink-0 text-satin-grey" aria-hidden="true" />
            <span className="truncate">{plan.title}</span>
            <span className="ml-auto shrink-0 tabular-nums text-satin-grey">
              {plan.completed}/{plan.total}
            </span>
            <span className="shrink-0 text-[9px] font-bold text-charcoal/70">
              {PLAN_STATUS_LABEL[plan.status]}
            </span>
          </div>
          <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-line-soft">
            <div
              className="h-full w-full origin-left rounded-full bg-charcoal/60 transition-transform duration-[var(--motion-base)]"
              style={{ transform: `scaleX(${plan.total > 0 ? plan.completed / plan.total : 0})` }}
            />
          </div>
          {plan.currentStep && (
            <p className="mt-1 truncate text-[10px] text-satin-grey">当前：{plan.currentStep}</p>
          )}
        </div>
      )}

      {!error && activity && !plan && (
        <div className="flex items-center gap-1.5 px-0.5 text-[10px] text-satin-grey">
          <span className="truncate">{activity.label}</span>
          <span className="ml-auto shrink-0 tabular-nums">
            {activity.done}/{activity.total}
          </span>
        </div>
      )}

      {!error && !approval?.pending && sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {sources.map((source) =>
            isSafeWebUrl(source.url) ? (
              <a
                key={source.id}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mini-no-drag inline-flex h-7 max-w-full items-center gap-1 rounded-full border border-line bg-surface px-2.5 text-[9px] text-satin-grey hover:text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-charcoal/15"
                aria-label={source.title}
              >
                <span className="truncate max-w-[120px]">{source.domain || source.title}</span>
              </a>
            ) : (
              <span
                key={source.id}
                className="inline-flex h-7 max-w-full items-center gap-1 rounded-full border border-line bg-surface px-2.5 text-[9px] text-satin-grey"
              >
                <span className="truncate max-w-[120px]">{source.domain || source.title}</span>
              </span>
            )
          )}
        </div>
      )}
    </div>
  );
}
