/**
 * QQ Token Error Mapper — Task 13D pure function for testability
 * Maps TokenManager errors to ChannelError codes with sanitized messages
 */

export type QQTokenErrorCode = "QQ_AUTH_FAILED" | "QQ_RATE_LIMITED" | "QQ_NETWORK_ERROR" | "QQ_GATEWAY_DISCONNECTED";

export function sanitizeTokenErrorMessage(raw: string): string {
  // Remove secrets from message
  return raw
    .replace(/appSecret/gi, "[redacted]")
    .replace(/access_token/gi, "[redacted]")
    .replace(/Authorization/gi, "[redacted]")
    .replace(/credentialRef/gi, "[redacted]")
    .replace(/secret/gi, "[redacted]")
    .slice(0, 300);
}

export function mapQQTokenError(e: unknown): { code: QQTokenErrorCode; message: string } {
  const raw = e instanceof Error ? e.message : String(e);
  const lower = raw.toLowerCase();

  // Try to parse JSON code first (from TokenManager or our own throw)
  try {
    const parsed = JSON.parse(raw) as { code?: string; message?: string };
    if (parsed.code === "QQ_AUTH_FAILED") return { code: "QQ_AUTH_FAILED", message: sanitizeTokenErrorMessage(parsed.message ?? raw) };
    if (parsed.code === "QQ_RATE_LIMITED") return { code: "QQ_RATE_LIMITED", message: sanitizeTokenErrorMessage(parsed.message ?? raw) };
    if (parsed.code === "QQ_NETWORK_ERROR") return { code: "QQ_NETWORK_ERROR", message: sanitizeTokenErrorMessage(parsed.message ?? raw) };
    if (parsed.code === "QQ_GATEWAY_DISCONNECTED") return { code: "QQ_GATEWAY_DISCONNECTED", message: sanitizeTokenErrorMessage(parsed.message ?? raw) };
  } catch {}

  // AUTH cases: 400,401,403, Failed to get access_token, invalid appId/secret/credential, secret/access_token
  if (
    lower.includes("400") ||
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("failed to get access_token") ||
    lower.includes("invalid appid") ||
    lower.includes("invalid secret") ||
    lower.includes("credential") ||
    lower.includes("secret") ||
    lower.includes("access_token") ||
    lower.includes("auth") ||
    raw.includes("QQ_AUTH_FAILED")
  ) {
    // But need to ensure 429 not misclassified as 400
    // Check 429 first before 400? 429 contains 400? No, 429 does not contain 400, but contains 29. So safe.
    // However "400" check would also match "100001"? No, 100001 does not contain 400.
    // So order: check rate limit first, then auth
    if (lower.includes("429") || lower.includes("rate") || lower.includes("too many requests") || lower.includes("100001")) {
      return { code: "QQ_RATE_LIMITED", message: "请求过于频繁" };
    }
    return { code: "QQ_AUTH_FAILED", message: "QQ 机器人认证失败" };
  }

  // Rate limit: 429, rate limited, Too many requests, 100001
  if (lower.includes("429") || lower.includes("rate limited") || lower.includes("too many requests") || lower.includes("100001") || lower.includes("rate")) {
    return { code: "QQ_RATE_LIMITED", message: "请求过于频繁" };
  }

  // Network: Network error, AbortError, timeout, ETIMEDOUT, ECONNREFUSED, ECONNRESET, ENOTFOUND, EAI_AGAIN
  if (
    lower.includes("network error") ||
    lower.includes("aborterror") ||
    lower.includes("abort") ||
    lower.includes("timeout") ||
    lower.includes("etimedout") ||
    lower.includes("econnrefused") ||
    lower.includes("econnreset") ||
    lower.includes("enotfound") ||
    lower.includes("eai_again") ||
    lower.includes("econn") ||
    lower.includes("network")
  ) {
    return { code: "QQ_NETWORK_ERROR", message: "网络连接失败" };
  }

  // Gateway disconnected
  if (lower.includes("gateway") || lower.includes("disconnected")) {
    return { code: "QQ_GATEWAY_DISCONNECTED", message: "网关连接失败" };
  }

  // Unknown fallback -> NETWORK, sanitized
  return { code: "QQ_NETWORK_ERROR", message: sanitizeTokenErrorMessage(raw) || "网络连接失败" };
}
