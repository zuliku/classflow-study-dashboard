"use client";

import React, { useEffect, useRef, useState } from "react";
import { KiroMessage, KiroUserMessage } from "@/components/kiro/KiroMessage";
import { KiroActivityTrace } from "@/components/kiro/KiroActivityTrace";
import { KiroChatMessageView, KiroActivity } from "@/hooks/useKiroChat";
import { AIError, AI_ERROR_MESSAGES } from "@/lib/ai/errors";
import { KiroActionCard, actionToCardProps, KiroActionCardVariant } from "@/components/kiro/KiroActionCard";
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
}: {
  messages: KiroChatMessageView[];
  activity: KiroActivity;
  error: AIError | null;
  onRetry: () => void;
  onOpenSettings: () => void;
  onUndo: (toolCallId: string) => void;
  /** sidecar：统一 12px 水平 gutter（与 Header/Composer 一致） */
  compact?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const [showScrollBtn, setShowScrollBtn] = React.useState(false);
  const { conversationSummary } = useKiroSession();
  const contentKey = messages.map((m) => `${m.id}:${m.content.length}:${m.streaming}`).join("|");

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    const shouldShow = el.scrollHeight - el.scrollTop - el.clientHeight > 160;
    setShowScrollBtn((prev) => (prev === shouldShow ? prev : shouldShow));
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [contentKey]);

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
        {messages.map((m) => {
          if (m.role === "user") {
            return <KiroUserMessage key={m.id} content={m.content} attachments={m.attachments} />;
          }
          // 空 assistant（pre-response 占位）：Logo 由 Agent Progress 承担，不渲染第二个 Logo；
          // 首个文本 token 到达后 KiroMessage 自然出现（同一 Turn 只保留一个 Kiro Logo）
          if (!m.content && !m.actions?.length && !m.historyActions?.length) return null;
          return (
            <KiroMessage
              key={m.id}
              content={m.content}
              streaming={m.streaming}
              canRegenerate={m.canRegenerate}
              actionSummaries={[
                ...(m.actions ?? []).map((a) => actionSummaryText(actionToCardProps(a.action))),
                ...(m.historyActions ?? []).map((a) => actionSummaryText(a as Parameters<typeof actionSummaryText>[0])),
              ]}
            >
              {/* Action Result Cards：真实 ToolResult 事实 UI */}
              {m.actions && m.actions.length > 0 && (
                <div className="space-y-2.5 pt-1">
                  {m.actions.map((a) => (
                    <KiroActionCard
                      key={a.toolCallId}
                      {...actionToCardProps(a.action)}
                      onUndo={a.action.canUndo ? () => onUndo(a.toolCallId) : undefined}
                    />
                  ))}
                </div>
              )}
              {/* 历史恢复的 Action Cards：纯展示事实（canUndo 恒 false） */}
              {m.historyActions && m.historyActions.length > 0 && (
                <div className="space-y-2.5 pt-1">
                  {m.historyActions.map((a) => (
                    <KiroActionCard
                      key={a.toolCallId}
                      variant={a.variant as KiroActionCardVariant}
                      heading={a.heading}
                      title={a.title}
                      change={a.change ?? undefined}
                      bullets={a.bullets}
                      footer={a.footer}
                    />
                  ))}
                </div>
              )}
            </KiroMessage>
          );
        })}

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
