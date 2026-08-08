"use client";

import React, { useEffect, useRef } from "react";
import { KiroMessage, KiroUserMessage } from "@/components/kiro/KiroMessage";

export interface KiroChatMessage {
  id: string;
  role: "user" | "kiro";
  content: string;
}

/**
 * Conversation 布局：max-width 820px 居中，纵向文档流。
 * 不写成纯 Text Bubble List —— 内容区可承载长回答、卡片、tool traces 等结构化内容。
 * 自身内部滚动；不依赖页面宽度（未来 Sidecar / 窄屏直接复用）。
 */
export function KiroConversation({ messages }: { messages: KiroChatMessage[] }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 新消息到达时滚动到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div ref={scrollRef} data-testid="kiro-conversation" className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-[820px] mx-auto space-y-5 px-1 py-3">
        {messages.map((m) =>
          m.role === "user" ? (
            <KiroUserMessage key={m.id} content={m.content} />
          ) : (
            <KiroMessage key={m.id} content={m.content} />
          )
        )}
      </div>
    </div>
  );
}
