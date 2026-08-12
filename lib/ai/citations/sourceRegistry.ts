/**
 * Kiro Source Registry —— 不可变 enrichment（Task 19B1）。
 *
 * enrichWebSourcePages()：read_web_source 成功输出 availablePages → 只对已注册的
 * web source 做页码合并。规则：
 * - 绝不修改输入 array / 任何 KiroSourceMeta object（immutable）
 * - 无变化的 source 复用旧引用（structural sharing）
 * - 全部无变化 → 返回原 array（result === sources，调用方可直接 if (next === current) return）
 * - 页码只接受正整数，dedupe + sort ascending；空列表忽略
 * - 未知 sourceId / 非 web source 一律 ignore（不能创建新 Source）
 * - 幂等：已合并过的页码再次合并 → 同一引用
 *
 * 信任边界：enrichment 只来自真实 tool-read_web_source output（ok === true）的
 * data.sources[].availablePages；模型正文 / Citation marker 绝不能生成页码。
 */
import { KiroSourceMeta } from "@/lib/ai/citations/types";

export interface KiroWebPageEnrichment {
  sourceId: string;
  availablePages: number[];
}

/** 页码归一：只接受正整数 → dedupe → sort ascending */
export function normalizeAvailablePages(pages: readonly number[]): number[] {
  const set = new Set<number>();
  for (const p of pages) {
    if (Number.isInteger(p) && p > 0) set.add(p);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * 不可变 enrichment：对 sources 中已存在的 web source 合并 availablePages（union）。
 * 无实际变化 → 返回原数组引用。
 */
export function enrichWebSourcePages(
  sources: readonly KiroSourceMeta[],
  enrichments: readonly KiroWebPageEnrichment[]
): KiroSourceMeta[] {
  if (enrichments.length === 0) return sources as KiroSourceMeta[];

  // 同一 sourceId 的多次 enrichment 先合并归一（幂等性在 union 后自然成立）
  const incoming = new Map<string, number[]>();
  for (const e of enrichments) {
    const normalized = normalizeAvailablePages(e.availablePages);
    if (normalized.length === 0) continue;
    const existing = incoming.get(e.sourceId);
    incoming.set(e.sourceId, existing ? Array.from(new Set([...existing, ...normalized])).sort((a, b) => a - b) : normalized);
  }
  if (incoming.size === 0) return sources as KiroSourceMeta[];

  let changed = false;
  const next = sources.map((source) => {
    // 只允许已注册的 web source 获得页码（未知 sourceId / 非 web 一律 ignore）
    if (source.source !== "web") return source;
    const pages = incoming.get(source.sourceId);
    if (!pages || pages.length === 0) return source;
    const merged = Array.from(new Set([...(source.availablePages ?? []), ...pages])).sort((a, b) => a - b);
    if (merged.length === (source.availablePages?.length ?? 0) && merged.every((p, i) => p === source.availablePages![i])) {
      return source; // 无实际变化：复用引用（幂等）
    }
    changed = true;
    return { ...source, availablePages: merged };
  });

  return changed ? next : (sources as KiroSourceMeta[]);
}
