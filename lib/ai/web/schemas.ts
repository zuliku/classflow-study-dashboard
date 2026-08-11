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
  excludeDomains: z
    .array(z.string().trim().min(1).max(200))
    .max(WEB_SEARCH_MAX_INCLUDE_DOMAINS, `最多 ${WEB_SEARCH_MAX_INCLUDE_DOMAINS} 个域名`)
    .optional(),
  /** 精确名称 / 短语搜索；true 时 query 必须包含引号短语（否则 planner 归一为 false） */
  exactMatch: z.boolean().optional(),
});

const QUOTED_PHRASE_RE = /["“”][^"“”]{2,}["“”"]/;

/**
 * exactMatch guard：exactMatch=true 时 query 必须至少包含一个引号包裹短语。
 * 不满足 → 返回 false（Provider 不应收到 exact_match=true）。
 * 支持 "phrase" 与 “中文短语”。
 */
export function resolveExactMatchFlag(query: string, exactMatch?: boolean): boolean {
  if (exactMatch !== true) return false;
  return QUOTED_PHRASE_RE.test(query);
}

/** Task 16A：read_web_source schema——只接受真实 Search Result 的 sourceIds，绝不接受任意 URL */
export const kiroWebReadSourceSchema = z.object({
  sourceIds: z
    .array(z.string().regex(/^web-\d+$/, "sourceId 必须是 web-N 形式"))
    .min(1, "至少选择一个网页来源")
    .max(2, "一次最多读取 2 个网页来源")
    .transform((arr) => Array.from(new Set(arr))), // 确定性去重：["web-3","web-3"] → ["web-3"]
  /** 「希望从这些网页中找什么」；可选 */
  query: z.string().trim().min(2).max(300).optional(),
});
