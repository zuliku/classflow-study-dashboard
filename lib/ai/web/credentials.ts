/**
 * Kiro Search — Credential Resolver（Task 14A）。
 *
 * 规则严格：
 * - mode === "server" → Server Key（KIRO_TAVILY_API_KEY / TAVILY_API_KEY）优先；无 Key 时 keyless（可运营关闭）
 * - mode === "byok"   → 只使用 userApiKey / SecretVault ref；缺失 / 无效 / 401 / 额度问题绝不 fallback 到 Server Key 或 keyless
 *
 * "Server 默认" 的含义：默认 credentialMode = server；不是 BYOK 失败后偷偷消耗 Server Key。
 */

import {
  KiroWebSearchAccess,
  KiroWebSearchCredentialMode,
  KiroWebSearchErrorCode,
} from "@/lib/ai/web/types";

/** Legacy ClassFlow-specific env 别名（Hotfix：向后兼容已有部署） */
export const KIRO_TAVILY_API_KEY_ENV = "KIRO_TAVILY_API_KEY";
/** Tavily 官方标准 env（Hotfix：服务端同时支持） */
export const TAVILY_API_KEY_ENV = "TAVILY_API_KEY";
/** 运营/隐私安全阀：设为 1/true 时禁用所有 keyless hosted 搜索。 */
export const DISABLE_KEYLESS_WEB_SEARCH_ENV = "CLASSFLOW_DISABLE_KEYLESS_WEB_SEARCH";

/** SecretVault credentialRef 形态（cred_s_<uuid>）；只接受该形态，拒绝任意字符串。 */
const WEB_SEARCH_CREDENTIAL_REF_RE = /^cred_[A-Za-z0-9_-]{1,128}$/;

export function normalizeWebSearchCredentialRef(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return WEB_SEARCH_CREDENTIAL_REF_RE.test(trimmed) ? trimmed : undefined;
}

export type KiroWebSearchCredentialResult =
  | { ok: true; apiKey: string; mode: KiroWebSearchCredentialMode; kind?: "keyed" | "keyless" }
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

/** Keyless hosted 搜索是否被运营开关禁用（默认启用） */
export function isKeylessWebSearchAvailable(): boolean {
  const raw = (process.env[DISABLE_KEYLESS_WEB_SEARCH_ENV] ?? "").trim().toLowerCase();
  return raw !== "1" && raw !== "true";
}

/**
 * 解析本轮搜索访问能力：
 * - server：Server Key → keyless → (安全阀关闭时) KEY_REQUIRED
 * - byok：只认用户 Key；缺失/失败绝不回落到 Server Key 或 keyless
 */
export function resolveKiroWebSearchAccess(input: {
  mode: KiroWebSearchCredentialMode;
  userApiKey?: string;
}): KiroWebSearchAccess {
  if (input.mode === "server") {
    const key = getServerWebSearchApiKey();
    if (key) return { ok: true, kind: "keyed", apiKey: key, mode: "server" };
    if (isKeylessWebSearchAvailable()) return { ok: true, kind: "keyless", mode: "server" };
    return {
      ok: false,
      code: "WEB_SEARCH_KEY_REQUIRED",
      message: "Kiro Search 服务端未配置，请使用自己的 Tavily API Key 或配置服务端搜索凭据。",
    };
  }
  // byok：只使用用户 Key；缺失 → 明确错误，绝不回落到 Server Key / keyless
  const key = (input.userApiKey ?? "").trim();
  if (!key) {
    return {
      ok: false,
      code: "WEB_SEARCH_KEY_REQUIRED",
      message: "请先在设置中填写 Kiro Search API Key。",
    };
  }
  return { ok: true, kind: "keyed", apiKey: key, mode: "byok" };
}

/**
 * 兼容旧调用方的薄包装：
 * - keyed → 保留 apiKey/mode
 * - keyless → apiKey="" + kind:"keyless"（调用方必须显式分支，不能把空 key 当 Tavily Key 使用）
 * - 失败 → 原错误码/文案
 */
export function resolveWebSearchCredential(input: {
  mode: KiroWebSearchCredentialMode;
  userApiKey?: string;
}): KiroWebSearchCredentialResult {
  const access = resolveKiroWebSearchAccess(input);
  if (!access.ok) return access;
  return {
    ok: true,
    apiKey: access.kind === "keyed" ? access.apiKey : "",
    mode: access.mode,
    kind: access.kind,
  };
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
