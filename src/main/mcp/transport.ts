/**
 * MCP URL Security — Task 09
 * V1 默认 https, Developer Mode 才允许 http://127.0.0.1 / http://localhost
 * 拒绝 file/data/javascript/ftp, username/password, malformed, SSRF
 */

export type McpUrlValidationResult = { ok: true; url: URL } | { ok: false; reason: string };

const DENIED_PROTOCOLS = new Set(["file:", "data:", "javascript:", "ftp:", "vbscript:"]);

export function validateMcpUrl(raw: string, opts?: { allowLocalHttp?: boolean }): McpUrlValidationResult {
  if (!raw || typeof raw !== "string") return { ok: false, reason: "empty url" };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "malformed url" };
  }

  const protocol = parsed.protocol.toLowerCase();
  if (DENIED_PROTOCOLS.has(protocol)) {
    return { ok: false, reason: `denied protocol: ${protocol}` };
  }

  // 禁止 username/password
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "url must not contain username/password" };
  }

  // V1 默认只允许 https
  if (protocol === "https:") {
    return { ok: true, url: parsed };
  }

  if (protocol === "http:") {
    const host = parsed.hostname.toLowerCase();
    const isLocal = host === "127.0.0.1" || host === "localhost" || host === "::1";
    if (isLocal && opts?.allowLocalHttp) {
      return { ok: true, url: parsed };
    }
    return { ok: false, reason: "http only allowed for 127.0.0.1/localhost in developer mode" };
  }

  return { ok: false, reason: `disallowed protocol: ${protocol}` };
}

export function isValidMcpEndpoint(endpoint: string, opts?: { allowLocalHttp?: boolean }): boolean {
  return validateMcpUrl(endpoint, opts).ok;
}
