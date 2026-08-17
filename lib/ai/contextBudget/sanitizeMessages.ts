/**
 * Model Messages Sanitization（Task 7）：
 *  - 当前 Active Turn（最后一条 user 起）：完整保留（text / tool call / tool output / image）
 *  - Recent Completed Turns（默认最近 6 个完整 Turn）：只保留 user text + assistant final text（移除 Tool JSON / 图片）
 *  - 更早 Turn：由 Conversation Summary 代表（这里直接丢弃，不插入假消息）
 * UI History / IndexedDB 不受影响（这是 Model Context 专用视图）。
 */

import { KiroPlannableMessage, KiroTurn } from "@/lib/ai/contextBudget/types";

/** 按 user message 切分语义 Turn */
export function segmentTurns(messages: KiroPlannableMessage[]): KiroTurn[] {
  const turns: KiroTurn[] = [];
  let start = -1;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "user") {
      if (start !== -1) turns.push({ startIndex: start, endIndex: i - 1, userMessageId: messages[start].id });
      start = i;
    }
  }
  if (start !== -1) turns.push({ startIndex: start, endIndex: messages.length - 1, userMessageId: messages[start].id });
  return turns;
}

export interface MessagePlanResult {
  messages: KiroPlannableMessage[];
  summarizedMessages: number;
  recentTurns: number;
}

function keepTextOnly(m: KiroPlannableMessage): KiroPlannableMessage {
  return {
    id: m.id,
    role: m.role,
    parts: m.parts
      .filter((p) => p.type === "text" && typeof p.text === "string")
      .map((p) => ({ type: "text", text: p.text })),
  };
}

/**
 * 规划 Model Messages：
 * 完整保留当前 Turn；最近 N 个已完成 Turn 保留文本（去 Tool JSON / 图片）；更早丢弃。
 */
export function sanitizeMessagesForModel(
  messages: KiroPlannableMessage[],
  maxRecentTurns = 6
): MessagePlanResult {
  if (messages.length === 0) return { messages: [], summarizedMessages: 0, recentTurns: 0 };
  const turns = segmentTurns(messages);
  if (turns.length === 0) {
    // 无 user 消息（纯系统/助手残留）：全部丢弃
    return { messages: [], summarizedMessages: messages.length, recentTurns: 0 };
  }

  const current = turns[turns.length - 1];
  const completed = turns.slice(0, -1);
  const recent = completed.slice(-Math.max(maxRecentTurns, 1));

  const planned: KiroPlannableMessage[] = [];
  let summarized = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const isCurrent = i >= current.startIndex;
    const isRecent = recent.some((t) => i >= t.startIndex && i <= t.endIndex);
    if (isCurrent) {
      planned.push(m); // 当前 Turn：完整保留（Tool Loop 不能破坏）
    } else if (isRecent) {
      planned.push(keepTextOnly(m)); // 最近 Turn：只保留文本
    } else {
      summarized++;
    }
  }

  return { messages: planned, summarizedMessages: summarized, recentTurns: recent.length + 1 };
}
