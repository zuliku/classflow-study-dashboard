/**
 * Kiro Web Reader 诊断（Compatibility Hotfix）。
 * 只在 KIRO_WEB_DEBUG=1 时输出；生产不输出。
 *
 * 允许字段（白名单）：sourceId / hostname / phase / durationMs / addressFamily /
 * addressAttempt / status / contentType / contentEncoding / charsetSource /
 * nativeFailureCode / fallbackAttempted / fallbackResult。
 * 严禁：API Key / Authorization / Cookie / 网页 body / Evidence chunks / 聊天全文 /
 * Tavily key / 完整 URL（最多 hostname + 可选 pathname）/ raw Error.message。
 */

export function kiroWebDebugEnabled(): boolean {
  return (process.env.KIRO_WEB_DEBUG ?? "").trim() === "1";
}

type DebugField = string | number | boolean | undefined;

export function debugKiroWebRead(event: string, fields: Record<string, DebugField>): void {
  if (!kiroWebDebugEnabled()) return;
  const clean: Record<string, DebugField> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    clean[key] = value;
  }
  // eslint-disable-next-line no-console
  console.log(`[kiro:web-read] ${event}`, JSON.stringify(clean));
}
