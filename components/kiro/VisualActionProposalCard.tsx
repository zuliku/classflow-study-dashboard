"use client";

import React, { useMemo, useRef, useState } from "react";
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
  X,
} from "lucide-react";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import { useToastStore } from "@/store/useToastStore";
import { executeVisualActionProposal } from "@/lib/ai/visual/executor";
import { buildVisualPendingContinuation } from "@/lib/ai/visual/continuation";
import { resolveLiveImageSources } from "@/lib/ai/attachments/liveImageRegistry";
import { KiroImagePreviewDialog } from "@/components/kiro/KiroImagePreviewDialog";
import {
  VisualActionKind,
  VisualActionProposal,
  VisualPendingItem,
  VisualProposalAction,
} from "@/lib/ai/visual/types";
import { cn } from "@/lib/utils";

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
 * Visual Action Intake V1.5 Proposal Card（Reviewable Screenshot Actions）：
 * - 操作预览（主身份）+ 来源缩略图 Source Strip（live File；runtime-only）+ 数量副行
 * - Selective Apply：逐行 Checkbox（本地 UI 状态，不写回 Proposal domain）+ 全选/取消全选
 * - 临时/永久 badge 由 display.kind + change.input.week 确定性生成（模型无任何字段可改）
 * - Apply 永远走 buildVisualProposalExecutionPlan（FULL stale 不可绕过；subset 语义校验）
 * - Applied 后行级「已应用 / 未应用」标记；顶部 X 隐藏（避免误读为取消执行）
 * 所有 count 从 proposal 数据推导；Pending 永远不可选择。
 */
export function VisualActionProposalCard({
  proposal,
  sourceAttachments,
}: {
  proposal: VisualActionProposal;
  /** V1.5：Conversation 层解析的 live 来源（runtime File）；缺省时 Card 自行解析（同样 runtime-only） */
  sourceAttachments?: ReturnType<typeof resolveLiveImageSources>;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [expandedEvidence, setExpandedEvidence] = useState<string | null>(null);
  // V1.5：Selective Apply —— 选择状态只属于 UI（绝不写回 Proposal / 持久化）；初始全选
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(proposal.actions.map((a) => a.id))
  );
  // V1.5.1：Preview 是 Source Gallery（多来源核对）；index = 用户点击的缩略图
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
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

  // V1.5：来源解析在 Conversation/Session 层完成（sourceAttachments prop）；
  // 独立渲染（unit test / 退化场景）时走同一 runtime-only resolver，绝不扫描全局 Store
  const resolvedSources = useMemo(
    () => sourceAttachments ?? resolveLiveImageSources(proposal.sourceAttachmentIds),
    [sourceAttachments, proposal.sourceAttachmentIds]
  );
  const previewableCount = resolvedSources.length;

  // V1.5：选择状态（UI-only）
  const selectedCount = selectedIds.size;
  const allSelected = executableCount > 0 && selectedCount === executableCount;
  const idleSelectable = runtimeState == null && !applying && !pendingOnly;
  const showSelectAll = idleSelectable && executableCount >= 3;
  const appliedIndexes =
    (runtimeState?.status === "applied" || runtimeState?.status === "revoked")
      ? runtimeState.appliedActionIndexes
      : undefined;
  const appliedIdSet = useMemo(
    () =>
      appliedIndexes
        ? new Set(appliedIndexes.map((i) => proposal.actions[i]?.id).filter(Boolean))
        : null, // null = 当时全部应用
    [appliedIndexes, proposal.actions]
  );

  if (dismissed) return null;

  const handleApply = async () => {
    if (applyingRef.current) return;
    const selectedActionIds = proposal.actions
      .filter((a) => selectedIds.has(a.id))
      .map((a) => a.id);
    if (selectedActionIds.length === 0) return; // disabled 已阻止；防御
    applyingRef.current = true;
    setApplying(true);
    try {
      const result = await executeVisualActionProposal({ proposal, selectedActionIds, pushToast });
      if (result.ok) {
        // V1.4/V1.5：execution capability 交给 Conversation Runtime（undo closure 只活在 runtime；
        // appliedActionIndexes 投影为行级「已应用/未应用」展示事实）
        visualProposalRuntime.recordApplied({
          proposalId: proposal.id,
          count: result.count,
          appliedActionIndexes: result.appliedActionIndexes,
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
      // 其他失败（commit 异常已回滚 / 依赖语义变化等）：保持可重试，错误由 toast 说明
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

  /** V1.2/V1.2.1：继续处理 pending —— 结构化 continuation + 正常用户 prompt（不重新送截图；不直接执行任何写操作）。 */
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

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setAllSelected = (all: boolean) => {
    setSelectedIds(new Set(all ? proposal.actions.map((a) => a.id) : []));
  };

  const openPreview = (index: number) => {
    setPreviewIndex(index);
  };

  /** V1.5：临时/永久 badge —— 只由 display.kind + 真实 week 确定性生成（模型无字段可改文案） */
  const badgeFor = (a: VisualProposalAction): { text: string; temporary: boolean } | null => {
    const kind = a.display.kind;
    if (kind === "schedule-cancel" || kind === "schedule-move" || kind === "schedule-extra") {
      const week = (a.change.input as { week?: unknown })?.week;
      if (typeof week === "number" && Number.isInteger(week) && week > 0) {
        return { text: `仅第 ${week} 周`, temporary: true };
      }
      return { text: "临时", temporary: true };
    }
    if (kind === "schedule-permanent-update") {
      return { text: "永久", temporary: false };
    }
    return null;
  };

  const headerSub = () => {
    const parts: string[] = [];
    if (executableCount > 0) parts.push(`${executableCount} 项可应用`);
    if (clarificationCount > 0) parts.push(`${clarificationCount} 项待确认`);
    if (unsupportedCount > 0) parts.push(`${unsupportedCount} 项暂无法处理`);
    return parts.join(" · ");
  };

  const headerSecondary = () => {
    if (pendingOnly) {
      return clarificationCount > 0
        ? `从截图发现 ${totalCount} 项需要确认`
        : `从截图发现 ${totalCount} 项当前暂无法处理`;
    }
    // V1.2.1：澄清链生成的 Proposal B 保留来源链（展示为「根据刚才的确认…」）
    if (proposal.continuationSource) {
      return `根据刚才的确认整理出 ${totalCount} 项`;
    }
    return `从 ${imageCount} 张截图整理出 ${totalCount} 项`;
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

  const renderExecutableRow = (a: VisualProposalAction) => {
    const meta = KIND_META[a.display.kind] ?? KIND_META["assignment-update"];
    const MetaIcon = meta.icon;
    const expanded = expandedEvidence === a.id;
    const badge = badgeFor(a);
    const checked = selectedIds.has(a.id);
    // V1.5：applied/revoked 后行级展示事实（appliedIndexes 缺省 = 全部应用；
    // revoked 后仍保留行级差异：当时应用的行显示「已撤销」，未选的行显示「未应用」）
    const hasRowFacts = runtimeState?.status === "applied" || runtimeState?.status === "revoked";
    const rowApplied = hasRowFacts && (appliedIdSet === null || appliedIdSet.has(a.id));
    const rowMarkerText = runtimeState?.status === "revoked" ? "已撤销" : "已应用";
    return (
      <div key={a.id} className="py-1.5 first:pt-0 last:pb-0">
        <div className="flex items-start gap-2">
          {/* Selection / 应用标记 slot：idle → Checkbox；applied/revoked → 行级事实；其余 → 占位 */}
          {hasRowFacts ? (
            <span className="mt-px w-5 h-5 shrink-0 flex items-center justify-center">
              {rowApplied ? (
                <Check className="w-3.5 h-3.5 text-[#627566]" />
              ) : (
                <Circle className="w-3 h-3 text-sandrift" />
              )}
            </span>
          ) : idleSelectable ? (
            <button
              type="button"
              role="checkbox"
              aria-checked={checked}
              aria-label={checked ? `取消选择 ${a.display.title}` : `选择 ${a.display.title}`}
              data-testid="visual-action-select"
              onClick={() => toggleSelected(a.id)}
              className={cn(
                "mt-px w-5 h-5 shrink-0 rounded-md border flex items-center justify-center transition-colors",
                checked
                  ? "bg-charcoal border-charcoal text-white"
                  : "bg-surface border-line-strong text-transparent hover:border-charcoal"
              )}
            >
              <Check className="w-3 h-3" />
            </button>
          ) : (
            <span className="mt-px w-5 h-5 shrink-0 rounded-md bg-alabaster border border-line-soft flex items-center justify-center">
              <MetaIcon className="w-3 h-3 text-sandrift" />
            </span>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 rounded-md bg-alabaster border border-line-soft flex items-center justify-center w-5 h-5">
                <MetaIcon className="w-3 h-3 text-sandrift" />
              </span>
              <p className="min-w-0 flex-1 text-[11px] font-semibold text-charcoal leading-snug truncate">
                {a.display.title}
              </p>
              {badge && (
                <span
                  data-testid="visual-scope-badge"
                  className={cn(
                    "shrink-0 inline-flex items-center px-1.5 h-4 rounded-md text-[9px] font-bold",
                    badge.temporary
                      ? "bg-pastel-mint/60 text-[#627566]"
                      : "bg-charcoal/5 text-charcoal border border-line"
                  )}
                >
                  {badge.text}
                </span>
              )}
              {hasRowFacts && (
                <span
                  data-testid="visual-row-applied"
                  className={cn(
                    "shrink-0 text-[9px] font-bold",
                    rowApplied ? "text-[#627566]" : "text-sandrift"
                  )}
                >
                  {rowApplied ? rowMarkerText : "未应用"}
                </span>
              )}
            </div>
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
              <div className="mt-1 flex flex-wrap items-center gap-2 bg-alabaster/60 border border-line-soft rounded-lg px-2 py-1.5">
                <p className="text-[10px] text-satin-grey leading-snug">“{a.evidence.text}”</p>
                {/* V1.5.1：来源唯一（1 张截图）时才显示行级「查看原图」——
                    多来源时 ClassFlow 不知道这条 Action 来自第几张图，
                    禁止默认打开 source[0]（错误归因）；改由顶部 Source Strip 浏览全部来源 */}
                {previewableCount === 1 && (
                  <button
                    type="button"
                    onClick={() => openPreview(0)}
                    className="text-[10px] font-semibold text-charcoal underline underline-offset-2 decoration-line-strong hover:text-black"
                  >
                    查看原图
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderStatus = () => {
    // V1.4：durable status 来自 Runtime（applied / revoked / stale）；applying 是 transient
    if (runtimeState?.status === "applied") {
      const appliedCount = appliedIdSet === null ? executableCount : appliedIdSet.size;
      const unselectedCount = executableCount - appliedCount;
      return (
        <span className="mr-auto flex items-center gap-1 text-[10px] font-semibold text-[#627566]">
          <Check className="w-3 h-3" />
          已应用 {appliedCount} 项修改
          {unselectedCount > 0 && <span className="text-sandrift">· {unselectedCount} 项未选择</span>}
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
      const appliedCount = appliedIdSet === null ? executableCount : appliedIdSet.size;
      const unselectedCount = executableCount - appliedCount;
      return (
        <span className="mr-auto text-[10px] font-semibold text-sandrift">
          已撤销 {runtimeState.count ?? executableCount} 项修改
          {unselectedCount > 0 && <span> · {unselectedCount} 项未应用</span>}
          {clarificationCount > 0 && <span> · {clarificationCount} 项仍待确认</span>}
        </span>
      );
    }
    if (applying) {
      return <span className="mr-auto text-[10px] text-sandrift">正在应用…</span>;
    }
    // V1.5：0 选择 → 明确引导（Pending 不计入 Apply count）
    if (executableCount > 0 && selectedCount === 0) {
      return <span className="mr-auto text-[10px] font-semibold text-sandrift">请选择至少一项要应用的修改</span>;
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

  const applyLabel = () => {
    if (applying) return "正在应用…";
    if (selectedCount < executableCount) return `应用 ${selectedCount} 项修改`;
    return "应用全部修改";
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
          disabled={applying || selectedCount === 0}
          data-testid="visual-apply"
          className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {applyLabel()}
        </button>
      </>
    );
  };

  return (
    <div
      data-testid="visual-action-proposal"
      className="mt-2.5 bg-surface border border-line-strong rounded-2xl shadow-card p-3.5 space-y-3 kiro-structure-settle"
    >
      {/* V1.5：操作预览 —— 主身份（来源/数量为 Secondary；不再与来源混成一句 AI 文本） */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-bold text-charcoal">
            <ImageIcon className="w-3.5 h-3.5 text-[#A48F82]" />
            操作预览
          </p>
          <p className="mt-0.5 text-[10px] font-semibold text-satin-grey leading-snug">
            {headerSecondary()}
            {headerSub() && <span className="text-sandrift"> · {headerSub()}</span>}
          </p>
          {/* V1.5 Source Strip：点击缩略图 → Source Gallery（多图核对）；来源缺失 → 纯文本降级（不报错） */}
          {imageCount > 0 && (
            <div data-testid="visual-proposal-source" className="mt-1.5 flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-sandrift">来源</span>
              {previewableCount > 0 ? (
                <>
                  {/* V1.5.1：展示全部来源（一 Turn ≤ 5 张）；移动端允许 wrap；绝不静默截断 */}
                  <div className="flex flex-wrap items-center gap-1">
                    {resolvedSources.map((s, i) => (
                      <button
                        key={s.id}
                        type="button"
                        data-testid="visual-source-thumb"
                        onClick={() => openPreview(i)}
                        aria-label={`查看原图 ${s.name}`}
                        title="查看原图"
                        className="w-7 h-7 rounded-lg border border-line-soft overflow-hidden focus:outline-none focus:ring-2 focus:ring-charcoal/20"
                      >
                        {s.thumbnail ? (
                          <img src={s.thumbnail} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="w-full h-full flex items-center justify-center bg-alabaster">
                            <ImageIcon className="w-3 h-3 text-sandrift" />
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    data-testid="visual-source-open"
                    onClick={() => openPreview(0)}
                    className="text-[10px] font-semibold text-sandrift hover:text-charcoal underline underline-offset-2 decoration-line-strong transition-colors"
                  >
                    查看原图
                  </button>
                </>
              ) : (
                <span className="text-[10px] text-satin-grey">· {imageCount} 张图片</span>
              )}
            </div>
          )}
        </div>
        {/* V1.5：applied/revoked 后去掉顶部 X（关闭只能隐藏 UI，不能暗示「取消执行」） */}
        {runtimeState?.status !== "applied" && runtimeState?.status !== "revoked" && (
          <button
            onClick={() => setDismissed(true)}
            aria-label="关闭"
            disabled={applying}
            className="p-1 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* V1.2 Section：可应用修改（真实 Preflight Facts）；V1.5：逐行选择 + 全选 */}
      {executableCount > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-semibold text-sandrift">可应用修改 · {executableCount}</p>
            {showSelectAll && (
              <button
                type="button"
                data-testid="visual-select-all"
                onClick={() => setAllSelected(!allSelected)}
                className="text-[10px] font-semibold text-sandrift hover:text-charcoal transition-colors"
              >
                {allSelected ? "取消全选" : "全选"}
              </button>
            )}
          </div>
          <div className="divide-y divide-line-soft">
            {proposal.actions.map((a) => renderExecutableRow(a))}
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

      {/* V1.5.1：Source Gallery（runtime File；Esc/Backdrop/Close 关闭；关闭时 revoke object URL；
          Gallery 只做来源核对，绝不声称某 Action 与某张图存在精确 mapping） */}
      {previewIndex !== null && resolvedSources.length > 0 && (
        <KiroImagePreviewDialog
          source={resolvedSources[Math.min(previewIndex, resolvedSources.length - 1)]}
          sources={resolvedSources}
          initialIndex={Math.min(previewIndex, resolvedSources.length - 1)}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </div>
  );
}
