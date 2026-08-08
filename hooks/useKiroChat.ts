"use client";

import { useCallback, useRef } from "react";
import { DefaultChatTransport } from "ai";
import { useChat, UIMessage } from "@ai-sdk/react";
import { useAISettingsStore } from "@/store/useAISettingsStore";
import { getSessionApiKey } from "@/lib/ai/sessionKeys";
import { normalizeAIError, AIError } from "@/lib/ai/errors";

/** 统一 Message 视图模型：UI 组件只消费它，不依赖 Provider 原始结构 */
export interface KiroChatMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming: boolean;
}

function toView(m: UIMessage): KiroChatMessageView {
  const content = (m.parts ?? [])
    .filter((p) => p.type === "text")
    .map((p) => (p as { type: "text"; text: string }).text)
    .join("");
  const streaming = (m.parts ?? []).some(
    (p) => p.type === "text" && (p as { state?: string }).state === "streaming"
  );
  return {
    id: m.id,
    role: m.role === "assistant" ? "assistant" : "user",
    content,
    streaming,
  };
}

/**
 * Kiro Chat runtime：基于 AI SDK useChat（state / transport），
 * 视觉仍使用 ClassFlow Kiro UI。消息不进入 useAppStore / 不做本地持久化。
 */
export function useKiroChat() {
  const enabled = useAISettingsStore((s) => s.enabled);
  const provider = useAISettingsStore((s) => s.provider);
  const model = useAISettingsStore((s) => s.model);
  const custom = useAISettingsStore((s) => s.custom);

  const chat = useChat({
    transport: new DefaultChatTransport({
      api: "/api/ai/chat",
      body: {
        provider,
        model,
        apiKey: getSessionApiKey(provider),
        customConfig: custom,
      },
    }),
    onError: () => {
      // error 状态由 useChat 内部维护，这里仅确保错误可被消费
    },
  });

  const lastUserRef = useRef<string>("");

  const send = useCallback(
    (text: string) => {
      const v = text.trim();
      if (!v || !enabled) return;
      lastUserRef.current = v;
      void chat.sendMessage({ text: v });
    },
    [chat, enabled]
  );

  const retry = useCallback(() => {
    if (!enabled) return;
    // 重新生成最后一条 assistant 回复（不重复追加用户消息）
    void chat.regenerate();
  }, [chat, enabled]);

  const newChat = useCallback(() => {
    chat.setMessages([]);
  }, [chat]);

  const normalizedError: AIError | null = chat.error ? normalizeAIError(chat.error) : null;
  const streaming = chat.status === "streaming" || chat.status === "submitted";

  return {
    messages: chat.messages.map(toView),
    status: chat.status,
    streaming,
    error: normalizedError,
    send,
    retry,
    stop: chat.stop,
    newChat,
    configured: enabled,
  };
}
