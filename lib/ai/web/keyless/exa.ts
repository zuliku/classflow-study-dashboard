/**
 * Kiro Search — Exa hosted MCP（keyless 基础搜索 / 基础读取）。
 *
 * 无账号、无 API Key；endpoint 固定，query/objective 之外不发送任何用户数据。
 * 文档：https://exa.ai/docs/get-started/exa-mcp
 */
import { APP_VERSION } from "@/lib/version";
import {
  KiroWebEvidenceOutcome,
  KiroWebEvidenceRequest,
  KiroWebEvidenceSource,
  KiroWebSearchOutcome,
  KiroWebSearchRequest,
  MAX_KEYLESS_RESULTS,
  MAX_WEB_EVIDENCE_CHARS_PER_SOURCE,
  MAX_WEB_EVIDENCE_CHUNK_CHARS,
} from "@/lib/ai/web/types";
import type { KiroWebEvidenceProvider, KiroWebSearchProvider } from "@/lib/ai/web/provider";
import { KiroMcpError, callKiroMcpTool, firstMcpText } from "@/lib/ai/web/keyless/mcp";
import {
  filterKeylessByDomains,
  filterKeylessByTimeRange,
  normalizeKeylessText,
  parseExaSearchText,
} from "@/lib/ai/web/keyless/results";
import {
  applyNativeEvidenceBudget,
  chunkNativeEvidence,
  normalizeNativeWebText,
  selectNativeEvidenceChunks,
} from "@/lib/ai/web/native/evidenceChunks";

export const EXA_MCP_ENDPOINT = "https://mcp.exa.ai/mcp";
export const EXA_SEARCH_TOOL = "web_search_exa";
export const EXA_FETCH_TOOL = "web_fetch_exa";

function searchObjective(request: KiroWebSearchRequest): string {
  const parts = [
    `Find current, authoritative and relevant web sources for: ${request.query}.`,
    request.topic === "news" ? "Focus on recent news and current events." : "",
    request.timeRange
      ? `Prefer pages published within the last ${
          request.timeRange === "day" ? "day" : request.timeRange === "week" ? "week" : request.timeRange === "month" ? "month" : "year"
        }.`
      : "",
    request.includeDomains?.length ? `Prefer these domains: ${request.includeDomains.join(", ")}.` : "",
    request.excludeDomains?.length ? `Exclude these domains: ${request.excludeDomains.join(", ")}.` : "",
    request.exactMatch ? "The results must contain the exact quoted phrase(s) in the query." : "",
  ].filter(Boolean);
  return parts.join(" ");
}

function mapSearchError(err: unknown): KiroWebSearchOutcome {
  if (err instanceof KiroMcpError) {
    switch (err.code) {
      case "RATE_LIMITED":
        return { ok: false, code: "WEB_SEARCH_RATE_LIMITED", message: "搜索请求过于频繁，请稍后再试。" };
      case "AUTH_FAILED":
        return { ok: false, code: "WEB_SEARCH_FAILED", message: "网络搜索失败，请稍后再试。" };
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

export function createExaKeylessWebSearchProvider(deps?: {
  endpoint?: string;
  userAgent?: string;
}): KiroWebSearchProvider & KiroWebEvidenceProvider {
  const endpoint = deps?.endpoint ?? EXA_MCP_ENDPOINT;
  const userAgent = deps?.userAgent ?? `ClassFlow/${APP_VERSION}`;

  return {
    id: "exa",
    async search(request, { signal }) {
      try {
        const { result } = await callKiroMcpTool({
          endpoint,
          toolName: EXA_SEARCH_TOOL,
          args: {
            query: request.query,
            objective: searchObjective(request),
            numResults: MAX_KEYLESS_RESULTS,
          },
          signal,
          userAgent,
        });
        const text = firstMcpText(result);
        const parsed = parseExaSearchText(text);
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
        {
          query: "ClassFlow search connection test",
        },
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
          toolName: EXA_FETCH_TOOL,
          args: {
            urls: request.sources.map((s) => s.url),
            maxCharacters: MAX_WEB_EVIDENCE_CHARS_PER_SOURCE,
          },
          signal,
          userAgent,
        });
        const text = firstMcpText(result);
        return parseExaFetchText(text, request);
      } catch (err) {
        return mapEvidenceError(err);
      }
    },
  };
}

/** Exa fetch 文本 → evidence sources；只保留请求中的 sourceId / 原始 URL。 */
export function parseExaFetchText(text: string, request: KiroWebEvidenceRequest): KiroWebEvidenceOutcome {
  const blocks = text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}---\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const bySource = new Map<string, string>();

  if (blocks.length <= 1) {
    if (request.sources.length > 0) {
      bySource.set(request.sources[0].sourceId, text);
    }
  } else {
    for (const block of blocks) {
      const url = block.match(/^URL:\s*(.+)$/m)?.[1]?.trim();
      const source = url
        ? request.sources.find((s) => canonicalEqual(s.url, url))
        : undefined;
      if (source) bySource.set(source.sourceId, block);
    }
    // 无法按 URL 匹配时，保守地只把第一块给第一个 source，避免错误归因。
    if (bySource.size === 0 && request.sources.length > 0) {
      bySource.set(request.sources[0].sourceId, blocks[0]);
    }
  }

  const sources: KiroWebEvidenceSource[] = [];
  for (const requested of request.sources) {
    const raw = bySource.get(requested.sourceId);
    if (!raw) continue;
    const normalized = normalizeNativeWebText(raw);
    if (normalized.length < 120) continue;
    const providerTruncated = raw.length >= MAX_WEB_EVIDENCE_CHARS_PER_SOURCE;
    const { chunks: allChunks, truncated: scanTruncated } = chunkNativeEvidence(normalized, {
      maxChunkChars: MAX_WEB_EVIDENCE_CHUNK_CHARS,
    });
    const { selected, truncated: selectionTruncated } = selectNativeEvidenceChunks(allChunks, request.query);
    const { chunks, truncated: budgetTruncated } = applyNativeEvidenceBudget(selected);
    if (chunks.length === 0) continue;
    sources.push({
      sourceId: requested.sourceId,
      title: "",
      url: requested.url,
      domain: "",
      chunks,
      truncated: providerTruncated || scanTruncated || selectionTruncated || budgetTruncated,
    });
  }

  if (sources.length === 0) {
    return { ok: false, code: "WEB_READ_NO_EVIDENCE", message: "没有读取到可用的网页正文证据。" };
  }
  return { ok: true, sources };
}

function canonicalEqual(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    ua.hash = "";
    ub.hash = "";
    const strip = (u: URL) => {
      const keys = Array.from(u.searchParams.keys());
      for (const key of keys) {
        if (/^utm_|^gclid$|^fbclid$/i.test(key)) u.searchParams.delete(key);
      }
      return `${u.protocol}//${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}`;
    };
    return strip(ua) === strip(ub);
  } catch {
    return normalizeKeylessText(a) === normalizeKeylessText(b);
  }
}
