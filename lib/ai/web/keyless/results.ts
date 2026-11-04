/**
 * Keyless Search — provider-neutral result parsing / normalization。
 * 只做数据清洗；sourceId 永远由 web_search Tool 层分配。
 */
import { canonicalWebSearchUrl } from "@/lib/ai/web/tavily";
import {
  KiroWebSearchResult,
  MAX_KEYLESS_RESULTS,
  WEB_SEARCH_SNIPPET_MAX_CHARS,
} from "@/lib/ai/web/types";

const TRACKING_HTML_RE = /<[^>]*>/g;

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function normalizeKeylessText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const stripped = decodeBasicEntities(raw.replace(TRACKING_HTML_RE, " "));
  const collapsed = collapseWhitespace(stripped);
  return collapsed.length > WEB_SEARCH_SNIPPET_MAX_CHARS
    ? collapsed.slice(0, WEB_SEARCH_SNIPPET_MAX_CHARS)
    : collapsed;
}

function parseHttpUrl(raw: unknown): { url: string; domain: string } | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return { url: url.href, domain: url.hostname.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

/** RFC/ISO/常见日期 → YYYY-MM-DD；无法解析 → undefined（绝不猜）。 */
export function normalizeKeylessPublishedAt(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed || /^n\/?a$/i.test(trimmed)) return undefined;
  const timestamp = Date.parse(trimmed);
  if (!Number.isFinite(timestamp)) return undefined;
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function normalizeKeylessResult(input: {
  title?: unknown;
  url?: unknown;
  snippet?: unknown;
  publishedAt?: unknown;
  score?: unknown;
}): KiroWebSearchResult | null {
  const urlInfo = parseHttpUrl(input.url);
  if (!urlInfo) return null;
  const snippet = normalizeKeylessText(input.snippet);
  const title = normalizeKeylessText(input.title);
  if (!title && !snippet) return null;
  const publishedAt = normalizeKeylessPublishedAt(input.publishedAt);
  return {
    sourceId: "",
    title: title || urlInfo.domain,
    url: urlInfo.url,
    domain: urlInfo.domain,
    snippet,
    ...(publishedAt ? { publishedAt } : {}),
    ...(typeof input.score === "number" && Number.isFinite(input.score) ? { score: input.score } : {}),
  };
}

/** Exa 文本块：Title / URL / Published / Highlights|Text，块间以 `\n\n---\n\n` 分隔。 */
export function parseExaSearchText(text: string): KiroWebSearchResult[] {
  const blocks = text
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}---\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const results: KiroWebSearchResult[] = [];
  for (const block of blocks) {
    if (results.length >= MAX_KEYLESS_RESULTS) break;
    const url = block.match(/^URL:\s*(.+)$/m)?.[1]?.trim();
    if (!url) continue;
    const title = block.match(/^Title:\s*(.+)$/m)?.[1]?.trim();
    const published = block.match(/^Published:\s*(.+)$/m)?.[1]?.trim();
    const contentMatch = block.match(/^(?:Highlights|Text|Content):\s*\n?([\s\S]*)$/m);
    const snippet = contentMatch?.[1] ?? "";
    const normalized = normalizeKeylessResult({
      title,
      url,
      snippet,
      publishedAt: published,
    });
    if (normalized) results.push(normalized);
  }
  return dedupeKeylessResults(results);
}

/** Parallel structured results：results[] { url, title, publish_date, excerpts[] } */
export function parseParallelResults(raw: unknown): KiroWebSearchResult[] {
  if (!Array.isArray(raw)) return [];
  const results: KiroWebSearchResult[] = [];
  for (const item of raw) {
    if (results.length >= MAX_KEYLESS_RESULTS) break;
    if (!item || typeof item !== "object") continue;
    const r = item as { url?: unknown; title?: unknown; publish_date?: unknown; excerpts?: unknown };
    const excerpts = Array.isArray(r.excerpts)
      ? r.excerpts.filter((v): v is string => typeof v === "string")
      : [];
    const normalized = normalizeKeylessResult({
      title: r.title,
      url: r.url,
      snippet: excerpts.join("\n\n"),
      publishedAt: r.publish_date,
    });
    if (normalized) results.push(normalized);
  }
  return dedupeKeylessResults(results);
}

export function dedupeKeylessResults(results: KiroWebSearchResult[]): KiroWebSearchResult[] {
  const seen = new Set<string>();
  const out: KiroWebSearchResult[] = [];
  for (const result of results) {
    const canonical = canonicalWebSearchUrl(result.url);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(result);
  }
  return out;
}

/** timeRange 后过滤：无 publishedAt 的结果保留（与 Tavily 默认一致，不猜日期）。 */
export function filterKeylessByTimeRange(
  results: KiroWebSearchResult[],
  timeRange: "day" | "week" | "month" | "year" | undefined,
  now = Date.now()
): KiroWebSearchResult[] {
  if (!timeRange) return results;
  const days = timeRange === "day" ? 1 : timeRange === "week" ? 7 : timeRange === "month" ? 30 : 365;
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return results.filter((result) => {
    if (!result.publishedAt) return true;
    const timestamp = Date.parse(`${result.publishedAt}T00:00:00Z`);
    return !Number.isFinite(timestamp) || timestamp >= cutoff;
  });
}

function domainMatches(domain: string, filter: string): boolean {
  const d = domain.toLowerCase();
  const f = filter.toLowerCase().replace(/^www\./, "");
  return d === f || d.endsWith(`.${f}`);
}

export function filterKeylessByDomains(
  results: KiroWebSearchResult[],
  input: { includeDomains?: string[]; excludeDomains?: string[] }
): KiroWebSearchResult[] {
  const include = (input.includeDomains ?? []).filter(Boolean);
  const exclude = (input.excludeDomains ?? []).filter(Boolean);
  return results.filter((result) => {
    if (exclude.some((d) => domainMatches(result.domain, d))) return false;
    if (include.length > 0 && !include.some((d) => domainMatches(result.domain, d))) return false;
    return true;
  });
}
