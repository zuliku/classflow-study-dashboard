/**
 * Kiro Search — web_search Tool Schema（Task 14A）。
 * Agent 只能控制 query / topic / timeRange / includeDomains；
 * 不允许控制 search_depth / max_results / include_answer / include_raw_content / API Key。
 */

import { z } from "zod";

export const WEB_SEARCH_QUERY_MIN = 2;
export const WEB_SEARCH_QUERY_MAX = 300;
export const WEB_SEARCH_MAX_INCLUDE_DOMAINS = 5;

/** 基本 domain 归一（strip scheme / path / query，小写） */
export function normalizeWebSearchDomain(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    const noSlash = trimmed.split(/[/?#]/)[0] ?? "";
    return noSlash.replace(/^www\./, "");
  }
}

export const kiroWebSearchInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(WEB_SEARCH_QUERY_MIN, `搜索关键词至少 ${WEB_SEARCH_QUERY_MIN} 个字符`)
    .max(WEB_SEARCH_QUERY_MAX, `搜索关键词过长（最多 ${WEB_SEARCH_QUERY_MAX} 字符）`),
  topic: z.enum(["general", "news"]).optional(),
  timeRange: z.enum(["day", "week", "month", "year"]).optional(),
  includeDomains: z
    .array(z.string().trim().min(1).max(200))
    .max(WEB_SEARCH_MAX_INCLUDE_DOMAINS, `最多 ${WEB_SEARCH_MAX_INCLUDE_DOMAINS} 个域名`)
    .optional(),
});
