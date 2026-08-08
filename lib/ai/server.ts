import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { AIProviderConfig } from "@/lib/ai/providers/types";

/** Server-only：构造 OpenAI Chat Completions provider 实例（chat/test route 共用） */
export function createChatProvider(cfg: AIProviderConfig) {
  return createOpenAICompatible({
    name: "classflow-kiro",
    baseURL: cfg.baseURL,
    apiKey: cfg.apiKey ?? "",
    // Custom Provider：不自动跟随 redirect，避免 SSRF 跳转到私网地址
    fetch: cfg.noRedirect
      ? (input, init) =>
          fetch(input, {
            ...init,
            redirect: "manual",
          } as RequestInit)
      : undefined,
  });
}

/** 请求体校验（chat / test 共用）：非法返回错误信息字符串 */
export function validateAIChatBody(body: unknown): {
  ok: true;
  provider: "opencode-go" | "deepseek" | "custom-openai";
  model: string;
  apiKey: string;
  customConfig?: { providerName: string; baseURL: string; model: string };
  messages?: unknown;
  timeoutMs?: number;
} | { ok: false; code: string; message: string } {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const provider = b.provider;
  if (provider !== "opencode-go" && provider !== "deepseek" && provider !== "custom-openai") {
    return { ok: false, code: "UNKNOWN", message: "未知的 AI 服务。" };
  }
  if (typeof b.model !== "string" || !b.model.trim()) {
    return { ok: false, code: "MODEL_NOT_FOUND", message: "未选择模型。" };
  }
  if (typeof b.apiKey !== "string" || !b.apiKey.trim()) {
    return { ok: false, code: "INVALID_API_KEY", message: "缺少 API Key。" };
  }
  const custom = (typeof b.customConfig === "object" && b.customConfig !== null ? b.customConfig : {}) as Record<string, unknown>;
  return {
    ok: true,
    provider,
    model: b.model.trim(),
    apiKey: b.apiKey.trim(),
    customConfig: {
      providerName: typeof custom.providerName === "string" ? custom.providerName : "",
      baseURL: typeof custom.baseURL === "string" ? custom.baseURL : "",
      model: typeof custom.model === "string" ? custom.model : "",
    },
    messages: b.messages,
    timeoutMs: typeof b.timeoutMs === "number" && b.timeoutMs > 0 ? b.timeoutMs : undefined,
  };
}

/** 超时 AbortController（chat/test 共用） */
export function createTimeoutController(ms: number, external: AbortSignal): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), ms);
  if (external.aborted) controller.abort();
  external.addEventListener("abort", () => controller.abort(), { once: true });
  return {
    signal: controller.signal,
    done: () => clearTimeout(timer),
  };
}
