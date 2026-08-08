import { AI, normalizeBaseURL } from "@/lib/ai/config";
import { AIError } from "@/lib/ai/errors";
import { AIProviderConfig } from "@/lib/ai/providers/types";

/**
 * Custom OpenAI-compatible Base URL 校验（SSRF 防护，纯函数，单独测试）。
 * 只允许 https；拒绝 localhost / 私网 / link-local / 环回等地址。
 * 返回错误码字符串（INVALID_CUSTOM_URL 或具体原因）；合法返回 null。
 */
export function validateCustomBaseURL(raw: string): string | null {
  const url = normalizeBaseURL(raw);
  if (!url) return "EMPTY_URL";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "INVALID_URL";
  }

  if (parsed.protocol !== "https:") return "NOT_HTTPS";
  if (parsed.username || parsed.password) return "USERINFO";

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  // IPv6 文本归一：去掉 zone id
  const hostForIp = host.split("%")[0];

  if (host === "localhost" || host.includes("localhost")) return "LOCALHOST";
  if (host.endsWith(".localhost")) return "LOCALHOST";

  // IPv4 / IPv6 地址段判断
  const ipv4 = parseIPv4(hostForIp);
  if (ipv4) {
    if (ipv4 === "127.0.0.1" || ipv4.startsWith("127.")) return "LOOPBACK";
    if (ipv4 === "0.0.0.0") return "LOOPBACK";
    if (ipv4 === "10." || ipv4.startsWith("10.")) return "PRIVATE";
    if (ipv4 === "192.168." || ipv4.startsWith("192.168.")) return "PRIVATE";
    if (ipv4 === "169.254." || ipv4.startsWith("169.254.")) return "LINK_LOCAL";
    const [a, b] = ipv4.split(".").map(Number);
    if (a === 172 && b >= 16 && b <= 31) return "PRIVATE";
    return null;
  }
  if (/^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(hostForIp)) {
    if (hostForIp === "::1" || hostForIp === "0:0:0:0:0:0:0:1") return "LOOPBACK";
    if (hostForIp === "::" || hostForIp === "0:0:0:0:0:0:0:0") return "LOOPBACK";
    if (hostForIp.startsWith("fe80") || hostForIp.startsWith("fc") || hostForIp.startsWith("fd")) {
      return "PRIVATE";
    }
    return null;
  }
  return null; // 域名：放行（轻量防护，DNS 重绑定不做深度防御）
}

/** 仅用于 IPv4 匹配的简单解析；非纯 IPv4 返回 null */
function parseIPv4(host: string): string | null {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  const parts = host.split(".");
  if (parts.some((p) => Number(p) > 255)) return null;
  return host;
}

export function getCustomOpenAIConfig(input: {
  apiKey: string;
  baseURL: string;
}): AIProviderConfig {
  const baseURL = normalizeBaseURL(input.baseURL);
  return {
    baseURL: baseURL || AI.DEEPSEEK_BASE_URL,
    apiKey: input.apiKey,
    // 不自动跟随 redirect，避免跳转指向私网地址（SSRF）
    noRedirect: true,
  };
}

export function assertCustomBaseURLValid(baseURL: string): void {
  const reason = validateCustomBaseURL(baseURL);
  if (reason) {
    throw new AIError(
      "INVALID_CUSTOM_URL",
      reason === "NOT_HTTPS"
        ? "仅支持 https:// 地址"
        : "该地址不在允许范围内（私网 / 本机地址被禁止）"
    );
  }
}

export { normalizeBaseURL };
