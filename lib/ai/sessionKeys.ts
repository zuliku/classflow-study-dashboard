import { AIProviderId } from "@/lib/ai/providers/types";

/**
 * API Key 会话存储：sessionStorage，关闭浏览器会话后消失。
 * 不进入 useAppStore / 备份 / 日志。按 provider 分别保存。
 */
const KEY_PREFIX = "classflow-ai-key:";

const PROVIDER_KEYS: Record<AIProviderId, string> = {
  "opencode-go": "opencode-go",
  deepseek: "deepseek",
  "custom-openai": "custom-openai",
};

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

export function getSessionApiKey(provider: AIProviderId): string {
  if (!canUseSessionStorage()) return "";
  return sessionStorage.getItem(KEY_PREFIX + PROVIDER_KEYS[provider]) ?? "";
}

export function setSessionApiKey(provider: AIProviderId, apiKey: string): void {
  if (!canUseSessionStorage()) return;
  const trimmed = apiKey.trim();
  if (trimmed) sessionStorage.setItem(KEY_PREFIX + PROVIDER_KEYS[provider], trimmed);
  else sessionStorage.removeItem(KEY_PREFIX + PROVIDER_KEYS[provider]);
}

export function hasSessionApiKey(provider: AIProviderId): boolean {
  return getSessionApiKey(provider).length > 0;
}
