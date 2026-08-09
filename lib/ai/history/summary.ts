/**
 * Kiro Conversation Summary —— 客户端紧凑调用与增量策略。
 * Summary 是内部 Model Context（不进入 UI / Share / Export）。
 */

import { KiroConversationSummary } from "@/lib/ai/history/types";
import { getSessionApiKey } from "@/lib/ai/sessionKeys";

export interface CompactRequestInput {
  provider: string;
  model: string;
  customConfig?: unknown;
  /** 已摘要到的消息（增量：旧 summary + 其后消息） */
  oldSummary?: KiroConversationSummary | null;
  /** 需要纳入摘要的消息（文本视图，按序，带 id 用于 throughMessageId） */
  messages: { id: string; role: "user" | "assistant"; content: string }[];
}

export interface CompactResponse {
  summary: KiroConversationSummary;
}

/** 调用 /api/ai/compact（无 tools 的纯摘要请求）；失败返回 null（不阻塞聊天） */
export async function requestConversationCompact(input: CompactRequestInput): Promise<KiroConversationSummary | null> {
  try {
    const res = await fetch("/api/ai/compact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: input.provider,
        model: input.model,
        apiKey: getSessionApiKey(input.provider as never),
        customConfig: input.customConfig,
        oldSummary: input.oldSummary ?? undefined,
        messages: input.messages,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as CompactResponse;
    if (!data?.summary || typeof data.summary.text !== "string" || data.summary.text.length === 0) return null;
    return data.summary;
  } catch {
    return null;
  }
}

/** 文本视图消息 → compact 负载（不含 tool JSON / 附件正文） */
export function toCompactMessages(
  messages: { id: string; role: "user" | "assistant"; content: string }[]
): { id: string; role: "user" | "assistant"; content: string }[] {
  return messages.filter((m) => m.content.length > 0);
}
