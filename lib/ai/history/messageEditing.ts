/**
 * Task 7：Safe User Message Editing（纯 safety 层）。
 * 编辑语义：编辑目标 User Message → 删除它以及后面整个旧 suffix → 用修改后的文本重新发送。
 * 安全规则（全部在提交时重新校验，不能只信 UI）：
 * - streaming/submitted 中禁止
 * - 目标消息带附件禁止（V1 不重新获取原始 File）
 * - 目标之后整个 suffix 中任意 assistant 存在 mutating Tool Call 禁止（不能只查第一条）
 * - 历史恢复消息：仅当对应 restored actions 非空才视为 write suffix；纯文本历史允许编辑
 */

import { KIRO_MUTATING_TOOL_NAMES } from "@/lib/ai/tools/mutating";

export type UserMessageEditBlockReason =
  | "turn-in-flight"
  | "attachments"
  | "write-suffix"
  | "message-not-found";

/** 消息中是否存在会持久化 mutation 的 Tool Call（business write / change set / memory / focus） */
export function messageHasMutatingToolCalls(m: { parts?: unknown[] }): boolean {
  const parts = (m.parts ?? []) as { type?: string }[];
  return parts.some((p) => {
    if (typeof p.type !== "string" || !p.type.startsWith("tool-")) return false;
    const name = p.type.slice("tool-".length);
    return (KIRO_MUTATING_TOOL_NAMES as string[]).includes(name);
  });
}

export interface UserMessageEditCheckInput {
  /** 目标 user message；null = 未找到 */
  target: { text: string; hasAttachments: boolean } | null;
  /** 目标之后的整个 suffix 的 assistant messages */
  suffixAssistantMessages: { id: string; parts?: unknown[] }[];
  /** 目标之后的 restored assistant message ids（对应真实 persisted actions 非空） */
  restoredWriteMessageIds: string[];
  /** 当前 turn 是否 in-flight（submitted / streaming） */
  streaming: boolean;
}

/** 编辑安全判定：返回阻止原因（null = 允许编辑） */
export function getUserMessageEditBlockReason(
  input: UserMessageEditCheckInput
): UserMessageEditBlockReason | null {
  if (!input.target) return "message-not-found";
  if (input.streaming) return "turn-in-flight";
  if (input.target.hasAttachments) return "attachments";
  const restoredWrite = new Set(input.restoredWriteMessageIds);
  for (const m of input.suffixAssistantMessages) {
    if (messageHasMutatingToolCalls(m) || restoredWrite.has(m.id)) return "write-suffix";
  }
  return null;
}

/** 截断到目标 user message 之前（目标自己也删除，稍后由 revised message 重新发送）；找不到 → null */
export function truncateBeforeEditedUserMessage<T extends { id: string }>(
  messages: T[],
  messageId: string
): T[] | null {
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx === -1) return null;
  return messages.slice(0, idx);
}
