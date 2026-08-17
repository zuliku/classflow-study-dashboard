"use client";

import React, { useMemo, useState } from "react";
import {
  ArrowRightLeft,
  Ban,
  CalendarClock,
  CalendarPlus,
  Check,
  ChevronDown,
  Circle,
  CircleHelp,
  CircleSlash,
  Image as ImageIcon,
  Pencil,
  Plus,
  Repeat,
} from "lucide-react";
import { PersistedVisualProposalView } from "@/lib/ai/history/types";
import { VisualActionKind } from "@/lib/ai/visual/types";
import { cn } from "@/lib/utils";

/**
 * Visual Action Intake V1.3 + V1.5：历史只读 Proposal 快照 Card（display-only）。
 * - props 是 PersistedVisualProposalView（类型上不可能变成 VisualActionProposal）
 * - 0 Mutation Entry Point：无 Apply / Undo / Continue / Reanalyze / Cancel / Close
 * - Evidence 可展开查看（安全 display fact）；不尝试打开原截图（Local Blob 不保留）
 * - V1.5：receipt.appliedActionIndexes 投影行级「当时已应用 / 当时未应用」
 *   （缺省 = 当时全部应用）；只描述「当时发生过什么」，绝不声称当前状态
 */
const KIND_META: Record<VisualActionKind, { icon: React.ComponentType<{ className?: string }>; label: string }> = {
  "assignment-create": { icon: Plus, label: "新建任务" },
  "assignment-update": { icon: Pencil, label: "修改任务" },
  "ddl-update": { icon: CalendarClock, label: "调整截止时间" },
  "schedule-cancel": { icon: Ban, label: "临时停课" },
  "schedule-move": { icon: ArrowRightLeft, label: "临时调课" },
  "schedule-extra": { icon: CalendarPlus, label: "临时补课" },
  "schedule-permanent-update": { icon: Repeat, label: "永久调整排课" },
};

export function VisualActionProposalHistoryCard({ proposal }: { proposal: PersistedVisualProposalView }) {
  const [expandedEvidence, setExpandedEvidence] = useState<string | null>(null);

  const executableCount = proposal.actions.length;
  const clarificationCount = proposal.pendingItems.filter((p) => p.reason !== "unsupported-action").length;
  const unsupportedCount = proposal.pendingItems.length - clarificationCount;
  const totalCount = executableCount + proposal.pendingItems.length;
  const imageCount = proposal.imageCount;

  // V1.5：receipt 投影 —— appliedIndexes 缺省 = 当时全部应用
  const appliedIdSet = useMemo(() => {
    const indexes = proposal.receipt?.appliedActionIndexes;
    if (!indexes) return null;
    const set = new Set<number>();
    for (const i of indexes) {
      if (Number.isInteger(i) && i >= 0 && i < proposal.actions.length) set.add(i);
    }
    return set;
  }, [proposal.receipt, proposal.actions.length]);
  const appliedCount = appliedIdSet === null ? executableCount : appliedIdSet.size;
  const unappliedCount = executableCount - appliedCount;
  const hadReceipt = proposal.receipt?.status === "applied" || proposal.receipt?.status === "revoked";

  const headerText = () => {
    if (proposal.origin === "clarification") {
      return `根据后续确认生成的操作预览 · ${totalCount} 项`;
    }
    return `历史操作预览 · ${totalCount} 项`;
  };

  const headerSub = () => {
    const parts: string[] = [];
    if (executableCount > 0) parts.push(`${executableCount} 项修改`);
    if (clarificationCount > 0) parts.push(`${clarificationCount} 项待确认`);
    if (unsupportedCount > 0) parts.push(`${unsupportedCount} 项暂无法处理`);
    if (imageCount > 0) parts.push(`${imageCount} 张图片`);
    return parts.join(" · ");
  };

  const renderPendingRow = (p: PersistedVisualProposalView["pendingItems"][number], key: number) => (
    <div key={key} className="py-1.5 first:pt-0 last:pb-0">
      <div className="flex items-start gap-2">
        <span className="mt-px w-5 h-5 shrink-0 rounded-md bg-alabaster border border-line-soft flex items-center justify-center">
          {p.reason === "unsupported-action" ? (
            <CircleSlash className="w-3 h-3 text-sandrift" />
          ) : (
            <CircleHelp className="w-3 h-3 text-sandrift" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-charcoal leading-snug">“{p.evidence}”</p>
          <p className="text-[10px] text-satin-grey mt-0.5 leading-snug">{p.description}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div
      data-testid="visual-action-proposal-history"
      className="mt-2.5 bg-surface border border-line rounded-2xl shadow-card p-3.5 space-y-3"
    >
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-charcoal">
          <ImageIcon className="w-3.5 h-3.5 text-[#A48F82]" />
          {headerText()}
          <span className="text-[10px] font-semibold text-sandrift">{headerSub() ? ` · ${headerSub()}` : ""}</span>
        </p>
      </div>

      {executableCount > 0 && (
        <div>
          {/* V1.5.1：History 是 display-only —— 不再说「可应用修改」（避免暗示当前仍可执行）；
              有 Receipt 时表述为「操作记录」（描述当时发生过什么） */}
          <p className="text-[10px] font-semibold text-sandrift mb-1">
            {hadReceipt ? "操作记录" : "识别出的修改"} · {executableCount}
            {hadReceipt && unappliedCount > 0 && <span className="text-sandrift"> · 当时未应用 {unappliedCount}</span>}
          </p>
          <div className="divide-y divide-line-soft">
            {proposal.actions.map((a, i) => {
              const meta = KIND_META[a.kind] ?? KIND_META["assignment-update"];
              const MetaIcon = meta.icon;
              const expanded = expandedEvidence === `h-${i}`;
              const rowApplied = hadReceipt && (appliedIdSet === null || appliedIdSet.has(i));
              return (
                <div key={`h-${i}`} className="py-1.5 first:pt-0 last:pb-0">
                  <div className="flex items-start gap-2">
                    <span className="mt-px w-5 h-5 shrink-0 rounded-md bg-alabaster border border-line-soft flex items-center justify-center">
                      <MetaIcon className="w-3 h-3 text-sandrift" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="min-w-0 flex-1 text-[11px] font-semibold text-charcoal leading-snug truncate">
                          {a.title}
                        </p>
                        {hadReceipt && (
                          <span
                            data-testid="visual-history-row-state"
                            className={cn(
                              "shrink-0 flex items-center gap-0.5 text-[9px] font-bold",
                              rowApplied ? "text-[#627566]" : "text-sandrift"
                            )}
                          >
                            {rowApplied ? <Check className="w-2.5 h-2.5" /> : <Circle className="w-2 h-2" />}
                            {rowApplied ? "当时已应用" : "当时未应用"}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-satin-grey mt-0.5 leading-snug">
                        {a.subtitle ? a.subtitle : meta.label}
                      </p>
                      {a.evidence ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setExpandedEvidence(expanded ? null : `h-${i}`)}
                            className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-sandrift hover:text-charcoal transition-colors"
                          >
                            依据
                            <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
                          </button>
                          {expanded && (
                            <p className="mt-1 text-[10px] text-satin-grey leading-snug bg-alabaster/60 border border-line-soft rounded-lg px-2 py-1.5">
                              “{a.evidence}”
                            </p>
                          )}
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {clarificationCount > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-sandrift mb-1">需要确认 · {clarificationCount}</p>
          <div className="divide-y divide-line-soft">
            {proposal.pendingItems
              .filter((p) => p.reason !== "unsupported-action")
              .map((p, i) => renderPendingRow(p, i))}
          </div>
        </div>
      )}

      {unsupportedCount > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-sandrift mb-1">暂无法处理 · {unsupportedCount}</p>
          <div className="divide-y divide-line-soft">
            {proposal.pendingItems
              .filter((p) => p.reason === "unsupported-action")
              .map((p, i) => renderPendingRow(p, i))}
          </div>
        </div>
      )}

      <div className="pt-1 border-t border-line-soft">
        {/* V1.4/V1.5：Durable Execution Receipt（描述「当时发生过什么」；绝不声称当前 ClassFlow 状态） */}
        {proposal.receipt?.status === "applied" ? (
          <p className="flex items-center gap-1 text-[10px] font-semibold text-[#627566]">
            <Check className="w-3 h-3" />
            当时已应用 {appliedCount} 项修改
            {unappliedCount > 0 && <span className="text-sandrift">· {unappliedCount} 项当时未应用</span>}
            {clarificationCount > 0 && <span className="text-sandrift">· {clarificationCount} 项仍待确认</span>}
          </p>
        ) : proposal.receipt?.status === "revoked" ? (
          <p className="flex items-center gap-1 text-[10px] font-semibold text-sandrift">
            <Check className="w-3 h-3" />
            当时已应用后撤销 {appliedCount} 项修改
            {unappliedCount > 0 && <span> · {unappliedCount} 项当时未应用</span>}
            {clarificationCount > 0 && <span> · {clarificationCount} 项仍待确认</span>}
          </p>
        ) : (
          // V1.5.1：无 receipt → 「当时未执行修改 · 仅供回看」（绝不让用户觉得历史卡片仍可应用）
          <p className="text-[10px] font-semibold text-sandrift">当时未执行修改 · 仅供回看</p>
        )}
      </div>
    </div>
  );
}
