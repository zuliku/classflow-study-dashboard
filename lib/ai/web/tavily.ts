/**
 * Kiro Search — Tavily V1 Adapter（Task 14A）。
 * 直接 fetch POST https://api.tavily.com/search（不安装 Tavily SDK）。
 * 只允许 Agent 控制 query / topic / timeRange / includeDomains；
 * search_depth / max_results / include_answer / include_raw_content / API Key 由 ClassFlow 决定。
 *
 * 归一化规则：
 * - URL 只允许 http/https，无法 parse → skip
 * - title trim；content → snippet（折叠空白，上限 900 chars）
 * - 最多 MAX_WEB_RESULTS 条
 * - 绝不返回 raw_content / answer / provider request id / API Key
 * - sourceId 由调用层分配（本 adapter 不生成 web-N）
 */

import {
  KiroWebSearchProviderId,
  KiroWebSearchRequest,
  KiroWebSearchResult,
  KiroWebSearchOutcome,
  KiroWebSearchErrorCode,
  MAX_WEB_RESULTS,
  WEB_SEARCH_SNIPPET_MAX_CHARS,
} from "@/lib/ai/web/types";
import { KiroWebSearchProvider } from "@/lib/ai/web/provider";

export const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
export const TAVILY_USAGE_URL = "https://api.tavily.com/usage";

const SAFE_ERROR_MESSAGES: Record<KiroWebSearchErrorCode, string> = {
  WEB_SEARCH_DISABLED: "Kiro Search 已关闭。",
  WEB_SEARCH_KEY_REQUIRED: "Kiro Search 尚未配置。",
  WEB_SEARCH_AUTH_FAILED: "搜索服务凭据无效。",
  WEB_SEARCH_RATE_LIMITED: "搜索请求过于频繁，请稍后再试。",
  WEB_SEARCH_TIMEOUT: "网络搜索超时，请重试。",
  WEB_SEARCH_FAILED: "网络搜索失败，请稍后再试。",
  WEB_SEARCH_LIMIT_REACHED: "本轮网络搜索次数已达上限。",
};

export function webSearchSafeMessage(code: KiroWebSearchErrorCode): string {
  return SAFE_ERROR_MESSAGES[code];
}

/** URL 安全校验 + domain 提取（http/https only） */
function parseUrl(raw: string): { url: string; domain: string } | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return { url: u.href, domain: u.hostname.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
]);

/**
 * canonical URL（Task 15A）：
 * - http/https only（非法 → null）
 * - hostname lowercase
 * - 移除 hash
 * - 移除常见 tracking 参数（utm_* / gclid / fbclid）
 * - 保留其余业务 query params（?id=1 与 ?id=2 视为不同 URL）
 */
export function canonicalWebSearchUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    const params = Array.from(u.searchParams.keys());
    for (const key of params) {
      if (TRACKING_PARAMS.has(key)) u.searchParams.delete(key);
    }
    u.search = u.searchParams.toString();
    return u.toString();
  } catch {
    return null;
  }
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeSnippet(content: string): string {
  const collapsed = collapseWhitespace(content);
  return collapsed.length > WEB_SEARCH_SNIPPET_MAX_CHARS
    ? collapsed.slice(0, WEB_SEARCH_SNIPPET_MAX_CHARS)
    : collapsed;
}

interface TavilyRawResult {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  score?: unknown;
  published_date?: unknown;
  publishedDate?: unknown;
}

function normalizeResults(raw: unknown): KiroWebSearchResult[] {
  if (!Array.isArray(raw)) return [];
  const out: KiroWebSearchResult[] = [];
  const seenCanonical = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_WEB_RESULTS) break;
    if (!item || typeof item !== "object") continue;
    const r = item as TavilyRawResult;
    if (typeof r.url !== "string") continue;
    const urlInfo = parseUrl(r.url);
    if (!urlInfo) continue;
    // 确定性 canonical URL 去重（tracking 参数差异不重复计数）
    const canonical = canonicalWebSearchUrl(r.url);
    if (!canonical || seenCanonical.has(canonical)) continue;
    seenCanonical.add(canonical);
    const title = typeof r.title === "string" ? r.title.trim() : "";
    if (!title && !r.content) continue;
    const publishedAt =
      typeof r.published_date === "string"
        ? r.published_date
        : typeof r.publishedDate === "string"
          ? r.publishedDate
          : undefined;
    out.push({
      sourceId: "",
      title,
      url: urlInfo.url,
      domain: urlInfo.domain,
      snippet: normalizeSnippet(typeof r.content === "string" ? r.content : ""),
      publishedAt,
      score: typeof r.score === "number" ? r.score : undefined,
    });
    if (out.length >= MAX_WEB_RESULTS) break;
  }
  return out;
}

export function createTavilyWebSearchProvider(): KiroWebSearchProvider {
  return {
    id: "tavily",
    async checkCredential({ apiKey, signal }) {
      if (!apiKey) {
        return { ok: false, code: "WEB_SEARCH_AUTH_FAILED", message: SAFE_ERROR_MESSAGES.WEB_SEARCH_AUTH_FAILED };
      }
      let response: Response;
      try {
        response = await fetch(TAVILY_USAGE_URL, {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
          signal,
        });
      } catch (err) {
        const aborted =
          signal?.aborted ||
          (err instanceof Error && (/abort/i.test(err.message) || err.name === "AbortError" || err.name === "TimeoutError"));
        if (aborted) {
          return { ok: false, code: "WEB_SEARCH_TIMEOUT", message: SAFE_ERROR_MESSAGES.WEB_SEARCH_TIMEOUT };
        }
        return { ok: false, code: "WEB_SEARCH_FAILED", message: SAFE_ERROR_MESSAGES.WEB_SEARCH_FAILED };
      }
      if (response.status === 401 || response.status === 403) {
        return { ok: false, code: "WEB_SEARCH_AUTH_FAILED", message: SAFE_ERROR_MESSAGES.WEB_SEARCH_AUTH_FAILED };
      }
      if (response.status === 429) {
        return { ok: false, code: "WEB_SEARCH_RATE_LIMITED", message: SAFE_ERROR_MESSAGES.WEB_SEARCH_RATE_LIMITED };
      }
      if (!response.ok) {
        return { ok: false, code: "WEB_SEARCH_FAILED", message: SAFE_ERROR_MESSAGES.WEB_SEARCH_FAILED };
      }
      // 200 → 凭据可用；不解析 / 不返回 usage body
      return { ok: true };
    },
    async search(request, { apiKey, signal }) {
      if (!apiKey) {
        return { ok: false, code: "WEB_SEARCH_KEY_REQUIRED", message: SAFE_ERROR_MESSAGES.WEB_SEARCH_KEY_REQUIRED };
      }
      const body: Record<string, unknown> = {
        query: request.query,
        topic: request.topic ?? "general",
        search_depth: "basic",
        max_results: MAX_WEB_RESULTS,
        include_answer: false,
        include_raw_content: false,
      };
      if (request.timeRange) body.time_range = request.timeRange;
      if (request.includeDomains && request.includeDomains.length > 0) {
        body.include_domains = request.includeDomains;
      }

      let response: Response;
      try {
        response = await fetch(TAVILY_SEARCH_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal,
        });
      } catch (err) {
        const aborted =
          signal?.aborted ||
          (err instanceof Error && (/abort/i.test(err.message) || err.name === "AbortError" || err.name === "TimeoutError"));
        if (aborted) {
          return { ok: false, code: "WEB_SEARCH_TIMEOUT", message: SAFE_ERROR_MESSAGES.WEB_SEARCH_TIMEOUT };
        }
        return { ok: false, code: "WEB_SEARCH_FAILED", message: SAFE_ERROR_MESSAGES.WEB_SEARCH_FAILED };
      }

      if (response.status === 401 || response.status === 403) {
        return { ok: false, code: "WEB_SEARCH_AUTH_FAILED", message: SAFE_ERROR_MESSAGES.WEB_SEARCH_AUTH_FAILED };
      }
      if (response.status === 429) {
        return { ok: false, code: "WEB_SEARCH_RATE_LIMITED", message: SAFE_ERROR_MESSAGES.WEB_SEARCH_RATE_LIMITED };
      }
      if (!response.ok) {
        return { ok: false, code: "WEB_SEARCH_FAILED", message: SAFE_ERROR_MESSAGES.WEB_SEARCH_FAILED };
      }

      let payload: { results?: unknown };
      try {
        payload = (await response.json()) as { results?: unknown };
      } catch {
        return { ok: false, code: "WEB_SEARCH_FAILED", message: SAFE_ERROR_MESSAGES.WEB_SEARCH_FAILED };
      }

      const results = normalizeResults(payload.results);
      return { ok: true, query: request.query, count: results.length, results };
    },
  };
}
