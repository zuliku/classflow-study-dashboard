/**
 * Kiro Search — SecretVault 凭据解析（server-only）。
 *
 * Renderer 只持有 credentialRef；Chat / Test 路由在主进程通过 SecretVault
 * resolve 明文，明文不经过 Renderer、不进日志、不进请求体（旧客户端 apiKey 仍兼容）。
 */
import {
  normalizeWebSearchCredentialRef,
  resolveKiroWebSearchAccess,
} from "@/lib/ai/web/credentials";
import type { KiroWebSearchAccess, KiroWebSearchCredentialMode } from "@/lib/ai/web/types";

export interface WebSearchSecretVaultLike {
  resolveSecretForProvider(credentialRef: string, expectedProvider: "tavily"): string;
}

/** 纯 helper：测试注入 fake vault；非法 ref / 不存在 / provider 不匹配 → null。 */
export function resolveStoredWebSearchKeyWithVault(
  credentialRef: string | undefined,
  vault: WebSearchSecretVaultLike | null | undefined
): string | null {
  const ref = normalizeWebSearchCredentialRef(credentialRef);
  if (!ref || !vault) return null;
  try {
    const key = vault.resolveSecretForProvider(ref, "tavily").trim();
    return key || null;
  } catch {
    return null;
  }
}

/**
 * Main-only 入口：动态 import 避免 Renderer bundle 引入 Electron SecretVault。
 * 任何失败 → null（调用方回落 sessionStorage Key 或返回 KEY_REQUIRED）。
 */
export async function resolveStoredWebSearchKey(
  credentialRef: string | undefined
): Promise<string | null> {
  const ref = normalizeWebSearchCredentialRef(credentialRef);
  if (!ref) return null;
  try {
    const { getRuntimeSecretVault } = await import("@/src/main/secrets/secretRuntime");
    return resolveStoredWebSearchKeyWithVault(ref, getRuntimeSecretVault());
  } catch {
    return null;
  }
}

/**
 * BYOK 路由统一入口：优先 SecretVault ref，ref 失效时回退旧客户端 apiKey。
 * server 模式忽略 ref；keyless 安全阀等语义仍由 resolveKiroWebSearchAccess 决定。
 */
export async function resolveKiroWebSearchAccessWithStoredRef(
  input: {
    mode: KiroWebSearchCredentialMode;
    userApiKey?: string;
    credentialRef?: string;
  },
  deps?: { resolveStoredKey?: (credentialRef: string | undefined) => Promise<string | null> }
): Promise<KiroWebSearchAccess> {
  if (input.mode !== "byok") {
    return resolveKiroWebSearchAccess({ mode: input.mode, userApiKey: input.userApiKey });
  }
  const resolveStoredKey = deps?.resolveStoredKey ?? resolveStoredWebSearchKey;
  const stored = input.credentialRef ? await resolveStoredKey(input.credentialRef) : null;
  return resolveKiroWebSearchAccess({
    mode: "byok",
    userApiKey: stored ?? input.userApiKey,
  });
}
