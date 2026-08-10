/**
 * Task 7A：Conversation Lifecycle 播种（纯函数 seam）。
 * sendWithTurn（KiroSessionProvider）是 History 生命周期的唯一入口：
 * 首条 User Message 创建 conversationId / title / createdAt，后续持久化依赖该 ID。
 * 抽取为纯函数：Provider 使用 + 回归测试共用，避免为单测引入 React harness。
 */

import { buildAutoTitle } from "@/lib/ai/history/sanitize";

export interface ConversationSeedHolder {
  id: string | null;
  title: string | null;
  createdAt: string | null;
}

export interface ConversationSeed {
  id: string;
  title: string;
  createdAt: string;
}

export function buildConversationSeed(
  text: string,
  deps?: { now?: () => Date; randomId?: () => string }
): ConversationSeed {
  const now = deps?.now ?? (() => new Date());
  const randomId =
    deps?.randomId ??
    (() =>
      globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : `conv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);
  return {
    id: randomId(),
    title: buildAutoTitle(text),
    createdAt: now().toISOString(),
  };
}

/**
 * 首条 User Message 播种：已有 conversationId 则幂等跳过（不重建标题/时间）。
 * 返回是否本次创建。New Chat 后 holder 重置 → 下一会话获得全新 ID。
 */
export function ensureConversationSeed(
  holder: ConversationSeedHolder,
  text: string,
  deps?: { now?: () => Date; randomId?: () => string }
): boolean {
  if (holder.id) return false;
  const seed = buildConversationSeed(text, deps);
  holder.id = seed.id;
  holder.title = seed.title;
  holder.createdAt = seed.createdAt;
  return true;
}
