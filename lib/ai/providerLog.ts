/**
 * Provider 错误安全日志（仅开发环境）。
 *
 * 只记录：HTTP status、provider error code / message、requestId、URL path。
 * 绝不记录：API Key、Authorization header、requestBody（可能含用户 Prompt / 文件内容）、完整 URL（可能含 query）。
 *
 * AI SDK 的 APICallError 嵌套在重试 / 流式错误里时，这里会沿 cause 链找最内层的真实 Provider 错误。
 */

type ProviderErrorLike = {
  name?: string;
  message?: string;
  statusCode?: number;
  status?: number;
  url?: string;
  responseBody?: string;
  responseHeaders?: Record<string, string>;
  cause?: unknown;
};

/** 把可能回显 key 的内容打码（防御 Provider 在 message 里回显请求内容） */
function redactSecrets(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***").replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***");
}

/** 只保留 URL pathname（query string 可能携带敏感参数） */
function safeUrlPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname;
  } catch {
    return "";
  }
}

function extractProviderInfo(e: ProviderErrorLike): {
  status?: number;
  code?: string;
  message?: string;
  requestId?: string;
} {
  const status =
    typeof e.statusCode === "number" ? e.statusCode : typeof e.status === "number" ? e.status : undefined;
  let code: string | undefined;
  let message: string | undefined;
  // OpenAI-compatible 错误体：{ error: { code?, type?, message? } }
  if (typeof e.responseBody === "string") {
    try {
      const parsed = JSON.parse(e.responseBody) as { error?: { code?: unknown; type?: unknown; message?: unknown } };
      if (parsed && typeof parsed.error === "object" && parsed.error !== null) {
        const err = parsed.error;
        code =
          typeof err.code === "string"
            ? err.code
            : typeof err.type === "string"
              ? err.type
              : undefined;
        message = typeof err.message === "string" ? err.message : undefined;
      }
    } catch {
      /* 非 JSON 错误体：用顶层 message */
    }
  }
  if (message === undefined && typeof e.message === "string") message = e.message;
  const requestId = e.responseHeaders?.["x-request-id"];
  return { status, code, message, requestId };
}

/**
 * 开发环境专用：打印安全的 Provider 错误摘要。
 * production 下为空操作（不产生任何输出）。
 */
export function logProviderError(context: string, err: unknown): void {
  if (process.env.NODE_ENV === "production") return;
  if (!err) return;

  let cur = err as ProviderErrorLike;
  // 沿 cause 链找到最内层的 APICallError（带 statusCode / responseBody）
  let guard = 0;
  while (cur && typeof cur === "object" && !cur.statusCode && !cur.responseBody && cur.cause && guard < 8) {
    cur = cur.cause as ProviderErrorLike;
    guard += 1;
  }

  const info = extractProviderInfo(cur);
  const urlPath = typeof cur.url === "string" ? safeUrlPath(cur.url) : "";
  console.error(
    `[kiro:provider] ${context} status=${info.status ?? "-"} code=${info.code ?? "-"} requestId=${info.requestId ?? "-"} url=${urlPath}\n` +
      `  provider message: ${redactSecrets(info.message ?? "-")}`
  );
}
