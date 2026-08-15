"use client";

import React, { useRef, useState } from "react";
import {
  ArrowRightLeft,
  Ban,
  CalendarClock,
  CalendarPlus,
  Check,
  ChevronDown,
  Image as ImageIcon,
  Pencil,
  Plus,
  Repeat,
  X,
} from "lucide-react";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import { useToastStore } from "@/store/useToastStore";
import { executeVisualActionProposal } from "@/lib/ai/visual/executor";
import {
  VisualActionKind,
  VisualActionProposal,
} from "@/lib/ai/visual/types";

type ApplyState = "idle" | "applying" | "applied" | "stale" | "revoked";

/** 语义图标 + 分组行标签（与 StudyPlan / Action Card 同一 visual family） */
const KIND_META: Record<VisualActionKind, { icon: React.ComponentType<{ className?: string }>; label: string }> = {
  "assignment-create": { icon: Plus, label: "新建任务" },
  "assignment-update": { icon: Pencil, label: "修改任务" },
  "ddl-update": { icon: CalendarClock, label: "调整截止时间" },
  "schedule-cancel": { icon: Ban, label: "临时停课" },
  "schedule-move": { icon: ArrowRightLeft, label: "临时调课" },
  "schedule-extra": { icon: CalendarPlus, label: "临时补课" },
  "schedule-permanent-update": { icon: Repeat, label: "永久调整排课" },
};

/**
 * Visual Action Intake Proposal Card（事实 UI）：
 * 渲染 propose_visual_actions 的确定性结果；用户一次确认（应用全部修改）后，
 * 客户端直接调用 executeVisualActionProposal（Change Set V2 preapproved 模式，不再弹 generic confirm）。
 * idle → applying → applied / stale / revoked；stale 走 handoffPrompt 重新分析（UI 不自行重算）。
 */
export function VisualActionProposalCard({ proposal }: { proposal: VisualActionProposal }) {
  const [dismissed, setDismissed] = useState(false);
  const [applyState, setApplyState] = useState<ApplyState>("idle");
  const [expandedEvidence, setExpandedEvidence] = useState<string | null>(null);
  const undoRef = useRef<(() => void) | null>(null);
  const pushToast = useToastStore((s) => s.pushToast);
  const handoffPrompt = useKiroSession().handoffPrompt;

  if (dismissed) return null;

  const handleApply = async () => {
    if (applyState === "applying") return;
    setApplyState("applying");
    const result = await executeVisualActionProposal({ proposal, pushToast });
    if (result.ok) {
      undoRef.current = result.undo;
      setApplyState("applied");
      pushToast({
        message: `已应用 ${result.count} 项修改`,
        actionLabel: "撤销",
        onAction: handleUndo,
      });
      return;
    }
    if (result.stale) {
      setApplyState("stale");
      return;
    }
    // 其他失败（commit 异常已回滚等）：保持可重试，错误由 toast 说明
    setApplyState("idle");
    pushToast({ message: result.message, type: "error" });
  };

  const handleUndo = () => {
    if (undoRef.current) {
      try {
        undoRef.current();
      } catch {
        /* Undo 异常不阻断 UI */
      }
    }
    setApplyState("revoked");
  };

  const handleReanalyze = () => {
    handoffPrompt("请根据最新 ClassFlow 数据重新检查刚才截图中的通知。");
  };

  const renderStatus = () => {
    if (applyState === "applied") {
      return (
        <span className="mr-auto flex items-center gap-1 text-[10px] font-semibold text-[#627566]">
          <Check className="w-3 h-3" />
          已应用 {proposal.actions.length} 项修改
        </span>
      );
    }
    if (applyState === "stale") {
      return (
        <span className="mr-auto text-[10px] font-semibold text-danger">
          方案已过期：ClassFlow 中的课程或任务已经发生变化。
        </span>
      );
    }
    if (applyState === "revoked") {
      return (
        <span className="mr-auto text-[10px] font-semibold text-sandrift">
          已撤销 {proposal.actions.length} 项修改，恢复到应用前状态。
        </span>
      );
    }
    return (
      <span className="mr-auto text-[10px] text-sandrift">
        {applyState === "applying" ? "正在应用…" : "未写入任何修改"}
      </span>
    );
  };

  const renderActions = () => {
    if (applyState === "applied") {
      return (
        <button
          onClick={handleUndo}
          data-testid="visual-undo"
          className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors"
        >
          撤销
        </button>
      );
    }
    if (applyState === "stale") {
      return (
        <button
          onClick={handleReanalyze}
          data-testid="visual-reanalyze"
          className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors"
        >
          重新分析
        </button>
      );
    }
    if (applyState === "revoked") {
      return null;
    }
    return (
      <>
        <button
          onClick={() => setDismissed(true)}
          data-testid="visual-cancel"
          className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-satin-grey bg-transparent border border-line hover:text-charcoal hover:border-line-strong transition-colors"
        >
          取消
        </button>
        <button
          onClick={handleApply}
          disabled={applyState === "applying"}
          data-testid="visual-apply"
          className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black disabled:opacity-60 transition-colors"
        >
          应用全部修改
        </button>
      </>
    );
  };

  return (
    <div
      data-testid="visual-action-proposal"
      className="mt-2.5 bg-surface border border-line-strong rounded-2xl shadow-card p-3.5 space-y-3 animate-enter"
    >
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-charcoal">
          <ImageIcon className="w-3.5 h-3.5 text-[#A48F82]" />
          从截图整理出 {proposal.actions.length} 项修改
          <span className="text-[10px] font-semibold text-sandrift">
            · {proposal.sourceAttachmentIds.length} 张图片
          </span>
        </p>
        <button
          onClick={() => setDismissed(true)}
          aria-label="关闭"
          className="p-1 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="divide-y divide-line-soft">
        {proposal.actions.map((a) => {
          const meta = KIND_META[a.display.kind] ?? KIND_META["assignment-update"];
          const MetaIcon = meta.icon;
          const expanded = expandedEvidence === a.id;
          return (
            <div key={a.id} className="py-1.5 first:pt-0 last:pb-0">
              <div className="flex items-start gap-2">
                <span className="mt-px w-5 h-5 shrink-0 rounded-md bg-alabaster border border-line-soft flex items-center justify-center">
                  <MetaIcon className="w-3 h-3 text-sandrift" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold text-charcoal leading-snug">{a.display.title}</p>
                  <p className="text-[10px] text-satin-grey mt-0.5 leading-snug">
                    {a.display.subtitle ? a.display.subtitle : meta.label}
                  </p>
                  {/* Evidence：默认隐藏，低权重展开（不把截图原文撑长） */}
                  <button
                    type="button"
                    onClick={() => setExpandedEvidence(expanded ? null : a.id)}
                    className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-sandrift hover:text-charcoal transition-colors"
                  >
                    依据
                    <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} />
                  </button>
                  {expanded && (
                    <p className="mt-1 text-[10px] text-satin-grey leading-snug bg-alabaster/60 border border-line-soft rounded-lg px-2 py-1.5">
                      “{a.evidence.text}”
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 pt-1 border-t border-line-soft">
        {renderStatus()}
        {renderActions()}
      </div>
    </div>
  );
}
