/**
 * 记忆重排（两阶段第二阶段；LLM 语义排序）。
 * - parseRerankOutput：模型输出 → 有序 id（纯函数；非法/未知 id/重复一律防御）。
 * - rerankMemories：调 server 路由做语义重排；任何失败 → null（调用方降级为召回序）。
 * - searchMemoriesTwoStage：完整两阶段编排（召回 → 条件重排 → 截断；纯编排，IO 经注入）。
 *
 * 约束：候选 ≤3 或无 query 或无模型信息 → 跳过重排（省一次模型调用，结果与召回一致）。
 */
import { KiroMemory, MemoryCategory, MemoryScope } from "@/lib/ai/memory/types";
import { recallMemoryCandidates, MEMORY_RECALL_CANDIDATE_LIMIT } from "@/lib/ai/memory/recall";

export interface RerankCandidateInput {
  id: string;
  title: string;
  content: string;
  category: string;
}

/** 重排输入上限（prompt 有界；content 本就 ≤500） */
export const MEMORY_RERANK_MAX_CANDIDATES = 10;
/** 候选数阈值：≤ 此数跳过重排（召回序已够用） */
export const MEMORY_RERANK_MIN_CANDIDATES = 4;

/** 内存缓存（query + 候选 id 快照 → 有序 id；上限 50 条目，FIFO 淘汰） */
const rerankCache = new Map<string, string[]>();
const RERANK_CACHE_MAX = 50;

export function rerankCacheKey(query: string, candidateIds: string[]): string {
  return `${query.trim().toLowerCase()}|${candidateIds.join(",")}`;
}

export function getRerankCacheSizeForTests(): number {
  return rerankCache.size;
}

export function clearRerankCacheForTests(): void {
  rerankCache.clear();
}

/**
 * 模型输出解析：提取 JSON 中的有序 id 数组。
 * 防御：非 JSON/非数组/空 → null；未知 id 忽略；重复去重；返回交集（保持模型序）。
 */
export function parseRerankOutput(text: string, candidateIds: string[]): string[] | null {
  const known = new Set(candidateIds);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const raw = jsonMatch ? jsonMatch[0] : text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
  const ids = (parsed as { orderedIds?: unknown })?.orderedIds;
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !known.has(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out.length > 0 ? out : null;
}

export type RerankRouteCaller = (input: {
  query: string;
  candidates: RerankCandidateInput[];
}) => Promise<{ orderedIds: string[] | null }>;

/** 默认路由调用（browser → server；失败一律 null，不抛） */
export async function defaultRerankRouteCaller(input: {
  query: string;
  candidates: RerankCandidateInput[];
  provider: string;
  model: string;
  apiKey?: string;
  customConfig?: unknown;
  invocationId?: string;
}): Promise<{ orderedIds: string[] | null }> {
  try {
    const { apiUrl } = await import("@/lib/desktop/apiBase");
    const res = await fetch(apiUrl("/api/ai/memory-rerank"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: input.query,
        candidates: input.candidates,
        provider: input.provider,
        model: input.model,
        ...(input.apiKey ? { apiKey: input.apiKey } : {}),
        ...(input.customConfig !== undefined ? { customConfig: input.customConfig } : {}),
        ...(input.invocationId ? { invocationId: input.invocationId } : {}),
      }),
    });
    if (!res.ok) return { orderedIds: null };
    const body = (await res.json()) as { orderedIds?: unknown };
    if (!Array.isArray(body.orderedIds)) return { orderedIds: null };
    return { orderedIds: body.orderedIds.filter((id): id is string => typeof id === "string") };
  } catch {
    return { orderedIds: null };
  }
}

export interface TwoStageSearchInput {
  query?: string;
  category?: MemoryCategory;
  scope?: MemoryScope;
  limit?: number;
  memories: KiroMemory[];
  /** 模型信息缺失（settings 未就绪）→ 跳过重排，只召回 */
  provider?: string;
  model?: string;
  apiKey?: string;
  customConfig?: unknown;
  invocationId?: string;
  /** 测试注入路由；默认走 server */
  routeCaller?: RerankRouteCaller;
}

/**
 * 两阶段搜索：召回（本地 OR）→ 条件重排（LLM）→ 截断。
 * - 召回上限 MEMORY_RECALL_CANDIDATE_LIMIT；重排输入再裁到 MEMORY_RERANK_MAX_CANDIDATES。
 * - 重排成功：模型序在前，未覆盖的候选按召回序补尾（fail-soft，绝不丢结果）。
 * - 重排失败/跳过：召回序；最终 slice 到 limit。
 */
export async function searchMemoriesTwoStage(input: TwoStageSearchInput): Promise<KiroMemory[]> {
  const limit = Math.min(Math.max(input.limit ?? 5, 1), MEMORY_RECALL_CANDIDATE_LIMIT);
  const recalled = recallMemoryCandidates(input.memories, {
    ...(input.query !== undefined ? { query: input.query } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.scope !== undefined ? { scope: input.scope } : {}),
    limit: MEMORY_RECALL_CANDIDATE_LIMIT,
  });
  const query = (input.query ?? "").trim();
  const needsRerank =
    query.length > 0 &&
    recalled.length >= MEMORY_RERANK_MIN_CANDIDATES &&
    !!input.provider &&
    !!input.model;
  if (!needsRerank) return recalled.slice(0, limit).map((c) => c.memory);

  const rerankInputs = recalled.slice(0, MEMORY_RERANK_MAX_CANDIDATES);
  const candidateIds = rerankInputs.map((c) => c.memory.id);
  const cacheKey = rerankCacheKey(query, candidateIds);
  let ordered: string[] | null = rerankCache.get(cacheKey) ?? null;
  if (!ordered) {
    const caller = input.routeCaller ?? ((args) =>
      defaultRerankRouteCaller({
        ...args,
        provider: input.provider!,
        model: input.model!,
        ...(input.apiKey ? { apiKey: input.apiKey } : {}),
        ...(input.customConfig !== undefined ? { customConfig: input.customConfig } : {}),
        ...(input.invocationId ? { invocationId: input.invocationId } : {}),
      }));
    try {
      const result = await caller({
        query,
        candidates: rerankInputs.map((c) => ({
          id: c.memory.id,
          title: c.memory.title,
          content: c.memory.content,
          category: c.memory.category,
        })),
      });
      ordered = result.orderedIds;
    } catch {
      ordered = null;
    }
    if (ordered) {
      rerankCache.set(cacheKey, ordered);
      if (rerankCache.size > RERANK_CACHE_MAX) {
        const oldest = rerankCache.keys().next().value;
        if (oldest !== undefined) rerankCache.delete(oldest);
      }
    }
  }
  // 路由返回的是 server 解析后的 id 列表；再经本地 parse 防御（未知 id 过滤 + 去重）
  const rankedIds = ordered ? parseRerankOutput(JSON.stringify({ orderedIds: ordered }), candidateIds) : null;
  const byId = new Map(rerankInputs.map((c) => [c.memory.id, c.memory]));
  const out: KiroMemory[] = [];
  if (rankedIds) {
    for (const id of rankedIds) {
      const m = byId.get(id);
      if (m) {
        out.push(m);
        byId.delete(id);
      }
    }
  }
  // 未覆盖的候选按召回序补尾
  for (const c of rerankInputs) {
    const m = byId.get(c.memory.id);
    if (m) out.push(m);
  }
  return out.slice(0, limit);
}
