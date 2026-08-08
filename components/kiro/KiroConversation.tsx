"use client";

import React, { useEffect, useRef } from "react";
import { KiroMessage, KiroUserMessage } from "@/components/kiro/KiroMessage";
import { KiroActivityTrace } from "@/components/kiro/KiroActivityTrace";
import { KiroChatMessageView, KiroActivity } from "@/hooks/useKiroChat";
import { AIError, AI_ERROR_MESSAGES } from "@/lib/ai/errors";
import { RotateCcw, Settings } from "lucide-react";

/**
 * Conversation 布局：max-width 820px 居中，纵向文档流。
 * 内部滚动；新内容时仅在用户位于底部时自动跟随。
 * 真实 Read Tool 调用通过 KiroActivityTrace 展示（用户语义标签，不展示 JSON）。
 */
export function KiroConversation({
  messages,
  activity,
  error,
  onRetry,
  onOpenSettings,
}: {
  messages: KiroChatMessageView[];
  activity: KiroActivity;
  error: AIError | null;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const contentKey = messages.map((m) => `${m.id}:${m.content.length}:${m.streaming}`).join("|");

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [contentKey]);

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      data-testid="kiro-conversation"
      className="flex-1 min-h-0 overflow-y-auto"
    >
      <div className="max-w-[820px] mx-auto space-y-5 px-1 py-3">
        {messages.map((m) =>
          m.role === "user" ? (
            <KiroUserMessage key={m.id} content={m.content} />
          ) : (
            <KiroMessage key={m.id} content={m.content} streaming={m.streaming} />
          )
        )}

        {/* 真实 Read Tool 活动轨迹（仅展示查看了哪些 ClassFlow 数据） */}
        {activity.visible && (
          <KiroActivityTrace steps={activity.steps} done={activity.done} mode="read" />
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
