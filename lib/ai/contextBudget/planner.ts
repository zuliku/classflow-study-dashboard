/**
 * Model Context Planner（Task 7 核心）：
 * Full Conversation → UI / History（完整）→ Planner → LLM。
 * 优先级：System Prompt > Base Context > Explicit Refs > Current Turn > Active Tool Loop
 *          > Recent Turns > Older Summary > 旧低价值内容。
 */

import {
  KiroContextBudget,
  KiroContextBudgetReport,
  KiroPlannableMessage,
} from "@/lib/ai/contextBudget/types";
import { estimateTokens } from "@/lib/ai/contextBudget/estimate";
import { sanitizeMessagesForModel } from "@/lib/ai/contextBudget/sanitizeMessages";
import { budgetAttachments, BudgetableAttachment } from "@/lib/ai/contextBudget/attachmentBudget";

export const DEFAULT_CONTEXT_BUDGET: KiroContextBudget = {
  maxInputTokens: 24_000,
  reserveOutputTokens: 2_048,
  summaryBudgetTokens: 2_000,
  recentMessagesBudgetTokens: 12_000,
  attachmentBudgetTokens: 6_000,
};

export interface KiroModelContextPlan {
  messages: KiroPlannableMessage[];
  attachmentContext: BudgetableAttachment[];
  budgetReport: KiroContextBudgetReport;
}

export interface BuildKiroModelContextInput {
  messages: KiroPlannableMessage[];
  summaryText?: string;
  attachments?: BudgetableAttachment[];
  budget?: KiroContextBudget;
  /** true：更激进的回退（Summary + 最近 3 Turn + 降低附件预算） */
  aggressive?: boolean;
  maxRecentTurns?: number;
}

function estimateMessagesTokens(messages: KiroPlannableMessage[]): number {
  let total = 0;
  for (const m of messages) {
    for (const p of m.parts) {
      if (typeof p.text === "string") total += estimateTokens(p.text);
      else total += estimateTokens(JSON.stringify(p).slice(0, 4000));
    }
  }
  return total;
}

export function buildKiroModelContext(input: BuildKiroModelContextInput): KiroModelContextPlan {
  const budget = input.budget ?? DEFAULT_CONTEXT_BUDGET;
  const aggressive = !!input.aggressive;
  const maxRecentTurns = input.maxRecentTurns ?? (aggressive ? 3 : 6);

  // 附件预算（aggressive 时减半）
  const attachmentBudgetTokens = aggressive
    ? Math.floor(budget.attachmentBudgetTokens * 0.5)
    : budget.attachmentBudgetTokens;
  const attResult = budgetAttachments(input.attachments ?? [], attachmentBudgetTokens);

  // 消息规划：summary 作为首条 system 消息插入
  const msgResult = sanitizeMessagesForModel(input.messages ?? [], maxRecentTurns);
  const planned: KiroPlannableMessage[] = [];
  if (input.summaryText) {
    planned.push({
      id: "summary",
      role: "system",
      parts: [{ type: "text", text: input.summaryText }],
    });
  }
  planned.push(...msgResult.messages);

  const estimatedTokens =
    estimateMessagesTokens(planned) +
    attResult.attachments.reduce((s, a) => s + estimateTokens(a.text), 0) +
    estimateTokens(input.summaryText ?? "");

  return {
    messages: planned,
    attachmentContext: attResult.attachments,
    budgetReport: {
      estimatedTokens,
      summarizedMessages: msgResult.summarizedMessages,
      recentTurns: msgResult.recentTurns,
      attachmentsTruncated: attResult.truncated,
    },
  };
}

/** 是否触发 compaction（估算达到预算的 70–80%） */
export function shouldCompact(estimatedTokens: number, budget: KiroContextBudget): boolean {
  return estimatedTokens >= budget.maxInputTokens * 0.75;
}
