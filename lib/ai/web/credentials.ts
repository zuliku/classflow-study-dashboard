/**
 * Kiro Search — Credential Resolver（Task 14A）。
 *
 * 规则严格：
 * - mode === "server" → 只使用 process.env.KIRO_TAVILY_API_KEY
 * - mode === "byok"   → 只使用 userApiKey；缺失 / 无效 / 401 / 额度问题绝不 fallback 到 Server Key
 *
 * "Server 默认" 的含义：默认 credentialMode = server；不是 BYOK 失败后偷偷消耗 Server Key。
 */

import { KiroWebSearchCredentialMode, KiroWebSearchErrorCode } from "@/lib/ai/web/types";

/** Legacy ClassFlow-specific env 别名（Hotfix：向后兼容已有部署） */
export const KIRO_TAVILY_API_KEY_ENV = "KIRO_TAVILY_API_KEY";
/** Tavily 官方标准 env（Hotfix：服务端同时支持） */
export const TAVILY_API_KEY_ENV = "TAVILY_API_KEY";

export type KiroWebSearchCredentialResult =
  | { ok: true; apiKey: string; mode: KiroWebSearchCredentialMode }
  | { ok: false; code: KiroWebSearchErrorCode; message: string };

/**
 * Server Key Resolver（Hotfix）：
 * 优先级：1) KIRO_TAVILY_API_KEY（legacy 优先，不破坏已有部署）→ 2) TAVILY_API_KEY（标准）→ 3) ""。
 * 严禁 NEXT_PUBLIC_*（API Key 不能进客户端 bundle）；绝不 hardcode key。
 */
export function getServerWebSearchApiKey(): string {
  const legacy = (process.env[KIRO_TAVILY_API_KEY_ENV] ?? "").trim();
  if (legacy) return legacy;
  return (process.env[TAVILY_API_KEY_ENV] ?? "").trim();
}

/** Server Search 是否真正配置（只返回 boolean；绝不暴露 Key / prefix / 长度 / usage） */
export function isServerWebSearchConfigured(): boolean {
  return getServerWebSearchApiKey().length > 0;
}

export function resolveWebSearchCredential(input: {
  mode: KiroWebSearchCredentialMode;
  userApiKey?: string;
}): KiroWebSearchCredentialResult {
  if (input.mode === "server") {
    const key = getServerWebSearchApiKey();
    if (!key) {
      return {
        ok: false,
        code: "WEB_SEARCH_KEY_REQUIRED",
        message: "Kiro Search 服务端未配置，请使用自己的 Tavily API Key 或配置服务端搜索凭据。",
      };
    }
    return { ok: true, apiKey: key, mode: "server" };
  }
  // byok：只使用用户 Key；缺失 → 明确错误，绝不回落到 Server Key
  const key = (input.userApiKey ?? "").trim();
  if (!key) {
    return {
      ok: false,
      code: "WEB_SEARCH_KEY_REQUIRED",
      message: "请先在设置中填写 Kiro Search API Key。",
    };
  }
  return { ok: true, apiKey: key, mode: "byok" };
}

/* ---------------- BYOK sessionStorage（客户端） ---------------- */

const WEB_SEARCH_KEY_STORAGE = "classflow-web-search-key";

function canUseSessionStorage(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    sessionStorage.setItem("__classflow_test__", "1");
    sessionStorage.removeItem("__classflow_test__");
    return true;
  } catch {
    return false;
  }
}

/** 用户自己的 Kiro Search（Tavily）Key：只进 sessionStorage，绝不进入 localStorage / 备份 / 日志 */
export function getSessionWebSearchApiKey(): string {
  if (!canUseSessionStorage()) return "";
  return sessionStorage.getItem(WEB_SEARCH_KEY_STORAGE) ?? "";
}

export function setSessionWebSearchApiKey(apiKey: string): void {
  if (!canUseSessionStorage()) return;
  const trimmed = apiKey.trim();
  if (trimmed) sessionStorage.setItem(WEB_SEARCH_KEY_STORAGE, trimmed);
  else sessionStorage.removeItem(WEB_SEARCH_KEY_STORAGE);
}

export function clearSessionWebSearchApiKey(): void {
  if (!canUseSessionStorage()) return;
  sessionStorage.removeItem(WEB_SEARCH_KEY_STORAGE);
}
