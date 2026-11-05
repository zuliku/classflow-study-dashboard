"use client";

import React from "react";
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
  deviated: "有放行",
  completed: "已完成",
  cancelled: "已取消",
  superseded: "已取代",
};

export function MiniChatStatusStrip({
  plan,
  activity,
  approval,
  sources,
  approvalBusy,
  onApprove,
  onDeny,
  onFocusMain,
}: {
  plan: MiniChatPlanSummary | null;
  activity: MiniChatActivitySummary | null;
  approval: MiniChatApprovalSummary | null;
  sources: MiniChatSourceSummary[];
  approvalBusy: boolean;
  onApprove: () => void;
  onDeny: () => void;
  onFocusMain: () => void;
}) {
  if (!plan && !activity && !approval && sources.length === 0) return null;
  return (
    <div className="shrink-0 space-y-1 px-2.5 pb-1.5" data-testid="kiro-mini-status-strip">
      {approval?.pending && (
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
            {(approval.queueLength ?? 0) > 1 && (
              <span className="ml-auto shrink-0 text-[9px] font-semibold text-sandrift">
                +{(approval.queueLength ?? 1) - 1}
              </span>
            )}
          </div>
          {approval.primary && (
            <p className="mt-0.5 break-words text-[11px] text-satin-grey">{approval.primary}</p>
          )}
          {approval.warnings && approval.warnings.length > 0 && (
            <p className="mt-1 flex items-start gap-1 text-[10px] leading-relaxed text-warning">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              <span>{approval.warnings[0]}</span>
            </p>
          )}
          <div className="mt-1.5 flex items-center gap-1.5">
            <button
              type="button"
              disabled={approvalBusy}
              onClick={onDeny}
              className="mini-no-drag h-6 rounded-md border border-line bg-surface px-2 text-[10px] font-semibold text-satin-grey hover:text-danger disabled:opacity-40"
            >
              拒绝
            </button>
            {approval.canApproveInMini && (
              <button
                type="button"
                disabled={approvalBusy}
                onClick={onApprove}
                className="mini-no-drag h-6 rounded-md bg-charcoal px-2 text-[10px] font-bold text-white hover:opacity-90 disabled:opacity-40"
              >
                允许一次
              </button>
            )}
            <button
              type="button"
              onClick={onFocusMain}
              className="mini-no-drag ml-auto inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] font-semibold text-sandrift hover:text-charcoal"
            >
              主窗口处理
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {plan && (
        <div data-testid="kiro-mini-plan" className="rounded-lg bg-alabaster/45 px-2 py-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold text-satin-grey">
            <ListChecks className="h-3 w-3 shrink-0 text-sandrift" aria-hidden="true" />
            <span className="truncate">{plan.title}</span>
            <span className="ml-auto shrink-0 tabular-nums text-sandrift">
              {plan.completed}/{plan.total}
            </span>
            <span className="shrink-0 text-[9px] font-bold text-charcoal/70">
              {PLAN_STATUS_LABEL[plan.status]}
            </span>
          </div>
          <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-line-soft">
            <div
              className="h-full rounded-full bg-charcoal/60 transition-[width] duration-[var(--motion-base)]"
              style={{ width: `${plan.total > 0 ? (plan.completed / plan.total) * 100 : 0}%` }}
            />
          </div>
          {plan.currentStep && (
            <p className="mt-1 truncate text-[10px] text-sandrift">当前：{plan.currentStep}</p>
          )}
        </div>
      )}

      {activity && !plan && (
        <div className="flex items-center gap-1.5 px-0.5 text-[10px] text-sandrift">
          <span className="truncate">{activity.label}</span>
          <span className="ml-auto shrink-0 tabular-nums">
            {activity.done}/{activity.total}
          </span>
        </div>
      )}

      {sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {sources.map((source) =>
            isSafeWebUrl(source.url) ? (
              <a
                key={source.id}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mini-no-drag inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-surface px-1.5 py-0.5 text-[9px] text-satin-grey hover:text-charcoal"
                aria-label={source.title}
              >
                <span className="truncate max-w-[120px]">{source.domain || source.title}</span>
              </a>
            ) : (
              <span
                key={source.id}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-surface px-1.5 py-0.5 text-[9px] text-satin-grey"
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
