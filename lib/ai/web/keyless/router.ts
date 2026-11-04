/**
 * Kiro Search — Keyless Router（Exa / Parallel）。
 *
 * 职责：
 * - 默认基础搜索：无 Key 时在 Exa / Parallel 间按语言与冷却选择；
 * - 进程内 5 分钟缓存 + single-flight，避免重复/并发请求打空免费额度；
 * - provider 429 / timeout / 5xx 后短冷却，自动切换另一通道；
 * - 证据读取同样走 Exa / Parallel，Native Reader 失败后的 keyless fallback。
 *
 * 不包含：Turn limit / sourceId / citation / UI / history（仍由 Tool 层负责）。
 */
import {
  KiroWebEvidenceOutcome,
  KiroWebEvidenceRequest,
  KiroWebSearchCredentialCheckOutcome,
  KiroWebSearchErrorCode,
  KiroWebSearchOutcome,
  KiroWebSearchRequest,
  KiroWebSearchSuccess,
  KEYLESS_EVIDENCE_ATTEMPT_TIMEOUT_MS,
  KEYLESS_PROVIDER_COOLDOWN_MAX_MS,
  KEYLESS_PROVIDER_COOLDOWN_MS,
  KEYLESS_SEARCH_ATTEMPT_TIMEOUT_MS,
  KEYLESS_SEARCH_CACHE_MAX_ENTRIES,
  KEYLESS_SEARCH_CACHE_TTL_MS,
} from "@/lib/ai/web/types";
import type { KiroWebEvidenceProvider, KiroWebSearchProvider } from "@/lib/ai/web/provider";
import { createExaKeylessWebSearchProvider } from "@/lib/ai/web/keyless/exa";
import { createParallelKeylessWebSearchProvider } from "@/lib/ai/web/keyless/parallel";

const CJK_RE = /[\u3400-\u9FFF]/;

export function containsCjk(text: string): boolean {
  return CJK_RE.test(text);
}

function safeMessage(code: KiroWebSearchErrorCode): string {
  switch (code) {
    case "WEB_SEARCH_RATE_LIMITED":
      return "搜索请求过于频繁，请稍后再试。";
    case "WEB_SEARCH_TIMEOUT":
      return "网络搜索超时，请重试。";
    default:
      return "网络搜索失败，请稍后再试。";
  }
}

function cacheKey(request: KiroWebSearchRequest): string {
  const domains = (request.includeDomains ?? []).map((d) => d.toLowerCase()).sort().join(",");
  const excluded = (request.excludeDomains ?? []).map((d) => d.toLowerCase()).sort().join(",");
  return JSON.stringify({
    q: request.query.trim().replace(/\s+/g, " ").toLowerCase(),
    topic: request.topic ?? "general",
    time: request.timeRange ?? "",
    include: domains,
    exclude: excluded,
    exact: request.exactMatch === true,
  });
}

function cloneSuccess(result: KiroWebSearchSuccess): KiroWebSearchSuccess {
  return {
    ...result,
    results: result.results.map((r) => ({ ...r, sourceId: "" })),
  };
}

interface AttemptResult {
  outcome: KiroWebSearchOutcome;
  timedOut: boolean;
}

async function runAttempt(
  provider: KiroWebSearchProvider,
  request: KiroWebSearchRequest,
  outerSignal: AbortSignal | undefined,
  timeoutMs: number
): Promise<AttemptResult> {
  if (outerSignal?.aborted) {
    return { outcome: { ok: false, code: "WEB_SEARCH_TIMEOUT", message: safeMessage("WEB_SEARCH_TIMEOUT") }, timedOut: true };
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onOuterAbort = () => controller.abort();
  outerSignal?.addEventListener("abort", onOuterAbort, { once: true });
  try {
    const outcome = await provider.search(request, { apiKey: "", signal: controller.signal });
    return { outcome, timedOut: timedOut || (outcome.ok === false && outcome.code === "WEB_SEARCH_TIMEOUT") };
  } catch {
    return {
      outcome: {
        ok: false,
        code: timedOut ? "WEB_SEARCH_TIMEOUT" : "WEB_SEARCH_FAILED",
        message: safeMessage(timedOut ? "WEB_SEARCH_TIMEOUT" : "WEB_SEARCH_FAILED"),
      },
      timedOut,
    };
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", onOuterAbort);
  }
}

export interface KeylessRouterOptions {
  exa?: KiroWebSearchProvider & KiroWebEvidenceProvider;
  parallel?: KiroWebSearchProvider & KiroWebEvidenceProvider;
  now?: () => number;
  searchTimeoutMs?: number;
  evidenceTimeoutMs?: number;
  cacheTtlMs?: number;
}

export interface KeylessSearchRouter {
  provider: KiroWebSearchProvider;
  checkCredential: (ctx: { signal?: AbortSignal }) => Promise<KiroWebSearchCredentialCheckOutcome>;
  /** 测试用：清空缓存 / 冷却 */
  reset: () => void;
}

export interface KeylessEvidenceRouter {
  provider: KiroWebEvidenceProvider;
  reset: () => void;
}

interface CacheEntry {
  at: number;
  result: KiroWebSearchSuccess;
}

export function createKeylessSearchRouter(options: KeylessRouterOptions = {}): KeylessSearchRouter {
  const exa = options.exa ?? createExaKeylessWebSearchProvider();
  const parallel = options.parallel ?? createParallelKeylessWebSearchProvider();
  const now = options.now ?? (() => Date.now());
  const searchTimeoutMs = options.searchTimeoutMs ?? KEYLESS_SEARCH_ATTEMPT_TIMEOUT_MS;
  const cacheTtlMs = options.cacheTtlMs ?? KEYLESS_SEARCH_CACHE_TTL_MS;
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<KiroWebSearchOutcome>>();
  const cooldowns = new Map<string, number>();

  const providers = (request: KiroWebSearchRequest): KiroWebSearchProvider[] =>
    containsCjk(request.query) ? [parallel, exa] : [exa, parallel];

  const isCooling = (id: string): boolean => {
    const until = cooldowns.get(id);
    if (!until) return false;
    if (until <= now()) {
      cooldowns.delete(id);
      return false;
    }
    return true;
  };

  const markCooldown = (id: string, outcome: KiroWebSearchOutcome): void => {
    if (outcome.ok) return;
    if (outcome.code !== "WEB_SEARCH_RATE_LIMITED" && outcome.code !== "WEB_SEARCH_TIMEOUT" && outcome.code !== "WEB_SEARCH_FAILED") {
      return;
    }
    const base = outcome.code === "WEB_SEARCH_TIMEOUT" ? Math.floor(KEYLESS_PROVIDER_COOLDOWN_MS / 2) : KEYLESS_PROVIDER_COOLDOWN_MS;
    const until = now() + Math.min(base, KEYLESS_PROVIDER_COOLDOWN_MAX_MS);
    cooldowns.set(id, until);
  };

  const trimCache = () => {
    while (cache.size > KEYLESS_SEARCH_CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (!oldest) break;
      cache.delete(oldest);
    }
  };

  const provider: KiroWebSearchProvider = {
    id: "auto",
    async search(request, { signal }) {
      const key = cacheKey(request);
      const cached = cache.get(key);
      if (cached && now() - cached.at <= cacheTtlMs) {
        return cloneSuccess(cached.result);
      }
      if (cached) cache.delete(key);

      const pending = inFlight.get(key);
      if (pending) return pending;

      const run = (async (): Promise<KiroWebSearchOutcome> => {
        let lastError: KiroWebSearchOutcome | null = null;
        let sawEmpty = false;
        let allCooling = true;

        for (const candidate of providers(request)) {
          if (isCooling(candidate.id)) continue;
          allCooling = false;
          const { outcome } = await runAttempt(candidate, request, signal, searchTimeoutMs);
          if (signal?.aborted) {
            return { ok: false, code: "WEB_SEARCH_TIMEOUT", message: safeMessage("WEB_SEARCH_TIMEOUT") };
          }
          if (outcome.ok) {
            if (outcome.results.length > 0) {
              cache.set(key, { at: now(), result: cloneSuccess(outcome) });
              trimCache();
              return cloneSuccess(outcome);
            }
            sawEmpty = true;
            continue;
          }
          lastError = outcome;
          markCooldown(candidate.id, outcome);
        }

        if (lastError) return lastError;
        if (sawEmpty) return { ok: true, query: request.query, count: 0, results: [] };
        if (allCooling) {
          return { ok: false, code: "WEB_SEARCH_RATE_LIMITED", message: safeMessage("WEB_SEARCH_RATE_LIMITED") };
        }
        return { ok: false, code: "WEB_SEARCH_FAILED", message: safeMessage("WEB_SEARCH_FAILED") };
      })();

      inFlight.set(key, run);
      try {
        return await run;
      } finally {
        inFlight.delete(key);
      }
    },
    async checkCredential({ signal }) {
      let last: KiroWebSearchCredentialCheckOutcome | null = null;
      for (const candidate of [exa, parallel]) {
        const outcome = await candidate.checkCredential({ apiKey: "", signal });
        if (outcome.ok) return outcome;
        last = outcome;
      }
      return last ?? { ok: false, code: "WEB_SEARCH_FAILED", message: safeMessage("WEB_SEARCH_FAILED") };
    },
  };

  return {
    provider,
    checkCredential: (ctx) => provider.checkCredential({ apiKey: "", signal: ctx.signal }),
    reset: () => {
      cache.clear();
      inFlight.clear();
      cooldowns.clear();
    },
  };
}

export function createKeylessEvidenceRouter(options: KeylessRouterOptions = {}): KeylessEvidenceRouter {
  const exa = options.exa ?? createExaKeylessWebSearchProvider();
  const parallel = options.parallel ?? createParallelKeylessWebSearchProvider();
  const evidenceTimeoutMs = options.evidenceTimeoutMs ?? KEYLESS_EVIDENCE_ATTEMPT_TIMEOUT_MS;
  const cooldowns = new Map<string, number>();
  const now = options.now ?? (() => Date.now());

  const evidenceProvider: KiroWebEvidenceProvider = {
    id: "auto",
    async extract(request: KiroWebEvidenceRequest, { signal }) {
      const order: KiroWebEvidenceProvider[] = containsCjk(request.query ?? "") ? [parallel, exa] : [exa, parallel];
      let last: KiroWebEvidenceOutcome | null = null;
      for (const candidate of order) {
        const until = cooldowns.get(candidate.id);
        if (until && until > now()) continue;
        const outcome = await runEvidenceAttempt(candidate, request, signal, evidenceTimeoutMs);
        if (outcome.ok && outcome.sources.length > 0) return outcome;
        if (!outcome.ok) {
          last = outcome;
          const cooldown = outcome.code === "WEB_READ_TIMEOUT" ? 30_000 : KEYLESS_PROVIDER_COOLDOWN_MS;
          cooldowns.set(candidate.id, now() + Math.min(cooldown, KEYLESS_PROVIDER_COOLDOWN_MAX_MS));
        } else {
          last = { ok: false, code: "WEB_READ_NO_EVIDENCE", message: "没有读取到可用的网页正文证据。" };
        }
      }
      return last ?? { ok: false, code: "WEB_READ_FAILED", message: "网页读取失败，请稍后重试。" };
    },
  };

  return {
    provider: evidenceProvider,
    reset: () => cooldowns.clear(),
  };
}

async function runEvidenceAttempt(
  provider: KiroWebEvidenceProvider,
  request: KiroWebEvidenceRequest,
  outerSignal: AbortSignal | undefined,
  timeoutMs: number
): Promise<KiroWebEvidenceOutcome> {
  if (outerSignal?.aborted) {
    return { ok: false, code: "WEB_READ_TIMEOUT", message: "网页读取超时，请稍后重试。" };
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onOuterAbort = () => controller.abort();
  outerSignal?.addEventListener("abort", onOuterAbort, { once: true });
  try {
    return await provider.extract(request, { apiKey: "", signal: controller.signal });
  } catch {
    return {
      ok: false,
      code: timedOut ? "WEB_READ_TIMEOUT" : "WEB_READ_FAILED",
      message: timedOut ? "网页读取超时，请稍后重试。" : "网页读取失败，请稍后重试。",
    };
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", onOuterAbort);
  }
}
