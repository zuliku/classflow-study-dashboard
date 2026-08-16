"use client";

import React, { useRef, useState } from "react";
import {
  ArrowRightLeft,
  Ban,
  CalendarClock,
  CalendarPlus,
  Check,
  ChevronDown,
  CircleHelp,
  CircleSlash,
  Image as ImageIcon,
  Pencil,
  Plus,
  Repeat,
  X,
} from "lucide-react";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import { useToastStore } from "@/store/useToastStore";
import { executeVisualActionProposal } from "@/lib/ai/visual/executor";
import { buildVisualPendingContinuation } from "@/lib/ai/visual/continuation";
import {
  VisualActionKind,
  VisualActionProposal,
  VisualPendingItem,
} from "@/lib/ai/visual/types";

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
 * Visual Action Intake Proposal Card（V1.2 Mixed + V1.4 Runtime-owned）：事实 UI。
 * executable rows 完全由 Preflight Facts 驱动；pending 只展示澄清/不支持事项（0 mutation）。
 * 所有 count 从 proposal 数据推导（不缓存三份）；pending-only 无 Apply；Applied 后 Receipt 保留 pending。
 * V1.4：执行 Lifecycle 由 Conversation Runtime 拥有（visualProposalRuntime）；
 * Card 只保留 applying/continuing 等 transient UI 状态。remount 后 applied/revoked/stale 仍正确显示。
 */
export function VisualActionProposalCard({
  proposal,
}: {
  proposal: VisualActionProposal;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [expandedEvidence, setExpandedEvidence] = useState<string | null>(null);
  // V1.1：同步 ownership 锁（不依赖 React render 更新时序；只防并发点击，durable status 在 Runtime）
  const applyingRef = useRef(false);
  const [applying, setApplying] = useState(false);
  // V1.2.1：Continue 同步防双击（与 applyingRef 同一模式；不允许两次 handoff 产生两个相同 User Turn）
  const continuingRef = useRef(false);
  const [continuing, setContinuing] = useState(false);
  const pushToast = useToastStore((s) => s.pushToast);
  const { handoffPrompt, handoffVisualPendingContinuation, visualProposalRuntime } = useKiroSession();

  // V1.4：durable lifecycle 来自 Conversation Runtime（undefined = idle；applied/revoked/stale 均可跨 remount 保持）
  const runtimeState = visualProposalRuntime.getState(proposal.id);

  // V1.2：count 全部由数据推导
  const executableCount = proposal.actions.length;
  const clarificationItems = proposal.pendingItems.filter((p) => p.reason !== "unsupported-action");
  const clarificationCount = clarificationItems.length;
  const unsupportedCount = proposal.pendingItems.length - clarificationCount;
  const totalCount = executableCount + proposal.pendingItems.length;
  const hasPending = proposal.pendingItems.length > 0;
  const pendingOnly = executableCount === 0;
  const imageCount = proposal.sourceAttachmentIds.length;

  if (dismissed) return null;

  const handleApply = async () => {
    if (applyingRef.current) return;
    applyingRef.current = true;
    setApplying(true);
    try {
      const result = await executeVisualActionProposal({ proposal, pushToast });
      if (result.ok) {
        // V1.4：execution capability 交给 Conversation Runtime（undo closure 只活在 runtime）
        visualProposalRuntime.recordApplied({
          proposalId: proposal.id,
          count: result.count,
          undo: result.undo,
        });
        pushToast({
          message: `已应用 ${result.count} 项修改`,
          actionLabel: "撤销",
          onAction: () => {
            const outcome = visualProposalRuntime.consumeUndo(proposal.id);
            if (!outcome.ok) pushToast({ message: outcome.message, type: "error" });
          },
        });
        return;
      }
      if (result.stale) {
        // V1.4：stale 也由 Runtime 拥有（remount 后仍显示「方案已过期」）
        visualProposalRuntime.markStale(proposal.id);
        return;
      }
      // 其他失败（commit 异常已回滚等）：保持可重试，错误由 toast 说明
      pushToast({ message: result.message, type: "error" });
    } catch {
      // V1.1：executor 意外 throw 不能把 UI 卡在「正在应用…」；回滚仍由 Change Set executor 负责
      pushToast({ message: "应用失败，没有留下部分修改。", type: "error" });
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  };

  /** V1.4：one-shot Undo —— Card 与 Toast 共用 Runtime（claim + execute；只能成功一次） */
  const handleUndo = () => {
    const outcome = visualProposalRuntime.consumeUndo(proposal.id);
    if (!outcome.ok) pushToast({ message: outcome.message, type: "error" });
  };

  const handleReanalyze = () => {
    handoffPrompt("请根据最新 ClassFlow 数据重新检查刚才截图中的通知。");
  };

  /** V1.2/V1.2.1：继续处理 pending —— 结构化 continuation + 正常用户 prompt（不重新送截图；不直接执行任何写操作）。
   *  同步防双击；handoff 失败（send rejected）→ continuation 已由 provider compare-and-clear 回滚，Card 保持可操作。 */
  const handleContinuePending = async () => {
    if (continuingRef.current) return;
    const continuation = buildVisualPendingContinuation(proposal);
    if (!continuation) return;
    continuingRef.current = true;
    setContinuing(true);
    try {
      await handoffVisualPendingContinuation(
        continuation,
        `继续处理刚才截图里剩下的 ${continuation.pendingItems.length} 项。`
      );
    } finally {
      continuingRef.current = false;
      setContinuing(false);
    }
  };

  const headerText = () => {
    if (pendingOnly) {
      return clarificationCount > 0
        ? `从截图发现 ${totalCount} 项需要确认`
        : `从截图发现 ${totalCount} 项当前暂无法处理`;
    }
    // V1.2.1：澄清链生成的 Proposal B 保留来源链（展示为「根据刚才的确认…」）
    if (proposal.continuationSource) {
      return `根据刚才的确认整理出 ${totalCount} 项修改`;
    }
    return `从截图整理出 ${totalCount} 项`;
  };

  const headerSub = () => {
    const parts: string[] = [];
    if (executableCount > 0) parts.push(`${executableCount} 项可应用`);
    if (clarificationCount > 0) parts.push(`${clarificationCount} 项待确认`);
    if (unsupportedCount > 0) parts.push(`${unsupportedCount} 项暂无法处理`);
    if (imageCount > 0) parts.push(`${imageCount} 张图片`);
    return parts.join(" · ");
  };

  const renderPendingRow = (p: VisualPendingItem) => {
    return (
      <div key={p.id} className="py-1.5 first:pt-0 last:pb-0">
        <div className="flex items-start gap-2">
          <span className="mt-px w-5 h-5 shrink-0 rounded-md bg-alabaster border border-line-soft flex items-center justify-center">
            {p.reason === "unsupported-action" ? (
              <CircleSlash className="w-3 h-3 text-sandrift" />
            ) : (
              <CircleHelp className="w-3 h-3 text-sandrift" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-charcoal leading-snug">“{p.evidence.text}”</p>
            <p className="text-[10px] text-satin-grey mt-0.5 leading-snug">{p.description}</p>
          </div>
        </div>
      </div>
    );
  };

  const renderStatus = () => {
    // V1.4：durable status 来自 Runtime（applied / revoked / stale）；applying 是 transient
    if (runtimeState?.status === "applied") {
      return (
        <span className="mr-auto flex items-center gap-1 text-[10px] font-semibold text-[#627566]">
          <Check className="w-3 h-3" />
          已应用 {runtimeState.count ?? executableCount} 项修改
          {clarificationCount > 0 && <span className="text-sandrift">· {clarificationCount} 项仍待确认</span>}
        </span>
      );
    }
    if (runtimeState?.status === "stale") {
      return (
        <span className="mr-auto text-[10px] font-semibold text-danger">
          方案已过期：ClassFlow 中的课程或任务已经发生变化。
          {clarificationCount > 0 && <span className="text-sandrift">· {clarificationCount} 项仍待确认</span>}
        </span>
      );
    }
    if (runtimeState?.status === "revoked") {
      return (
        <span className="mr-auto text-[10px] font-semibold text-sandrift">
          已撤销 {runtimeState.count ?? executableCount} 项修改，恢复到应用前状态。
          {clarificationCount > 0 && <span> · {clarificationCount} 项仍待确认</span>}
        </span>
      );
    }
    if (applying) {
      return (
        <span className="mr-auto text-[10px] text-sandrift">正在应用…</span>
      );
    }
    return (
      <span className="mr-auto text-[10px] text-sandrift">
        {pendingOnly
          ? "不会写入任何修改"
          : hasPending
            ? "待确认或暂不支持的内容不会随本次修改写入。"
            : "未写入任何修改"}
      </span>
    );
  };

  /** V1.2.1：统一「继续处理 N 项」按钮（防双击；发送期间 disabled + 文案切换） */
  const renderContinueButton = (primary: boolean) => {
    if (clarificationCount === 0) return null;
    return (
      <button
        onClick={handleContinuePending}
        disabled={continuing}
        data-testid="visual-continue"
        className={
          primary
            ? "flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black disabled:opacity-60 transition-colors"
            : "flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint disabled:opacity-60 transition-colors"
        }
      >
        {continuing ? "正在继续…" : `继续处理 ${clarificationCount} 项`}
      </button>
    );
  };

  const renderActions = () => {
    // V1.4：由 Runtime status 驱动（remount 后 applied/revoked/stale 仍正确）
    if (runtimeState?.status === "applied") {
      return (
        <>
          <button
            onClick={handleUndo}
            data-testid="visual-undo"
            className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors"
          >
            撤销
          </button>
          {renderContinueButton(true)}
        </>
      );
    }
    if (runtimeState?.status === "stale") {
      return (
        <>
          {executableCount > 0 && (
            <button
              onClick={handleReanalyze}
              data-testid="visual-reanalyze"
              className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors"
            >
              重新分析
            </button>
          )}
          {renderContinueButton(true)}
        </>
      );
    }
    if (runtimeState?.status === "revoked") {
      // V1.2：revoked 后仍可继续 pending（澄清与 Undo 互不耦合）
      return renderContinueButton(false);
    }
    // idle（runtime undefined / applying transient）
    if (pendingOnly) {
      if (clarificationCount > 0) {
        return (
          <>
            <button
              onClick={() => setDismissed(true)}
              data-testid="visual-cancel"
              className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-satin-grey bg-transparent border border-line hover:text-charcoal hover:border-line-strong transition-colors"
            >
              取消
            </button>
            {renderContinueButton(true)}
          </>
        );
      }
      // unsupported-only：无 Apply、无继续处理
      return (
        <button
          onClick={() => setDismissed(true)}
          data-testid="visual-close"
          className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-satin-grey bg-transparent border border-line hover:text-charcoal hover:border-line-strong transition-colors"
        >
          关闭
        </button>
      );
    }
    return (
      <>
        <button
          onClick={() => setDismissed(true)}
          disabled={applying}
          data-testid="visual-cancel"
          className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-satin-grey bg-transparent border border-line hover:text-charcoal hover:border-line-strong transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          取消
        </button>
        <button
          onClick={handleApply}
          disabled={applying}
          data-testid="visual-apply"
          className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black disabled:opacity-60 transition-colors"
        >
          {applying ? "正在应用…" : hasPending ? `应用 ${executableCount} 项修改` : "应用全部修改"}
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
          {headerText()}
          <span className="text-[10px] font-semibold text-sandrift">
            {headerSub() ? ` · ${headerSub()}` : ""}
          </span>
        </p>
        <button
          onClick={() => setDismissed(true)}
          aria-label="关闭"
          disabled={applying}
          className="p-1 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* V1.2 Section：可应用修改（真实 Preflight Facts） */}
      {executableCount > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-sandrift mb-1">可应用修改 · {executableCount}</p>
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
        </div>
      )}

      {/* V1.2 Section：需要确认（ambiguous-entity / missing-information；warm neutral，不是 danger） */}
      {clarificationCount > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-sandrift mb-1">需要确认 · {clarificationCount}</p>
          <div className="divide-y divide-line-soft">
            {clarificationItems.map((p) => renderPendingRow(p))}
          </div>
        </div>
      )}

      {/* V1.2 Section：暂无法处理（unsupported-action；capability limit，不是系统异常） */}
      {unsupportedCount > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-sandrift mb-1">暂无法处理 · {unsupportedCount}</p>
          <div className="divide-y divide-line-soft">
            {proposal.pendingItems
              .filter((p) => p.reason === "unsupported-action")
              .map((p) => renderPendingRow(p))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1 border-t border-line-soft">
        {renderStatus()}
        {renderActions()}
      </div>
    </div>
  );
}
