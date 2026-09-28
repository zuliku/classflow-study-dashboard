/**
 * 记忆召回（两阶段第一阶段；纯本地、零模型调用）。
 * searchMemoriesByKeyword 是 AND-substring 语义（调用方众多，保持不动）；
 * 本模块提供 OR 语义的候选召回：分词 OR 匹配 + 确定性打分，供 LLM 重排消费。
 *
 * 分词（中英混排）：
 * - 拉丁词（字母数字，长度 ≥2，小写）
 * - CJK bigram（滑动 2 字窗；单字噪声大，不用 unigram）
 * 打分 = 命中 token 数（bigram 与词等权 1）；排序：分数 DESC → 更新时间 DESC → id ASC。
 */
import { KiroMemory, MemoryCategory, MemoryScope, MAX_MEMORY_SEARCH_RESULTS } from "@/lib/ai/memory/types";

/** 最大召回候选数（重排输入上限；与 search 上限同源） */
export const MEMORY_RECALL_CANDIDATE_LIMIT = MAX_MEMORY_SEARCH_RESULTS;

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\ud840-\ud87f\udc00-\udfff]/;

export function tokenizeMemoryQuery(query: string): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  const push = (t: string) => {
    if (t && !seen.has(t)) {
      seen.add(t);
      tokens.push(t);
    }
  };
  // 拉丁词
  for (const w of query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2)) {
    push(w);
  }
  // CJK bigram（去空白后滑动）
  const compact = query.replace(/\s+/g, "");
  const chars = Array.from(compact);
  for (let i = 0; i + 1 < chars.length; i++) {
    const a = chars[i];
    const b = chars[i + 1];
    if (CJK_RE.test(a) && CJK_RE.test(b)) push(a + b);
  }
  return tokens;
}

function normalizeHaystack(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

export interface MemoryRecallCandidate {
  memory: KiroMemory;
  /** 命中 token 数（确定性分数；重排阶段不用，只做召回排序与可解释） */
  score: number;
}

export function recallMemoryCandidates(
  memories: KiroMemory[],
  opts: { query?: string; category?: MemoryCategory; scope?: MemoryScope; limit?: number }
): MemoryRecallCandidate[] {
  const limit = Math.min(Math.max(opts.limit ?? MEMORY_RECALL_CANDIDATE_LIMIT, 1), MEMORY_RECALL_CANDIDATE_LIMIT);
  const tokens = tokenizeMemoryQuery(opts.query ?? "");
  const scored: MemoryRecallCandidate[] = [];
  for (const m of memories) {
    if (opts.category && m.category !== opts.category) continue;
    if (opts.scope && m.scope !== opts.scope) continue;
    if (tokens.length === 0) {
      scored.push({ memory: m, score: 0 });
      continue;
    }
    const hay = normalizeHaystack(`${m.title} ${m.content} ${(m.tags ?? []).join(" ")}`);
    let score = 0;
    for (const t of tokens) {
      if (hay.includes(t)) score += 1;
    }
    if (score > 0) scored.push({ memory: m, score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // 更新时间 DESC（新在前）→ id ASC（确定性）
    if (a.memory.updatedAt !== b.memory.updatedAt) return a.memory.updatedAt < b.memory.updatedAt ? 1 : -1;
    return a.memory.id < b.memory.id ? -1 : 1;
  });
  return scored.slice(0, limit);
}
