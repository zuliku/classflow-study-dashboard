"use client";

import React, { useEffect, useRef, useState } from "react";
import { KiroMessage, KiroUserMessage } from "@/components/kiro/KiroMessage";
import { KiroPendingIndicator } from "@/components/kiro/KiroWorklog";
import { KiroAssistantShell } from "@/components/kiro/KiroAssistantShell";
import { Loader2, RotateCcw, Settings, ChevronDown } from "lucide-react";
import { KiroChatMessageView } from "@/hooks/useKiroChat";
import { KiroSourceMeta } from "@/lib/ai/citations/types";
import { useKiroSessionMeta } from "@/components/kiro/KiroSessionProvider";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import { AIError, AI_ERROR_MESSAGES } from "@/lib/ai/errors";
import { KiroActionCard, actionToCardProps, KiroActionCardVariant } from "@/components/kiro/KiroActionCard";
import { KiroAgentTaskCard } from "@/components/kiro/computer/KiroAgentTaskCard";
import { StudyPlanProposalCard } from "@/components/kiro/StudyPlanProposalCard";
import { StudyRebalanceProposalCard } from "@/components/kiro/StudyRebalanceProposalCard";
import { TaskBreakdownProposalCard } from "@/components/kiro/TaskBreakdownProposalCard";
import { VisualActionProposalCard } from "@/components/kiro/VisualActionProposalCard";
import { VisualActionProposalHistoryCard } from "@/components/kiro/VisualActionProposalHistoryCard";
import { actionSummaryText } from "@/lib/ai/share";
import { cn } from "@/lib/utils";
import { useEnterOnAdd } from "@/lib/useEnterOnAdd";
import { bumpStreamPerf } from "@/lib/ai/perf/streamPerf";

/**
 * Conversation 布局：max-width 820px 居中，纵向文档流。
 * Assistant Message 分层：Worklog → Final Answer → Action Result Cards（事实 UI）。
 * 滚动（Task 5）：单一 ResizeObserver + 单一 rAF scheduler，统一 reconcile 高度。
 */
export function KiroConversation({
  messages,
  error,
  onRetry,
  onOpenSettings,
  onUndo,
  onEditUserMessage,
  compact,
  turnInFlight,
  sources,
  onReviewComputerTask,
  onUndoComputerTask,
}: {
  messages: KiroChatMessageView[];
  error: AIError | null;
  onRetry: () => void;
  onOpenSettings: () => void;
  onUndo: (toolCallId: string) => void;
  /** Task 8：编辑 User Message 并重发（Task 7 的安全语义） */
  onEditUserMessage: (messageId: string, text: string) => Promise<boolean>;
  /** sidecar：统一 12px 水平 gutter（与 Header/Composer 一致） */
  compact?: boolean;
  /** 整个 Agent Turn 是否仍在进行（turnExecution !== settled；含 awaiting-tool-result / awaiting-continuation）——决定最后一条消息的操作栏时机 */
  turnInFlight: boolean;
  /** 当前 Turn 的文档来源（Citation 渲染；live 消息用；不含正文） */
  sources?: KiroSourceMeta[];
  /** Computer Agent Part 3：Task 更改审查 / 撤销（仅 live task 提供） */
  onReviewComputerTask?: (taskId: string) => void;
  onUndoComputerTask?: (taskId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const [showScrollBtn, setShowScrollBtn] = React.useState(false);
  const { conversationSummary, currentConversationId } = useKiroSessionMeta();
  const reducedMotion = useEffectiveReducedMotion();
  const messageIds = React.useMemo(
    () =>
      messages
        .filter((message) => isVisibleConversationMessage(message) && !message.restored)
        .map((message) => message.id),
    [messages]
  );
  const conversationScrollKey = currentConversationId ?? messages[0]?.id ?? "new";
  // V4.6：live transcript 不使用 message-level entrance 动画（真实事件到达即展示）——
  // enteringMessageIds 已移除；useEnterOnAdd 仍被 KiroActionCard 使用（其它 UI 列表保留）。

  // 最后一条 assistant 消息：其操作栏必须等整个 Turn 结束（turnInFlight false）才显示；
  // 历史 assistant 消息不受当前 Turn 影响
  let lastAssistantIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      lastAssistantIndex = i;
      break;
    }
  }

  /** 统一滚动状态同步（scroll 事件 / 内容高度变化共用） */
  const syncScrollState = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < 80;
    const shouldShow = distance > 160;
    setShowScrollBtn((prev) => (prev === shouldShow ? prev : shouldShow));
  }, []);

  const onScroll = () => {
    syncScrollState();
  };

  // 单一 rAF scheduler（Task 5）：高度变化只在同一帧合并一次 reconcile；
  // sticky 跟随使用直接 scrollTop 赋值（不做 smooth，避免抖动 / scroll queue）；
  // 只有确实存在距离差（>2px tolerance）时才赋值，避免无意义重复写 scrollTop
  const rafRef = useRef<number | null>(null);
  const scheduleHeightReconcile = React.useCallback(() => {
    bumpStreamPerf("resizeObserverCalls");
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = scrollRef.current;
      if (!el) return;
      if (stickToBottomRef.current) {
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distance > 2) {
          bumpStreamPerf("scrollTopWrites");
          el.scrollTop = el.scrollHeight;
        }
      }
      syncScrollState();
    });
  }, [syncScrollState]);

  // 内容高度变化（streaming / Worklog / Action / Proposal / Breakdown Card 增长）：
  // 唯一 reconcile 入口（Task 5：不再有第二套 scrollSignal 驱动路径）
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => scheduleHeightReconcile());
    observer.observe(content);
    return () => {
      observer.disconnect();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [scheduleHeightReconcile]);

  // 切换会话 / 首次挂载：重置滚动状态（历史会话默认看到最新消息；新会话不继承旧状态）
  const prevConversationKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = conversationScrollKey;
    if (prevConversationKeyRef.current === null) {
      prevConversationKeyRef.current = key;
      const el = scrollRef.current;
      if (el) {
        bumpStreamPerf("scrollTopWrites");
        el.scrollTop = el.scrollHeight;
      }
      return;
    }
    if (prevConversationKeyRef.current !== key) {
      prevConversationKeyRef.current = key;
      stickToBottomRef.current = true;
      setShowScrollBtn(false);
      const raf = requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (el) {
          bumpStreamPerf("scrollTopWrites");
          el.scrollTop = el.scrollHeight;
        }
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [conversationScrollKey]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = true;
    // 用户手动点击：允许 smooth；streaming 自动跟随仍用直接赋值
    el.scrollTo({ top: el.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
    setShowScrollBtn(false);
  };

  // 首 token 前占位：turn in-flight 且当前没有任何可见 Assistant（content / worklog / action / computer task）。
  // V4.6：空 assistant message 存在时由同一 message id 的 row 承担 pending shell（outer 不 remount）；
  // fallback Pending 只在「尚无 assistant message」时显示（避免双 Logo）。
  const lastMsg = messages[messages.length - 1];
  const showPending = turnInFlight && lastMsg?.role !== "assistant";

  return (
    // Outer Viewport Wrapper：负责浮层定位；Scroll Container 独立承担滚动（Task 6B-A）
    <div data-testid="kiro-conversation" className="relative flex-1 min-h-0">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto"
        // overflow-anchor: none —— 受控 reconcile 与 Browser scroll anchoring 不打架
        style={{ overflowAnchor: "none" }}
      >
        <div ref={contentRef} className={cn("max-w-[820px] mx-auto py-3 pb-12", compact ? "px-3" : "px-1")}>
          <div key={conversationScrollKey} className="space-y-5 ux-fade">
            {/* 极轻提示：真正发生过旧对话压缩时（不显示 token 数字） */}
            {conversationSummary && (
              <div className="flex justify-center">
                <span
                  title="Kiro 保留最近消息，并压缩较早内容以保持对话稳定。"
                  className="text-[10px] text-sandrift bg-[#F7F5F5] border border-line px-2 py-0.5 rounded-full"
                >
                  较早对话已压缩
                </span>
              </div>
            )}
            {messages.map((m, idx) => (
              <KiroConversationRow
                key={m.id}
                view={m}
                actionsReady={idx === lastAssistantIndex ? !turnInFlight : true}
                sources={idx === lastAssistantIndex ? sources : undefined}
                onUndo={onUndo}
                onRetry={onRetry}
                onEditUserMessage={onEditUserMessage}
                onReviewComputerTask={onReviewComputerTask}
                onUndoComputerTask={onUndoComputerTask}
              />
            ))}

            {/* 首 token 前：Kiro Logo + 正在处理（Assistant 任一可见 part 出现后自动消失） */}
            {showPending && <KiroPendingIndicator />}

            {error && (
              <div
                data-testid="kiro-error"
                className="rounded-2xl bg-danger-bg border border-danger-border p-3.5 space-y-2"
              >
                <p className="text-xs font-bold text-danger">Kiro 暂时没有完成回复</p>
                <p className="text-[11px] text-satin-grey leading-relaxed">
                  {error.message || AI_ERROR_MESSAGES[error.code]}
                </p>
                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    onClick={onRetry}
                    className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    重试
                  </button>
                  <button
                    onClick={onOpenSettings}
                    className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-semibold text-satin-grey bg-surface border border-line hover:text-charcoal hover:border-line-strong transition-colors"
                  >
                    <Settings className="w-3.5 h-3.5" />
                    打开设置
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 用户上滑离开底部时：轻量「回到底部」浮钮（锚定 Conversation 可见区底部，不随消息滚动） */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          aria-label="回到底部"
          title="回到底部"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-surface border border-line shadow-subtle flex items-center justify-center text-sandrift hover:text-charcoal hover:border-line-strong transition-colors z-10"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

/**
 * 单条消息行（Task 13）：React.memo。
 * view 依赖 Message View 缓存（identity 稳定）→ streaming 时历史行不重渲染；
 * actionsReady/sources 对历史行是稳定原语；最后一行收到真实变化值。
 */
const KiroConversationRow = React.memo(function KiroConversationRow({
  view,
  actionsReady,
  sources,
  onUndo,
  onRetry,
  onEditUserMessage,
  onReviewComputerTask,
  onUndoComputerTask,
}: {
  view: KiroChatMessageView;
  actionsReady: boolean;
  sources?: KiroSourceMeta[];
  onUndo: (toolCallId: string) => void;
  onRetry: () => void;
  onEditUserMessage: (messageId: string, text: string) => Promise<boolean>;
  onReviewComputerTask?: (taskId: string) => void;
  onUndoComputerTask?: (taskId: string) => void;
}) {
  // Hooks 必须在 assistant 占位由空变为可见内容前后保持同一顺序。
  const actionSummaries = React.useMemo(
    () => [
      ...(view.actions ?? []).map((a) => actionSummaryText(actionToCardProps(a.action))),
      ...(view.historyActions ?? []).map((a) => actionSummaryText(a as Parameters<typeof actionSummaryText>[0])),
    ],
    [view]
  );
  const actionIds = React.useMemo(
    () => (view.actions ?? []).map((action) => action.toolCallId),
    [view.actions]
  );
  const enteringActionIds = useEnterOnAdd(actionIds);

  if (view.role === "user") {
    return (
      // V4.6：live transcript 不使用 message-level animate-enter（事件到达即展示）
      <div>
        <KiroUserMessage
          messageId={view.id}
          content={view.content}
          attachments={view.attachments}
          canEdit={view.canEdit}
          editDisabledReason={view.editDisabledReason}
          onEdit={onEditUserMessage}
        />
      </div>
    );
  }
  // 空 assistant（pre-response 占位）：同一 message id 的 shell 先显示「正在准备」，
  // 之后 worklog/content 到达只替换 body——outer shell（KiroMark + 左侧 column）不 remount。
  // 只要存在任一可见内容（final answer / worklog / action / computer task）就渲染消息行。
  const hasWorklog = (view.assistantTurn?.worklog.length ?? 0) > 0;
  const hasComputerTask = Boolean(view.computerTask || view.historyComputerTask);
  if (
    !view.content &&
    !hasWorklog &&
    !view.actions?.length &&
    !view.historyActions?.length &&
    !hasComputerTask
  ) {
    return (
      <KiroAssistantShell testid="kiro-assistant-pending" messageId={view.id}>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-charcoal">正在准备</span>
          <Loader2 className="w-3.5 h-3.5 animate-spin text-sandrift shrink-0" aria-hidden="true" />
        </div>
      </KiroAssistantShell>
    );
  }

  return (
    // V4.6：live transcript 不使用 message-level animate-enter（事件到达即展示）
    <div>
      <KiroMessage
        messageId={view.id}
        content={view.content}
        streaming={view.streaming}
        canRegenerate={view.canRegenerate}
        actionsReady={actionsReady}
        sources={view.sources ?? sources}
        actionSummaries={actionSummaries}
        assistantTurn={view.assistantTurn}
        onRetry={onRetry}
      >
        {/* Action Result Cards：真实 ToolResult 事实 UI */}
        {view.actions && view.actions.length > 0 && (
          <div className="space-y-2.5 pt-1">
            {view.actions.map((a) => (
              <KiroActionCard
                key={a.toolCallId}
                {...actionToCardProps(a.action)}
                entering={enteringActionIds.has(a.toolCallId)}
                onUndo={a.action.canUndo ? () => onUndo(a.toolCallId) : undefined}
              />
            ))}
          </div>
        )}
        {/* 历史恢复的 Action Cards：纯展示事实（canUndo 恒 false） */}
        {view.historyActions && view.historyActions.length > 0 && (
          <div className="space-y-2.5 pt-1">
            {view.historyActions.map((a) => (
              <KiroActionCard
                key={a.toolCallId}
                variant={a.variant as KiroActionCardVariant}
                heading={a.heading}
                title={a.title}
                change={a.change ?? undefined}
                bullets={a.bullets}
                footer={a.footer}
                details={a.details}
              />
            ))}
          </div>
        )}
        {/* Study Plan Proposal Card（真实 ToolResult 事实 UI；仅 live 轮次，历史恢复不渲染） */}
        {view.proposals && view.proposals.length > 0 && !view.streaming && (
          <StudyPlanProposalCard proposals={view.proposals} />
        )}
        {/* Study Rebalance Proposal Card（Part 5；真实 ToolResult 事实 UI；仅 live 轮次） */}
        {view.rebalanceProposals && view.rebalanceProposals.length > 0 && !view.streaming && (
          <StudyRebalanceProposalCard proposals={view.rebalanceProposals} />
        )}
        {/* Task Breakdown Proposal Card（真实 ToolResult 事实 UI；仅 live 轮次） */}
        {view.breakdowns && view.breakdowns.length > 0 && !view.streaming && (
          <TaskBreakdownProposalCard proposals={view.breakdowns} />
        )}
        {/* Visual Action Intake Proposal Card（真实 ToolResult 事实 UI；仅 live Proposal） */}
        {view.visualActionProposals && view.visualActionProposals.length > 0 && !view.streaming && (
          <div className="space-y-2.5 pt-1">
            {view.visualActionProposals.map((p) => (
              <VisualActionProposalCard key={p.id} proposal={p} />
            ))}
          </div>
        )}
        {/* Visual Intake V1.3：历史只读 Proposal 快照（display-only；绝不交叉到 live Card） */}
        {view.historyVisualActionProposals && view.historyVisualActionProposals.length > 0 && (
          <div className="space-y-2.5 pt-1">
            {view.historyVisualActionProposals.map((p) => (
              <VisualActionProposalHistoryCard key={p.id} proposal={p} />
            ))}
          </div>
        )}
        {/* Computer Agent Task Card（Part 3）：绑定 owning assistant message；历史 → display-only */}
        {hasComputerTask && (
          <div className="pt-1">
            <KiroAgentTaskCard
              task={view.computerTask}
              historyTask={view.historyComputerTask}
              onReview={onReviewComputerTask}
              onUndo={onUndoComputerTask}
            />
          </div>
        )}
      </KiroMessage>
    </div>
  );
});

function isVisibleConversationMessage(message: KiroChatMessageView): boolean {
  if (message.role === "user") return true;
  return Boolean(
    message.content ||
      message.assistantTurn?.worklog.length ||
      message.actions?.length ||
      message.historyActions?.length ||
      message.computerTask ||
      message.historyComputerTask
  );
}
