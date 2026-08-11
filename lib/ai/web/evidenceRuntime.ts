/**
 * Task 18C：Kiro Evidence Runtime —— Native-first 网页证据执行层。
 *
 * 职责 ONLY：
 *   Native Reader（readNativeWebSource）→ fallback（KiroWebEvidenceProvider）→ 统一 KiroWebEvidenceOutcome
 *
 * 不包含：Turn limit / trusted source resolution / Citation / UI / History。
 *
 * 安全规则：
 * - 所有网页 bytes 只来自 Native Reader（内部 safeWebFetch），Policy Blocked 是最终拒绝，
 *   绝不把同一 URL 交给 fallback（fallback 不能成为绕过 Safety Layer 的通道）
 * - fallback credential 惰性解析：只有真的需要 fallback 才调用 resolveFallbackCredential()
 * - Native 成功 source 永不重新 fallback；最终按 request.sources 顺序合并、sourceId 去重
 * - 不向 Agent 暴露 backend（native / tavily / fallback）信息
 */
import { readNativeWebSource, shouldFallbackNativeWebRead, KiroNativeWebReadOutcome } from "@/lib/ai/web/native/reader";
import { debugKiroWebRead } from "@/lib/ai/web/native/debug";
import { KiroWebEvidenceProvider } from "@/lib/ai/web/provider";
import {
  KiroWebEvidenceOutcome,
  KiroWebEvidenceSource,
  KiroWebSearchCredentialCheckOutcome,
  KiroWebSearchErrorCode,
} from "@/lib/ai/web/types";
import { KiroWebSearchCredentialResult } from "@/lib/ai/web/credentials";

export interface KiroEvidenceRuntimeRequest {
  sources: { sourceId: string; url: string }[];
  query?: string;
  signal?: AbortSignal;
}

export interface KiroEvidenceRuntimeDeps {
  nativeReader?: typeof readNativeWebSource;
  fallbackProvider: KiroWebEvidenceProvider;
  resolveFallbackCredential: () => KiroWebSearchCredentialResult;
}

export type KiroEvidenceRuntimeOutcome =
  | { ok: true; sources: KiroWebEvidenceSource[] }
  | { ok: false; code: KiroWebSearchErrorCode; message: string };

/** 诊断用 hostname（只记录 host） */
function hostOfSource(request: KiroEvidenceRuntimeRequest, sourceId: string): string {
  const source = request.sources.find((s) => s.sourceId === sourceId);
  if (!source) return "";
  try {
    return new URL(source.url).hostname;
  } catch {
    return "";
  }
}

/** Native success → Kiro Evidence Source；url/title/domain 由 Tool 层 trustedById 补全（这里是空值占位） */
function nativeToEvidenceSource(
  native: { sourceId: string; chunks: { text: string }[]; truncated: boolean },
  requestUrl: string
): KiroWebEvidenceSource {
  return {
    sourceId: native.sourceId,
    url: requestUrl, // 原始可信 Source URL；finalUrl 只是内部 metadata，绝不成为 Citation URL
    title: "",
    domain: "",
    chunks: native.chunks,
    truncated: native.truncated,
  };
}

/** 窄化：取某 source 的 Native success outcome（null = 未成功） */
function nativeSuccessOf(
  sourceId: string,
  nativeById: Map<string, KiroNativeWebReadOutcome>
): Extract<KiroNativeWebReadOutcome, { ok: true }> | null {
  const outcome = nativeById.get(sourceId);
  return outcome?.ok ? outcome : null;
}

function safeErrorMessage(code: KiroWebSearchErrorCode): string {
  const fallbackMessages: Partial<Record<KiroWebSearchErrorCode, string>> = {
    WEB_READ_TIMEOUT: "网页读取超时，请稍后重试。",
    WEB_READ_FAILED: "网页读取失败，请稍后重试。",
  };
  return fallbackMessages[code] ?? "网页读取未完成。";
}

/**
 * Native-first Evidence 执行：
 * 1) 并行（最多 2 个 source）Native Reader；throw 视为 PARSE_FAILED 走正常 fallback 规则
 * 2) 全部成功 → 直接返回（credential / fallback 0 调用）
 * 3) 只对 fallback-eligible 的失败 source 惰性解析 credential 并批量 extract
 * 4) 合并：Native 优先，按 request.sources 顺序、sourceId 去重
 *
 * 部分成功语义：Native 至少成功一个 source 时，fallback / credential 失败不整体失败。
 */
export async function resolveKiroWebEvidence(
  request: KiroEvidenceRuntimeRequest,
  deps: KiroEvidenceRuntimeDeps
): Promise<KiroEvidenceRuntimeOutcome> {
  const nativeReader = deps.nativeReader ?? readNativeWebSource;

  // ---- 1) Native-first（并发上限天然 = MAX_WEB_SOURCES_PER_READ = 2，不需要 pool/queue） ----
  const nativeResults = await Promise.all(
    request.sources.map(async (source) => {
      try {
        const out = await nativeReader({
          sourceId: source.sourceId,
          url: source.url,
          query: request.query,
          signal: request.signal,
        });
        return { sourceId: source.sourceId, outcome: out };
      } catch {
        // Native Reader 意外 throw：不 500，视为 PARSE_FAILED 走正常 fallback 规则
        return {
          sourceId: source.sourceId,
          outcome: { ok: false as const, code: "WEB_NATIVE_PARSE_FAILED" as const },
        };
      }
    })
  );

  const nativeById: Map<string, KiroNativeWebReadOutcome> = new Map(nativeResults.map((r) => [r.sourceId, r.outcome]));
  for (const { sourceId, outcome } of nativeResults) {
    debugKiroWebRead("runtime-native", {
      sourceId,
      host: hostOfSource(request, sourceId),
      result: outcome.ok ? "success" : outcome.code,
    });
  }
  const nativeSuccess = new Set<string>();
  for (const { sourceId, outcome } of nativeResults) {
    if (outcome.ok) nativeSuccess.add(sourceId);
  }

  // ---- 2) 全部 Native 成功 → 直接返回 ----
  if (nativeSuccess.size === request.sources.length) {
    return {
      ok: true,
      sources: request.sources
        .filter((s) => nativeById.get(s.sourceId)?.ok)
        .map((s) => {
          const native = nativeSuccessOf(s.sourceId, nativeById)!;
          return nativeToEvidenceSource(native, s.url);
        }),
    };
  }

  // ---- 3) fallback-eligible 失败 source（Policy Blocked 绝不 fallback） ----
  const fallbackSources = request.sources.filter((s) => {
    const outcome = nativeById.get(s.sourceId);
    return outcome !== undefined && !outcome.ok && shouldFallbackNativeWebRead(outcome.code);
  });

  let fallbackEvidence: KiroWebEvidenceSource[] = [];
  if (fallbackSources.length > 0) {
    debugKiroWebRead("runtime-fallback", { sourceIds: fallbackSources.map((s) => s.sourceId).join(","), attempted: true });
    // 惰性 credential：只有真的需要 fallback 才解析（Native 全成功路径 0 调用）
    const resolved = deps.resolveFallbackCredential();
    if (!resolved.ok) {
      debugKiroWebRead("runtime-fallback", { attempted: true, result: "credential-failed" });
      // credential 失败：Native 至少成功一个 → 保留 Native 证据，不整体失败
      if (nativeSuccess.size > 0) {
        return {
          ok: true,
          sources: request.sources
            .filter((s) => nativeSuccess.has(s.sourceId))
            .map((s) => {
              const native = nativeSuccessOf(s.sourceId, nativeById)!;
              return nativeToEvidenceSource(native, s.url);
            }),
        };
      }
      return { ok: false, code: resolved.code, message: resolved.message };
    }

    // 批量 fallback（一次调用，不逐个 extract）
    const outcome = await deps.fallbackProvider.extract(
      { sources: fallbackSources.map((s) => ({ sourceId: s.sourceId, url: s.url })), query: request.query },
      { apiKey: resolved.apiKey, signal: request.signal }
    );
    if (outcome.ok) {
      fallbackEvidence = outcome.sources;
      debugKiroWebRead("runtime-fallback", { attempted: true, result: "success", sources: outcome.sources.length });
    } else if (nativeSuccess.size > 0) {
      // fallback 真实失败 + Native 部分成功 → 保留 Native 证据
      return {
        ok: true,
        sources: request.sources
          .filter((s) => nativeSuccess.has(s.sourceId))
          .map((s) => {
            const native = nativeSuccessOf(s.sourceId, nativeById)!;
            return nativeToEvidenceSource(native, s.url);
          }),
      };
    } else {
      // Native 全失败 + fallback 真实失败：传播 fallback safe error（不伪装成功）
      debugKiroWebRead("runtime-fallback", { attempted: true, result: "failure", code: outcome.code });
      return { ok: false, code: outcome.code, message: outcome.message };
    }
  } else if (request.sources.length > 0) {
    debugKiroWebRead("runtime-fallback", { sourceIds: request.sources.map((s) => s.sourceId).join(","), attempted: false, reason: "no-eligible-or-all-native" });
  }

  // ---- 4) 合并：Native 优先（成功者不再 fallback），按 request 顺序、sourceId 去重 ----
  const merged: KiroWebEvidenceSource[] = [];
  const seenIds = new Set<string>();
  const fallbackById = new Map(fallbackEvidence.map((s) => [s.sourceId, s]));
  for (const s of request.sources) {
    if (seenIds.has(s.sourceId)) continue;
    const native = nativeById.get(s.sourceId);
    if (native?.ok) {
      merged.push(nativeToEvidenceSource(native, s.url));
      seenIds.add(s.sourceId);
      continue;
    }
    const fb = fallbackById.get(s.sourceId);
    if (fb) {
      merged.push(fb);
      seenIds.add(fb.sourceId);
    }
  }

  return { ok: true, sources: merged };
}
