"use client";

import React from "react";
import { ArrowRight, LifeBuoy, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import type { PlanProposal } from "@/lib/plan/planTypes";
import { cn } from "@/lib/utils";

export function PlanProposalPanel({
  proposal,
  applying,
  onClose,
  onApply,
}: {
  proposal: PlanProposal;
  applying: boolean;
  onClose: () => void;
  onApply: () => void;
}) {
  if (proposal.kind === "plan") {
    const tasks = proposal.items.length;
    const blocks = proposal.items.reduce((sum, item) => sum + item.proposedBlocks.length, 0);
    const minutes = proposal.items.reduce((sum, item) => sum + item.proposedMinutes, 0);
    const overlaps = proposal.items.filter((item) => item.requiresCourseOverlapApproval).length;

    return (
      <ProposalShell
        icon={<Sparkles className="h-4 w-4" />}
        title="自动安排本周"
        summary={`${tasks} 个任务 · ${blocks} 个时段 · ${minutes} 分钟`}
        onClose={onClose}
        applying={applying}
        applyLabel="应用计划"
        onApply={onApply}
        warning={overlaps > 0 ? `${overlaps} 个任务会与课程时间重叠，应用前会再次确认。` : undefined}
      >
        <div className="space-y-2">
          {proposal.items.slice(0, 8).map((item) => (
            <div key={item.assignmentId} className="rounded-lg border border-line-soft bg-surface-soft px-3 py-2">
              <p className="truncate text-[12px] font-semibold text-charcoal">{item.title}</p>
              <p className="mt-0.5 text-[10px] text-sandrift">
                {item.proposedBlocks
                  .slice(0, 3)
                  .map(
                    (block) =>
                      `${block.date.slice(5).replace("-", "/")} ${block.startTime}–${block.endTime}`
                  )
                  .join(" · ")}
                {item.proposedBlocks.length > 3
                  ? ` · 还有 ${item.proposedBlocks.length - 3} 个时段`
                  : ""}
              </p>
              {item.reasons.includes("missing_estimate") && (
                <p className="mt-0.5 text-[10px] text-warning">缺少预计耗时，未自动安排。</p>
              )}
            </div>
          ))}
          {proposal.items.length > 8 && (
            <p className="px-1 text-[10px] text-sandrift">
              还有 {proposal.items.length - 8} 个任务未展示
            </p>
          )}
        </div>
      </ProposalShell>
    );
  }

  const moves = proposal.proposal.moves;
  return (
    <ProposalShell
      icon={<LifeBuoy className="h-4 w-4" />}
      title="救援调整"
      summary={`移动 ${moves.length} 个学习块 · ${proposal.proposal.summary.movedMinutes} 分钟`}
      onClose={onClose}
      applying={applying}
      applyLabel="应用调整"
      onApply={onApply}
      warning={
        proposal.proposal.summary.shortfallBefore > proposal.proposal.summary.shortfallAfter
          ? `预计减少容量缺口 ${Math.round(
              proposal.proposal.summary.shortfallBefore - proposal.proposal.summary.shortfallAfter
            )} 分钟`
          : undefined
      }
    >
      <div className="space-y-2">
        {moves.map((move) => (
          <div key={move.blockId} className="rounded-lg border border-line-soft bg-surface-soft px-3 py-2">
            <p className="truncate text-[12px] font-semibold text-charcoal">{move.title}</p>
            <p className="mt-0.5 flex items-center gap-1 text-[10px] tabular-nums text-sandrift">
              {move.from.date.slice(5).replace("-", "/")} {move.from.startTime}–{move.from.endTime}
              <ArrowRight className="h-2.5 w-2.5" />
              {move.to.date.slice(5).replace("-", "/")} {move.to.startTime}–{move.to.endTime}
            </p>
          </div>
        ))}
        {moves.length === 0 && (
          <p className="text-xs text-satin-grey">当前没有需要调整的学习块。</p>
        )}
      </div>
    </ProposalShell>
  );
}

function ProposalShell({
  icon,
  title,
  summary,
  onClose,
  applying,
  applyLabel,
  onApply,
  warning,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  summary: string;
  onClose: () => void;
  applying: boolean;
  applyLabel: string;
  onApply: () => void;
  warning?: string;
  children: React.ReactNode;
}) {
  return (
    <aside
      data-testid="plan-proposal-panel"
      aria-label={title}
      className={cn(
        "ux-detail-in absolute bottom-3 right-3 z-40 flex max-h-[72%] w-[360px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-card"
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-line-soft px-4 py-3">
        <span className="text-sandrift">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold tracking-tight text-charcoal">{title}</h2>
          <p className="mt-0.5 text-[10px] text-sandrift">{summary}</p>
        </div>
        <IconButton variant="ghost" size="sm" aria-label="关闭建议" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {warning && (
          <p className="mb-2 rounded-lg border border-warning-border bg-warning-bg/60 px-2.5 py-1.5 text-[10px] font-semibold text-warning">
            {warning}
          </p>
        )}
        {children}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line-soft px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onClose} disabled={applying}>
          取消
        </Button>
        <Button variant="primary" size="sm" onClick={onApply} disabled={applying}>
          {applying ? "应用中…" : applyLabel}
        </Button>
      </div>
    </aside>
  );
}
