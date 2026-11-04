/**
 * Kiro Search / Deep Research 共享结果处理（纯函数）：
 * - query 归一化（重复查询守卫）
 * - 跨查询 canonical URL 去重 + domain diversity + 上限
 */

import { KiroWebSearchResult, MAX_WEB_RESULTS, MAX_WEB_RESULTS_PER_DOMAIN } from "@/lib/ai/web/types";
import { canonicalWebSearchUrl } from "@/lib/ai/web/tavily";

/** 重复查询检测用归一化（trim / collapse whitespace / lowercase Latin；不做分词/stemming） */
export function normalizeWebSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Post-processing pipeline（Task 15B，纯函数）：
 * provider 结果 → 跨搜索 canonical URL 去重 → domain diversity（无 includeDomains 时每域 ≤2）→ 上限。
 * 保持 Provider relevance 顺序；diversity 只是 skip 超出 domain cap 的后续结果。
 */
export function filterWebSearchResults(input: {
  results: KiroWebSearchResult[];
  seenCanonicalUrls: string[];
  includeDomains?: string[];
  /** 本次最多保留多少条（默认 MAX_WEB_RESULTS；Deep Research 按 query 收紧） */
  maxResults?: number;
  /** 共享域名计数（Deep Research 跨 query 保持单域多样性；缺省则本次独立计数） */
  perDomainCounts?: Map<string, number>;
}): { results: KiroWebSearchResult[]; duplicatesFiltered: number } {
  const seen = new Set(input.seenCanonicalUrls);
  const perDomain = input.perDomainCounts ?? new Map<string, number>();
  const kept: KiroWebSearchResult[] = [];
  const maxResults = input.maxResults ?? MAX_WEB_RESULTS;
  let duplicatesFiltered = 0;
  const diversityEnabled = !(input.includeDomains && input.includeDomains.length > 0);

  for (const r of input.results) {
    if (kept.length >= maxResults) break;
    const canonical = canonicalWebSearchUrl(r.url);
    if (!canonical || seen.has(canonical)) {
      duplicatesFiltered += 1;
      continue;
    }
    seen.add(canonical);
    if (diversityEnabled) {
      const n = perDomain.get(r.domain) ?? 0;
      if (n >= MAX_WEB_RESULTS_PER_DOMAIN) continue; // 多样性跳过（非重复，不计数）
      perDomain.set(r.domain, n + 1);
    }
    kept.push(r);
  }
  return { results: kept, duplicatesFiltered };
}
