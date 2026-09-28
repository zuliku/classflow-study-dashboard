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
import { isKiroFinalAnswerToolName } from "@/lib/ai/tools/finalAnswer";

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

/**
 * 空终答检测（fix：思考吃光配额 → finish=length → 工具成功但零正文）：
 * assistant 消息含 ≥1 个已结算的业务工具调用（终答边界信号除外）但正文为空。
 * 只看 parts 事实（streaming 中不判定，由调用方保证 settled 后再调）。
 */
export function messageNeedsAnswerRetry(m: { role?: string; parts?: unknown[] }): boolean {
  if (m.role !== "assistant") return false;
  const parts = (m.parts ?? []) as { type?: string; text?: string; state?: string }[];
  let hasSettledBusinessTool = false;
  let textLen = 0;
  for (const p of parts) {
    if (typeof p?.type !== "string") continue;
    if (p.type === "text") {
      textLen += p.text?.length ?? 0;
      continue;
    }
    if (!p.type.startsWith("tool-")) continue;
    if (isKiroFinalAnswerToolName(p.type.slice("tool-".length))) continue;
    // 已结算输出（output-available / output-error）才算；input 中不算（turn 未结束）
    if (p.state === "output-available" || p.state === "output-error") {
      hasSettledBusinessTool = true;
    }
  }
  return hasSettledBusinessTool && textLen === 0;
}

/**
 * Turn 工具范围（S-fix 历史可重试：落盘时由 live parts 一次性判定，恢复后不再可推导）。
 * - "none"：无任何 Tool Call（纯文本问答）—— 恢复后允许重新生成
 * - "readonly"：仅只读工具 —— 恢复后仍禁止（工具上下文已随 parts 丢弃，重生成会失据）
 * - "mutating"：含改写工具 —— 恢复后仍禁止（重执行会二次落盘）
 */
export type TurnToolScope = "none" | "readonly" | "mutating";

export function classifyTurnToolScope(parts?: unknown[]): TurnToolScope {
  const list = (parts ?? []) as { type?: string }[];
  const hasTools = list.some(
    (p) => typeof p.type === "string" && p.type.startsWith("tool-")
  );
  if (!hasTools) return "none";
  return messageHasMutatingToolCalls({ parts }) ? "mutating" : "readonly";
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

/**
 * S-fix 历史可重试：PersistedKiroMessage → 恢复用 UIMessage metadata（纯函数，可单测）。
 * 置于 safety 层（无运行时重依赖，避免 sanitize→hook 循环 import）：
 * - restored 标记 + 落盘 toolScope 透传（缺省 = 旧记录 = 未知 = 不可重生成）
 * - contextUsage 由调用方按既有归一化逻辑附加（本函数只管 toolScope 透传）
 */
export function buildRestoredMessageMetadata(pm: {
  toolScope?: "none" | "readonly" | "mutating";
}): Record<string, unknown> {
  const meta: Record<string, unknown> = { restored: "1" };
  if (pm.toolScope === "none" || pm.toolScope === "readonly" || pm.toolScope === "mutating") {
    meta.toolScope = pm.toolScope;
  }
  return meta;
}

/** 恢复消息是否明确记载为无工具轮（纯文本问答 → 允许重新生成；缺省/其他一律禁止） */
export function restoredMessageIsRegenerable(
  metadata: Record<string, unknown> | undefined
): boolean {
  return metadata?.toolScope === "none";
}
