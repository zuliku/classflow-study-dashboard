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
  KiroWebEvidenceRequest,
  KiroWebEvidenceSource,
  KiroWebEvidenceOutcome,
  MAX_WEB_RESULTS,
  MAX_WEB_EVIDENCE_CHARS_PER_SOURCE,
  MAX_WEB_EVIDENCE_CHUNK_CHARS,
  WEB_SEARCH_SNIPPET_MAX_CHARS,
} from "@/lib/ai/web/types";
import { KiroWebSearchProvider } from "@/lib/ai/web/provider";

export const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
export const TAVILY_USAGE_URL = "https://api.tavily.com/usage";
export const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";

/** Task 16A：Extract 固定参数（ClassFlow 决定，Agent 不能控制） */
const TAVILY_EXTRACT_CHUNKS_PER_SOURCE = 3;

const SAFE_ERROR_MESSAGES: Record<KiroWebSearchErrorCode, string> = {
  WEB_SEARCH_DISABLED: "Kiro Search 已关闭。",
  WEB_SEARCH_KEY_REQUIRED: "Kiro Search 尚未配置。",
  WEB_SEARCH_AUTH_FAILED: "搜索服务凭据无效。",
  WEB_SEARCH_RATE_LIMITED: "搜索请求过于频繁，请稍后再试。",
  WEB_SEARCH_TIMEOUT: "网络搜索超时，请重试。",
  WEB_SEARCH_FAILED: "网络搜索失败，请稍后再试。",
  WEB_SEARCH_LIMIT_REACHED: "本轮网络搜索次数已达上限。",
  WEB_SEARCH_DUPLICATE_QUERY: "本轮已经搜索过相同关键词。",
  WEB_SOURCE_NOT_FOUND: "找不到该网页来源。",
  WEB_READ_LIMIT_REACHED: "本轮网页阅读额度已用完。",
  WEB_SOURCE_ALREADY_READ: "该网页来源本轮已经阅读过。",
  WEB_READ_TIMEOUT: "网页读取超时，请重试。",
  WEB_READ_FAILED: "网页读取失败，请稍后再试。",
  WEB_READ_NO_EVIDENCE: "没有读取到可用的网页正文证据。",
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
 * Evidence URL canonical（Task 17A）：
 * 复用 canonicalWebSearchUrl（hash/tracking 参数），再补 pathname trailing slash 归一：
 * https://example.com/a 与 https://example.com/a/ 视为同一 source；
 * 根路径 https://example.com/ 保持合法。不做激进归一（?id=1 与 ?id=2 仍不同）。
 */
export function canonicalEvidenceUrl(raw: string): string | null {
  const base = canonicalWebSearchUrl(raw);
  if (!base) return null;
  try {
    const u = new URL(base);
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }
    return u.toString();
  } catch {
    return base;
  }
}

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

function normalizeResults(raw: unknown): { results: KiroWebSearchResult[]; duplicatesFiltered: number } {
  if (!Array.isArray(raw)) return { results: [], duplicatesFiltered: 0 };
  const out: KiroWebSearchResult[] = [];
  const seenCanonical = new Set<string>();
  let duplicatesFiltered = 0;
  for (const item of raw) {
    if (out.length >= MAX_WEB_RESULTS) break;
    if (!item || typeof item !== "object") continue;
    const r = item as TavilyRawResult;
    if (typeof r.url !== "string") continue;
    const urlInfo = parseUrl(r.url);
    if (!urlInfo) continue;
    // 确定性 canonical URL 去重（tracking 参数差异不重复计数）
    const canonical = canonicalWebSearchUrl(r.url);
    if (!canonical || seenCanonical.has(canonical)) {
      duplicatesFiltered += 1;
      continue;
    }
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
  return { results: out, duplicatesFiltered };
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
      if (request.excludeDomains && request.excludeDomains.length > 0) {
        body.exclude_domains = request.excludeDomains;
      }
      if (request.exactMatch === true) body.exact_match = true;
      // 绝不发送：auto_parameters / advanced depth / 其他 Provider knobs

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

      const { results, duplicatesFiltered } = normalizeResults(payload.results);
      return { ok: true, query: request.query, count: results.length, results, duplicatesFiltered };
    },
    async extract(request, { apiKey, signal }) {
      if (!apiKey) {
        return { ok: false, code: "WEB_SEARCH_KEY_REQUIRED", message: SAFE_ERROR_MESSAGES.WEB_SEARCH_KEY_REQUIRED };
      }
      const body: Record<string, unknown> = {
        urls: request.sources.map((s) => s.url),
        extract_depth: "basic",
        chunks_per_source: TAVILY_EXTRACT_CHUNKS_PER_SOURCE,
      };
      if (request.query && request.query.trim()) body.query = request.query.trim();

      let response: Response;
      try {
        response = await fetch(TAVILY_EXTRACT_URL, {
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
          return { ok: false, code: "WEB_READ_TIMEOUT", message: SAFE_ERROR_MESSAGES.WEB_READ_TIMEOUT };
        }
        return { ok: false, code: "WEB_READ_FAILED", message: SAFE_ERROR_MESSAGES.WEB_READ_FAILED };
      }
      if (response.status === 401 || response.status === 403) {
        return { ok: false, code: "WEB_SEARCH_AUTH_FAILED", message: SAFE_ERROR_MESSAGES.WEB_SEARCH_AUTH_FAILED };
      }
      if (response.status === 429) {
        return { ok: false, code: "WEB_SEARCH_RATE_LIMITED", message: SAFE_ERROR_MESSAGES.WEB_SEARCH_RATE_LIMITED };
      }
      if (!response.ok) {
        return { ok: false, code: "WEB_READ_FAILED", message: SAFE_ERROR_MESSAGES.WEB_READ_FAILED };
      }

      let payload: { results?: unknown };
      try {
        payload = (await response.json()) as { results?: unknown };
      } catch {
        return { ok: false, code: "WEB_READ_FAILED", message: SAFE_ERROR_MESSAGES.WEB_READ_FAILED };
      }

      return { ok: true, sources: normalizeEvidence(payload.results, request.sources) };
    },
  };
}

interface TavilyExtractResult {
  url?: unknown;
  raw_content?: unknown;
  chunks?: unknown;
}

/** 段落切分：双换行折叠为 ≤3 块，单块 ≤ MAX_WEB_EVIDENCE_CHUNK_CHARS */
function splitEvidenceChunks(raw: string): string[] {
  const collapsed = raw.replace(/\r\n/g, "\n");
  const paragraphs = collapsed
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current && current.length + p.length + 1 > MAX_WEB_EVIDENCE_CHUNK_CHARS) {
      chunks.push(current);
      current = p;
      if (chunks.length >= TAVILY_EXTRACT_CHUNKS_PER_SOURCE) break;
    } else {
      current = current ? `${current} ${p}` : p;
    }
  }
  if (current) chunks.push(current);
  return chunks.slice(0, TAVILY_EXTRACT_CHUNKS_PER_SOURCE);
}

/**
 * Chunk 归一化管线（Task 17A）：
 * normalize（折叠空白/trim）→ 空 chunk 删除 → exact 去重 → 单 chunk ≤ MAX_WEB_EVIDENCE_CHUNK_CHARS。
 * 所有 Provider chunks 与 fallback 都经过同一管线；不做 HTML 解析 / embedding / similarity。
 */
function normalizeEvidenceChunks(rawChunks: string[]): { chunks: string[]; truncated: boolean } {
  const seen = new Set<string>();
  const out: string[] = [];
  let truncated = false;
  for (const raw of rawChunks) {
    const normalized = collapseWhitespace(raw);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (normalized.length > MAX_WEB_EVIDENCE_CHUNK_CHARS) {
      out.push(normalized.slice(0, MAX_WEB_EVIDENCE_CHUNK_CHARS));
      truncated = true;
    } else {
      out.push(normalized);
    }
  }
  return { chunks: out, truncated };
}

/**
 * Evidence 归一化（Task 16A/17A）：
 * - 只返回 clean text chunks（无 HTML/CSS/script/JSON-LD/metadata）
 * - canonicalEvidenceUrl 匹配（tracking 参数 / hash / trailing slash 兼容；?id=1 与 ?id=2 仍不同）
 * - 空 evidence（无非空 chunk）的 source 不进入成功列表
 * - 绝不返回 raw response / usage / key
 */
function normalizeEvidence(raw: unknown, requested: { sourceId: string; url: string }[]): KiroWebEvidenceSource[] {
  if (!Array.isArray(raw)) return [];
  const byCanonical = new Map<string, { item: unknown; canonical: string }>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as TavilyExtractResult;
    if (typeof r.url !== "string") continue;
    const canonical = canonicalEvidenceUrl(r.url);
    if (!canonical) continue;
    if (!byCanonical.has(canonical)) byCanonical.set(canonical, { item, canonical });
  }
  const out: KiroWebEvidenceSource[] = [];
  for (const req of requested) {
    const canonical = canonicalEvidenceUrl(req.url);
    if (!canonical) continue;
    const found = byCanonical.get(canonical);
    if (!found || typeof found.item !== "object") continue;
    const r = found.item as TavilyExtractResult;
    // 优先 Provider chunks；否则 raw_content 段落切分
    const rawChunks =
      Array.isArray(r.chunks) && r.chunks.length > 0
        ? r.chunks.filter((c): c is string => typeof c === "string")
        : splitEvidenceChunks(typeof r.raw_content === "string" ? r.raw_content : "");
    const { chunks: normalizedChunks, truncated: chunkTruncated } = normalizeEvidenceChunks(rawChunks);

    let total = 0;
    const capped: KiroWebEvidenceSource["chunks"] = [];
    let truncated = chunkTruncated;
    for (const c of normalizedChunks) {
      const room = MAX_WEB_EVIDENCE_CHARS_PER_SOURCE - total;
      if (room <= 0) {
        truncated = true;
        break;
      }
      const text = c.length > room ? c.slice(0, room) : c;
      capped.push({ text });
      total += text.length;
      if (c.length > room) truncated = true;
    }
    // 空 evidence（chunks 全空）不进入成功列表
    if (capped.length === 0) continue;
    out.push({
      sourceId: req.sourceId,
      title: "", // title/domain 由调用层从可信 source 注册表补全
      url: req.url,
      domain: "",
      chunks: capped,
      truncated,
    });
  }
  return out;
}
