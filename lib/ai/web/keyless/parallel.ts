/**
 * Kiro Search — Parallel Search hosted MCP（keyless 基础搜索 / 基础读取）。
 *
 * 无账号、无 API Key；endpoint 固定。
 * 文档：https://parallel.ai/integrations/mcp/search-mcp
 */
import { APP_VERSION } from "@/lib/version";
import {
  KiroWebEvidenceOutcome,
  KiroWebEvidenceRequest,
  KiroWebEvidenceSource,
  KiroWebSearchOutcome,
  KiroWebSearchRequest,
  MAX_WEB_EVIDENCE_CHUNK_CHARS,
} from "@/lib/ai/web/types";
import type { KiroWebEvidenceProvider, KiroWebSearchProvider } from "@/lib/ai/web/provider";
import { KiroMcpError, callKiroMcpTool, firstMcpText, isRecord } from "@/lib/ai/web/keyless/mcp";
import {
  filterKeylessByDomains,
  filterKeylessByTimeRange,
  normalizeKeylessText,
  parseParallelResults,
} from "@/lib/ai/web/keyless/results";
import {
  applyNativeEvidenceBudget,
  chunkNativeEvidence,
  normalizeNativeWebText,
  selectNativeEvidenceChunks,
} from "@/lib/ai/web/native/evidenceChunks";

export const PARALLEL_MCP_ENDPOINT = "https://search.parallel.ai/mcp";
export const PARALLEL_SEARCH_TOOL = "web_search";
export const PARALLEL_FETCH_TOOL = "web_fetch";

/** 进程内匿名 session id：仅用于 Parallel 免费额度关联，不含用户身份。 */
let defaultSessionId: string | null = null;
function getSessionId(): string {
  if (defaultSessionId) return defaultSessionId;
  try {
    defaultSessionId = globalThis.crypto.randomUUID();
  } catch {
    defaultSessionId = `classflow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
  return defaultSessionId;
}

function searchObjective(request: KiroWebSearchRequest): string {
  return [
    `Find current, authoritative and relevant web sources for: ${request.query}.`,
    request.topic === "news" ? "Focus on recent news and current events." : "",
    request.timeRange
      ? `Prefer pages published within the last ${
          request.timeRange === "day" ? "day" : request.timeRange === "week" ? "week" : request.timeRange === "month" ? "month" : "year"
        }.`
      : "",
    request.excludeDomains?.length ? `Exclude these domains: ${request.excludeDomains.join(", ")}.` : "",
    request.exactMatch ? "The results must contain the exact quoted phrase(s) in the query." : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Parallel 文档建议 3-6 个词的短 query，且不支持 quoted phrases。 */
function searchQueries(request: KiroWebSearchRequest): string[] {
  const base = request.query.replace(/["“”]/g, " ").replace(/\s+/g, " ").trim();
  const queries = [base || request.query];
  for (const domain of request.includeDomains ?? []) {
    if (queries.length >= 3) break;
    const d = domain.replace(/^www\./, "").trim();
    if (d) queries.push(`site:${d}`);
  }
  return queries;
}

function mapSearchError(err: unknown): KiroWebSearchOutcome {
  if (err instanceof KiroMcpError) {
    switch (err.code) {
      case "RATE_LIMITED":
        return { ok: false, code: "WEB_SEARCH_RATE_LIMITED", message: "搜索请求过于频繁，请稍后再试。" };
      case "TIMEOUT":
        return { ok: false, code: "WEB_SEARCH_TIMEOUT", message: "网络搜索超时，请重试。" };
      default:
        return { ok: false, code: "WEB_SEARCH_FAILED", message: "网络搜索失败，请稍后再试。" };
    }
  }
  return { ok: false, code: "WEB_SEARCH_FAILED", message: "网络搜索失败，请稍后再试。" };
}

function mapEvidenceError(err: unknown): KiroWebEvidenceOutcome {
  if (err instanceof KiroMcpError && err.code === "TIMEOUT") {
    return { ok: false, code: "WEB_READ_TIMEOUT", message: "网页读取超时，请稍后重试。" };
  }
  return { ok: false, code: "WEB_READ_FAILED", message: "网页读取失败，请稍后重试。" };
}

function parseParallelPayload(result: unknown): { results?: unknown } | null {
  if (!isRecord(result)) return null;
  const structured = result.structuredContent;
  if (isRecord(structured) && Array.isArray(structured.results)) {
    return { results: structured.results };
  }
  const text = firstMcpText(result);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? (parsed as { results?: unknown }) : null;
  } catch {
    return null;
  }
}

export function createParallelKeylessWebSearchProvider(deps?: {
  endpoint?: string;
  userAgent?: string;
  sessionId?: string;
}): KiroWebSearchProvider & KiroWebEvidenceProvider {
  const endpoint = deps?.endpoint ?? PARALLEL_MCP_ENDPOINT;
  const userAgent = deps?.userAgent ?? `ClassFlow/${APP_VERSION}`;
  const sessionId = deps?.sessionId ?? getSessionId();

  return {
    id: "parallel",
    async search(request, { signal }) {
      try {
        const { result } = await callKiroMcpTool({
          endpoint,
          toolName: PARALLEL_SEARCH_TOOL,
          args: {
            objective: searchObjective(request),
            search_queries: searchQueries(request),
            session_id: sessionId,
          },
          signal,
          userAgent,
        });
        const payload = parseParallelPayload(result);
        const parsed = parseParallelResults(payload?.results);
        const filtered = filterKeylessByDomains(filterKeylessByTimeRange(parsed, request.timeRange), {
          includeDomains: request.includeDomains,
          excludeDomains: request.excludeDomains,
        });
        return {
          ok: true,
          query: request.query,
          count: filtered.length,
          results: filtered,
        };
      } catch (err) {
        return mapSearchError(err);
      }
    },
    async checkCredential({ signal }) {
      const outcome = await this.search(
        { query: "ClassFlow search connection test" },
        { apiKey: "", signal }
      );
      if (outcome.ok) return { ok: true };
      switch (outcome.code) {
        case "WEB_SEARCH_RATE_LIMITED":
          return { ok: false, code: "WEB_SEARCH_RATE_LIMITED", message: outcome.message };
        case "WEB_SEARCH_TIMEOUT":
          return { ok: false, code: "WEB_SEARCH_TIMEOUT", message: outcome.message };
        case "WEB_SEARCH_AUTH_FAILED":
          return { ok: false, code: "WEB_SEARCH_AUTH_FAILED", message: outcome.message };
        default:
          return { ok: false, code: "WEB_SEARCH_FAILED", message: outcome.message };
      }
    },
    async extract(request, { signal }) {
      try {
        const { result } = await callKiroMcpTool({
          endpoint,
          toolName: PARALLEL_FETCH_TOOL,
          args: {
            urls: request.sources.map((s) => s.url),
            objective: request.query
              ? `Extract evidence relevant to: ${request.query}`
              : "Extract the main content of these pages.",
            ...(request.query ? { search_queries: [request.query] } : {}),
            full_content: false,
            allow_live_fetch: true,
            session_id: sessionId,
          },
          signal,
          userAgent,
        });
        const payload = parseParallelPayload(result);
        return parseParallelFetchResults(payload?.results, request);
      } catch (err) {
        return mapEvidenceError(err);
      }
    },
  };
}

/** Parallel fetch results[] → evidence sources；excerpts 不是完整正文，不产生页码。 */
export function parseParallelFetchResults(
  raw: unknown,
  request: KiroWebEvidenceRequest
): KiroWebEvidenceOutcome {
  if (!Array.isArray(raw)) {
    return { ok: false, code: "WEB_READ_NO_EVIDENCE", message: "没有读取到可用的网页正文证据。" };
  }
  const byUrl = new Map<string, { title?: string; text: string }>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as { url?: unknown; title?: unknown; excerpts?: unknown };
    if (typeof r.url !== "string") continue;
    const excerpts = Array.isArray(r.excerpts)
      ? r.excerpts.filter((v): v is string => typeof v === "string")
      : [];
    const text = excerpts.join("\n\n");
    if (!text.trim()) continue;
    byUrl.set(canonicalKey(r.url), {
      title: typeof r.title === "string" ? r.title : undefined,
      text,
    });
  }

  const sources: KiroWebEvidenceSource[] = [];
  for (const requested of request.sources) {
    const match = byUrl.get(canonicalKey(requested.url));
    if (!match) continue;
    const normalized = normalizeNativeWebText(match.text);
    if (normalized.length < 120) continue;
    const { chunks: allChunks, truncated: scanTruncated } = chunkNativeEvidence(normalized, {
      maxChunkChars: MAX_WEB_EVIDENCE_CHUNK_CHARS,
    });
    const { selected, truncated: selectionTruncated } = selectNativeEvidenceChunks(allChunks, request.query);
    const { chunks, truncated: budgetTruncated } = applyNativeEvidenceBudget(selected);
    if (chunks.length === 0) continue;
    sources.push({
      sourceId: requested.sourceId,
      title: match.title ?? "",
      url: requested.url,
      domain: "",
      chunks,
      truncated: scanTruncated || selectionTruncated || budgetTruncated,
    });
  }

  if (sources.length === 0) {
    return { ok: false, code: "WEB_READ_NO_EVIDENCE", message: "没有读取到可用的网页正文证据。" };
  }
  return { ok: true, sources };
}

function canonicalKey(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    const keys = Array.from(u.searchParams.keys());
    for (const key of keys) {
      if (/^utm_|^gclid$|^fbclid$/i.test(key)) u.searchParams.delete(key);
    }
    return `${u.protocol}//${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return normalizeKeylessText(raw);
  }
}
