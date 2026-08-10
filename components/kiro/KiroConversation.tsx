"use client";

import React, { useEffect, useRef, useState } from "react";
import { KiroMessage, KiroUserMessage } from "@/components/kiro/KiroMessage";
import { KiroActivityTrace } from "@/components/kiro/KiroActivityTrace";
import { KiroChatMessageView, KiroActivity } from "@/hooks/useKiroChat";
import { KiroSourceMeta } from "@/lib/ai/citations/types";
import { useKiroSessionMeta } from "@/components/kiro/KiroSessionProvider";
import { AIError, AI_ERROR_MESSAGES } from "@/lib/ai/errors";
import { KiroActionCard, actionToCardProps, KiroActionCardVariant } from "@/components/kiro/KiroActionCard";
import { StudyPlanProposalCard } from "@/components/kiro/StudyPlanProposalCard";
import { actionSummaryText } from "@/lib/ai/share";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import { cn } from "@/lib/utils";
import { RotateCcw, Settings, ChevronDown } from "lucide-react";

/**
 * Conversation 布局：max-width 820px 居中，纵向文档流。
 * Assistant Message 分层：Markdown 回答 → Activity Trace → Action Result Cards（事实 UI）。
 */
export function KiroConversation({
  messages,
  activity,
  error,
  onRetry,
  onOpenSettings,
  onUndo,
  compact,
  turnInFlight,
  sources,
}: {
  messages: KiroChatMessageView[];
  activity: KiroActivity;
  error: AIError | null;
  onRetry: () => void;
  onOpenSettings: () => void;
  onUndo: (toolCallId: string) => void;
  /** sidecar：统一 12px 水平 gutter（与 Header/Composer 一致） */
  compact?: boolean;
  /** 整个 Agent Turn 是否仍在进行（chat.status === submitted/streaming）——决定最后一条消息的操作栏时机 */
  turnInFlight: boolean;
  /** 当前 Turn 的文档来源（Citation 渲染；live 消息用；不含正文） */
  sources?: KiroSourceMeta[];
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const [showScrollBtn, setShowScrollBtn] = React.useState(false);
  const { conversationSummary } = useKiroSessionMeta();

  // 尾部信号（Task 13）：不再为滚动构建整段 messages.map(...).join() key；
  // 只跟随会真正改变滚动高度的尾部状态
  const tail = messages[messages.length - 1];
  const scrollSignal = [
    messages.length,
    tail?.id,
    tail?.content.length ?? 0,
    tail?.actions?.length ?? 0,
    activity.phase,
    activity.steps.length,
  ].join("|");

  // 最后一条 assistant 消息：其操作栏必须等整个 Turn 结束（turnInFlight false）才显示；
  // 历史 assistant 消息不受当前 Turn 影响
  let lastAssistantIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      lastAssistantIndex = i;
      break;
    }
  }

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    const shouldShow = el.scrollHeight - el.scrollTop - el.clientHeight > 160;
    setShowScrollBtn((prev) => (prev === shouldShow ? prev : shouldShow));
  };

  // 自动滚动（Task 13）：rAF 合并同一帧内的多次更新，避免每个 token 直接写 scrollTop
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
    });
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [scrollSignal]);

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = true;
    const reduced = document.documentElement.dataset.motion === "reduced";
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
    setShowScrollBtn(false);
  };

  // Agent Progress 淡出：文本开始流式后（activity 隐藏）200ms fade，避免硬消失跳动
  const [agentLeaving, setAgentLeaving] = React.useState(false);
  useEffect(() => {
    if (activity.visible) {
      setAgentLeaving(false);
      return;
    }
    setAgentLeaving(true);
    const t = setTimeout(() => setAgentLeaving(false), 200);
    return () => clearTimeout(t);
  }, [activity.visible]);
  const showAgentProgress = activity.visible || agentLeaving;

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      data-testid="kiro-conversation"
      className="relative flex-1 min-h-0 overflow-y-auto"
    >
      {/* 用户上滑离开底部时：轻量「回到底部」浮钮（不遮挡 Composer） */}
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
      <div className={cn("max-w-[820px] mx-auto space-y-5 py-3", compact ? "px-3" : "px-1")}>
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
          />
        ))}

        {/* Agent 执行反馈（真实阶段 + 语义步骤；文本开始后淡出，有工具时保留完成摘要） */}
        {showAgentProgress && (
          <div
            className={cn(
              "transition-opacity duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
              agentLeaving && "opacity-0"
            )}
          >
            <KiroActivityTrace steps={activity.steps} phase={activity.phase} done={activity.done} compact={compact} />
          </div>
        )}

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
}: {
  view: KiroChatMessageView;
  actionsReady: boolean;
  sources?: KiroSourceMeta[];
  onUndo: (toolCallId: string) => void;
  onRetry: () => void;
}) {
  if (view.role === "user") {
    return <KiroUserMessage content={view.content} attachments={view.attachments} />;
  }
  // 空 assistant（pre-response 占位）：Logo 由 Agent Progress 承担，不渲染第二个 Logo；
  // 首个文本 token 到达后 KiroMessage 自然出现（同一 Turn 只保留一个 Kiro Logo）
  if (!view.content && !view.actions?.length && !view.historyActions?.length) return null;

  // actionSummaries 随 view 稳定（Message View 缓存保证 identity）
  const actionSummaries = React.useMemo(
    () => [
      ...(view.actions ?? []).map((a) => actionSummaryText(actionToCardProps(a.action))),
      ...(view.historyActions ?? []).map((a) => actionSummaryText(a as Parameters<typeof actionSummaryText>[0])),
    ],
    [view]
  );

  return (
    <KiroMessage
      content={view.content}
      streaming={view.streaming}
      canRegenerate={view.canRegenerate}
      actionsReady={actionsReady}
      sources={view.sources ?? sources}
      actionSummaries={actionSummaries}
      onRetry={onRetry}
    >
      {/* Action Result Cards：真实 ToolResult 事实 UI */}
      {view.actions && view.actions.length > 0 && (
        <div className="space-y-2.5 pt-1">
          {view.actions.map((a) => (
            <KiroActionCard
              key={a.toolCallId}
              {...actionToCardProps(a.action)}
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
    </KiroMessage>
  );
});
