/**
 * Kiro 历史本地搜索（P1 发现体验）：
 * - 此前只搜标题（首条用户消息前 30 字），记得内容搜不到；
 * - 本模块：标题 + 摘要 + 前 N 条消息正文（有界扫描，长对话不全扫）；
 * - 纯函数、无 IO；搜索不进入模型 Context。
 */
import type { KiroConversationRecord } from "@/lib/ai/history/types";

/** 内容扫描上限（消息条数 × 单条字符数；超出截断，避免长对话每键全扫） */
const SEARCH_MAX_MESSAGES = 8;
const SEARCH_MAX_CHARS_PER_MESSAGE = 2000;

export type ThreadMatchKind = "title" | "summary" | "content";

/** 命中摘要（含类型 +  excerpt 片段；标题命中无 excerpt） */
export interface ThreadMatch {
  kind: ThreadMatchKind;
  excerpt?: string;
}

function excerptAround(text: string, index: number, queryLen: number): string {
  const start = Math.max(0, index - 20);
  const end = Math.min(text.length, index + queryLen + 20);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

/** 单条对话是否命中；返回命中类型（标题优先，其次摘要，最后正文） */
export function matchConversation(thread: KiroConversationRecord, rawQuery: string): ThreadMatch | null {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return null;
  if (thread.title.toLowerCase().includes(q)) return { kind: "title" };
  const summaryText = thread.summary?.text ?? "";
  if (summaryText) {
    const idx = summaryText.toLowerCase().indexOf(q);
    if (idx >= 0) return { kind: "summary", excerpt: excerptAround(summaryText, idx, q.length) };
  }
  const messages = thread.messages ?? [];
  const scanned = Math.min(messages.length, SEARCH_MAX_MESSAGES);
  for (let i = 0; i < scanned; i++) {
    const content = (messages[i]?.content ?? "").slice(0, SEARCH_MAX_CHARS_PER_MESSAGE);
    if (!content) continue;
    const idx = content.toLowerCase().indexOf(q);
    if (idx >= 0) {
      return {
        kind: "content",
        excerpt: `${messages[i].role === "user" ? "你：" : "Kiro："}${excerptAround(content, idx, q.length)}`,
      };
    }
  }
  return null;
}

/** 批量过滤（保持原顺序；调用方自行截断并提示） */
export function filterConversations(
  threads: KiroConversationRecord[],
  rawQuery: string
): { thread: KiroConversationRecord; match: ThreadMatch }[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return [];
  const out: { thread: KiroConversationRecord; match: ThreadMatch }[] = [];
  for (const thread of threads) {
    const match = matchConversation(thread, q);
    if (match) out.push({ thread, match });
  }
  return out;
}

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 最近列表按“今天 / 昨天 / 更早”分组（调用方已排好序；分组内保持原序） */
export function groupThreadsByRecency(
  threads: KiroConversationRecord[]
): { label: string; items: KiroConversationRecord[] }[] {
  const today = startOfLocalDay(new Date());
  const groups: { label: string; items: KiroConversationRecord[] }[] = [
    { label: "今天", items: [] },
    { label: "昨天", items: [] },
    { label: "更早", items: [] },
  ];
  for (const thread of threads) {
    const t = new Date(thread.updatedAt).getTime();
    if (Number.isNaN(t)) {
      groups[2].items.push(thread);
      continue;
    }
    const day = startOfLocalDay(new Date(t));
    const diffDays = Math.round((today - day) / 86_400_000);
    if (diffDays <= 0) groups[0].items.push(thread);
    else if (diffDays === 1) groups[1].items.push(thread);
    else groups[2].items.push(thread);
  }
  return groups.filter((g) => g.items.length > 0);
}
