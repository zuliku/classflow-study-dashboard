"use client";

import { useCallback, useMemo, useRef } from "react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { useChat, UIMessage } from "@ai-sdk/react";
import { useAppStore } from "@/store/useAppStore";
import { useAISettingsStore } from "@/store/useAISettingsStore";
import { getSessionApiKey } from "@/lib/ai/sessionKeys";
import { normalizeAIError, AIError } from "@/lib/ai/errors";
import { buildBaseContext } from "@/lib/ai/context/buildBaseContext";
import { buildAutoContextRefs, resolveContextRefs, refsForPrompt } from "@/lib/ai/context/contextSelection";
import { KiroContextRef } from "@/lib/ai/context/types";
import { executeKiroReadTool, MAX_READ_TOOL_CALLS_PER_TURN, ReadToolResult } from "@/lib/ai/tools/read/executor";
import { toolLabel } from "@/lib/ai/tools/read/formatters";

/** 统一 Message 视图模型：UI 组件只消费它，不依赖 Provider 原始结构 */
export interface KiroChatMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming: boolean;
}

/** Activity Trace 视图模型（真实 Read Tool 调用，用户语义标签） */
export interface KiroActivityStep {
  label: string;
  status: "working" | "done" | "error";
  message?: string;
}

export interface KiroActivity {
  visible: boolean;
  steps: KiroActivityStep[];
  /** 全部完成 → collapsed 摘要「读取 N 项」；有进行中 → working */
  done: boolean;
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

interface ToolCallPart {
  type: string; // `tool-${toolName}`（客户端序列化格式）
  toolCallId: string;
  state?: "streaming" | "output-available" | "output-error";
  errorText?: string;
  input?: unknown;
}

type UIMessagePart = NonNullable<UIMessage["parts"]>[number];
// 工具输出 envelope 的宽松类型（code 含循环保护专用码）
type ToolOutput = { ok: boolean; code?: string; message?: string; data?: unknown; candidates?: { id: string; label: string }[] };

/** 从 UI tool part 提取工具名（type 前缀 `tool-`） */
function toolNameOf(part: ToolCallPart): string {
  return part.type.startsWith("tool-") ? part.type.slice("tool-".length) : part.type;
}

/** 从最新 assistant 消息推导本轮真实工具调用（只显示用户语义标签） */
function deriveActivity(messages: UIMessage[], status: string): KiroActivity {
  // 从后往前找最后一个含 tool part 的 assistant 消息（覆盖多轮 client tool loop）
  let target: UIMessage | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    if ((m.parts ?? []).some((p) => p.type === "tool-call" || (typeof p.type === "string" && p.type.startsWith("tool-")))) {
      target = m;
      break;
    }
    if ((m.parts ?? []).some((p) => p.type === "text")) break;
  }
  if (!target) return { visible: false, steps: [], done: true };

  const parts = ((target.parts ?? []).filter(
    (p) => typeof p.type === "string" && p.type.startsWith("tool-")
  ) as unknown) as ToolCallPart[];
  const steps: KiroActivityStep[] = parts.map((p) => {
    if (p.state === "output-available") return { label: toolLabel(toolNameOf(p)), status: "done" };
    if (p.state === "output-error") return { label: toolLabel(toolNameOf(p)), status: "error", message: p.errorText };
    return { label: toolLabel(toolNameOf(p)), status: "working" };
  });
  const streaming = status === "streaming" || status === "submitted";
  const done = steps.every((s) => s.status === "done") && !streaming;
  return { visible: steps.length > 0, steps, done };
}

/**
 * Kiro Chat runtime（Task 2）：client-side Read Tools。
 * LLM → Tool Call → Client Executor（最新 Store）→ addToolOutput → 自动继续。
 * 无写权限：Executor 只读；本 hook 不含任何 store mutation。
 */
export function useKiroChat({
  manualRefs,
  suppressedAutoKeys,
}: {
  manualRefs: KiroContextRef[];
  suppressedAutoKeys: string[];
}) {
  const enabled = useAISettingsStore((s) => s.enabled);
  const provider = useAISettingsStore((s) => s.provider);
  const model = useAISettingsStore((s) => s.model);
  const custom = useAISettingsStore((s) => s.custom);

  // 每轮请求体：Base Context + 显式 Context 引用（每次渲染刷新为最新 Store 状态）
  const bodyRef = useRef<Record<string, unknown>>({});
  bodyRef.current = {
    provider,
    model,
    apiKey: getSessionApiKey(provider),
    customConfig: custom,
    baseContext: buildBaseContext(),
    contextRefs: refsForPrompt(
      resolveContextRefs(buildAutoContextRefs(), manualRefs, suppressedAutoKeys)
    ),
  };

  const turnCounterRef = useRef(0);
  const limitReachedRef = useRef(false);

  const chat = useChat({
    transport: new DefaultChatTransport({
      api: "/api/ai/chat",
      body: bodyRef.current,
    }),
    onError: () => {
      // error 状态由 useChat 内部维护；归一化在下方派生
    },
    onToolCall: ({ toolCall }) => {
      const { toolName, toolCallId, input } = toolCall as {
        toolName: string;
        toolCallId: string;
        input: unknown;
      };
      // 循环保护：每用户回合最多 MAX_READ_TOOL_CALLS_PER_TURN 次读取
      turnCounterRef.current += 1;
      if (turnCounterRef.current > MAX_READ_TOOL_CALLS_PER_TURN) {
        limitReachedRef.current = true;
        chat.addToolOutput({
          tool: toolName as never,
          toolCallId,
          output: {
            ok: false,
            code: "READ_TOOL_LIMIT_REACHED",
            message: "已达到本轮读取上限，请换个问法。",
          } as unknown as ReadToolResult<unknown>,
          options: { body: bodyRef.current },
        });
        return;
      }
      // 每次执行读取最新 Store（Data Freshness：聊天期间修改的任务下次读取立即可见）
      const result = executeKiroReadTool(toolName, input, useAppStore.getState());
      // 官方建议不在 onToolCall 内 await addToolOutput —— 直接调用，不阻塞流
      chat.addToolOutput({
        tool: toolName as never,
        toolCallId,
        output: result as ToolOutput,
        options: { body: bodyRef.current },
      });
    },
    sendAutomaticallyWhen: ({ messages }) =>
      !limitReachedRef.current && lastAssistantMessageIsCompleteWithToolCalls({ messages }),
  });

  const send = useCallback(
    (text: string) => {
      const v = text.trim();
      if (!v || !enabled) return;
      turnCounterRef.current = 0;
      limitReachedRef.current = false;
      void chat.sendMessage({ text: v }, { body: bodyRef.current });
    },
    [chat, enabled]
  );

  const retry = useCallback(() => {
    if (!enabled) return;
    turnCounterRef.current = 0;
    limitReachedRef.current = false;
    void chat.regenerate({ body: bodyRef.current });
  }, [chat, enabled]);

  const newChat = useCallback(() => {
    chat.setMessages([]);
    turnCounterRef.current = 0;
    limitReachedRef.current = false;
  }, [chat]);

  const normalizedError: AIError | null = chat.error ? normalizeAIError(chat.error) : null;
  const streaming = chat.status === "streaming" || chat.status === "submitted";
  const activity = useMemo(
    () => deriveActivity(chat.messages, chat.status),
    [chat.messages, chat.status]
  );

  return {
    messages: chat.messages.map(toView),
    status: chat.status,
    streaming,
    error: normalizedError,
    activity,
    send,
    retry,
    stop: chat.stop,
    newChat,
    configured: enabled,
  };
}
