/** AI 错误归一化：把 Provider / SDK / 网络错误映射为稳定的 AIErrorCode。 */

export type AIErrorCode =
  | "INVALID_API_KEY"
  | "MODEL_NOT_FOUND"
  | "MODEL_UNAVAILABLE"
  | "UNSUPPORTED_TRANSPORT"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "INVALID_PROVIDER_RESPONSE"
  | "INVALID_CUSTOM_URL"
  | "CONTEXT_TOO_LARGE"
  | "UNKNOWN";

export class AIError extends Error {
  code: AIErrorCode;
  constructor(code: AIErrorCode, message?: string) {
    super(message);
    this.name = "AIError";
    this.code = code;
  }
}

/** 错误 → 友好文案（UI 直接使用） */
export const AI_ERROR_MESSAGES: Record<AIErrorCode, string> = {
  INVALID_API_KEY: "API Key 无效，请在设置中检查。",
  MODEL_NOT_FOUND: "模型不可用，请在设置中选择其他模型。",
  MODEL_UNAVAILABLE: "当前模型已不可用，请重新选择。",
  UNSUPPORTED_TRANSPORT: "当前模型使用的接口暂未支持。",
  RATE_LIMITED: "请求过于频繁，请稍后再试。",
  TIMEOUT: "请求超时，请重试。",
  PROVIDER_UNAVAILABLE: "服务无法连接，请检查网络或稍后再试。",
  INVALID_PROVIDER_RESPONSE: "服务返回异常，请稍后再试。",
  INVALID_CUSTOM_URL: "自定义服务地址无效。",
  CONTEXT_TOO_LARGE: "当前对话内容较长，Kiro 已尝试压缩上下文。可以新建对话后继续。",
  UNKNOWN: "发生了未知错误，请重试。",
};

function statusToCode(status: number): AIErrorCode {
  if (status === 401 || status === 403) return "INVALID_API_KEY";
  if (status === 404) return "MODEL_NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "PROVIDER_UNAVAILABLE";
  return "UNKNOWN";
}

function codeOf(maybeCode: string): AIErrorCode | null {
  return (Object.keys(AI_ERROR_MESSAGES) as AIErrorCode[]).includes(maybeCode as AIErrorCode)
    ? (maybeCode as AIErrorCode)
    : null;
}

/**
 * 归一化任意错误 → AIError（code 稳定、message 安全）。
 * 支持：AIError（自有）、AI SDK 的 APICallError（带 statusCode）、AbortError（超时）、
 * 以及服务端通过 getErrorMessage 下发的 code JSON。
 */
export function normalizeAIError(err: unknown): AIError {
  if (err instanceof AIError) return err;

  const e = err as {
    name?: string;
    message?: string;
    statusCode?: number;
    status?: number;
    errors?: { statusCode?: number; name?: string }[];
  } | null;
  if (!e) return new AIError("UNKNOWN");

  // AI SDK 重试耗尽（AI_RetryError）：取最后一次失败的 statusCode
  if (Array.isArray(e.errors) && e.errors.length > 0) {
    const last = e.errors[e.errors.length - 1];
    if (typeof last.statusCode === "number") {
      return new AIError(statusToCode(last.statusCode));
    }
  }

  // 服务端 getErrorMessage 下发的 { code, message }
  if (typeof e.message === "string" && e.message.startsWith("{")) {
    try {
      const parsed = JSON.parse(e.message) as { code?: string; message?: string };
      const code = parsed.code ? codeOf(parsed.code) : null;
      if (code) {
        return new AIError(code, parsed.message || AI_ERROR_MESSAGES[code]);
      }
    } catch {
      /* 非 JSON，继续走其他分支 */
    }
  }

  // AbortError / TimeoutError → TIMEOUT
  if (e.name === "AbortError" || e.name === "TimeoutError") return new AIError("TIMEOUT");
  if (typeof e.message === "string" && /timed out|timeout|etimedout|aborted/i.test(e.message)) {
    return new AIError("TIMEOUT");
  }

  // AI SDK APICallError：带 statusCode
  const status =
    typeof e.statusCode === "number"
      ? e.statusCode
      : typeof e.status === "number"
      ? e.status
      : undefined;
  if (typeof status === "number") return new AIError(statusToCode(status));

  // 常见文本特征兜底
  const msg = (e.message || "").toLowerCase();
  if (msg.includes("401") || msg.includes("unauthorized") || msg.includes("api key")) {
    return new AIError("INVALID_API_KEY");
  }
  if (msg.includes("429") || msg.includes("rate limit")) return new AIError("RATE_LIMITED");
  if (msg.includes("model not found") || msg.includes("404")) return new AIError("MODEL_NOT_FOUND");
  if (
    (msg.includes("context") || msg.includes("prompt")) &&
    (msg.includes("too large") || msg.includes("exceeded") || msg.includes("maximum") || msg.includes("too long") || msg.includes("length"))
  ) {
    return new AIError("CONTEXT_TOO_LARGE");
  }
  if (msg.includes("502") || msg.includes("503") || msg.includes("fetch failed")) {
    return new AIError("PROVIDER_UNAVAILABLE");
  }

  return new AIError("UNKNOWN");
}
