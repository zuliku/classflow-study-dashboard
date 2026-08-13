/**
 * Kiro Server 公共工具：
 * - validateAIChatBody：chat / test / compact 共用请求体校验
 * - createTimeoutController：超时 AbortController
 * LanguageModel 构造统一走 lib/ai/providers/resolver.ts（resolveLanguageModel）。
 */

import { KiroResponsePreference, normalizeKiroResponsePreference } from "@/lib/ai/responsePreference";
import { normalizeWebPdfVisionModel } from "@/lib/ai/web/vision/models";
import { KiroReasoningEffort, REASONING_EFFORTS } from "@/lib/ai/reasoning/types";

/** 客户端可提交的推理 effort（非法 → default；客户端永远不能提交 providerOptions） */
function normalizeReasoningEffortInput(value: unknown): KiroReasoningEffort {
  return typeof value === "string" && (REASONING_EFFORTS as string[]).includes(value)
    ? (value as KiroReasoningEffort)
    : "default";
}

/** 请求体校验（chat / test / compact 共用）：非法返回错误信息字符串 */
export function validateAIChatBody(body: unknown): {
  ok: true;
  provider: "opencode-go" | "deepseek" | "custom-openai";
  model: string;
  apiKey: string;
  customConfig?: { providerName: string; baseURL: string; model: string };
  messages?: unknown;
  timeoutMs?: number;
  /** Intelligence V2 Task 1：回答偏好（可安全 fallback；非法/缺失 → dense，不报错） */
  responsePreference: KiroResponsePreference;
  /** 推理投入（capability-driven；客户端仅发 effort，server 归一 + 映射 provider options） */
  reasoningEffort: KiroReasoningEffort;
  /** Task 14：联网搜索配置（enabled / credentialMode / 仅 BYOK 带 userApiKey） */
  webSearchConfig?: { enabled?: boolean; credentialMode?: "server" | "byok"; apiKey?: string };
  /** Task 19C1：扫描 Web PDF Vision 配置（Provider 固定 OpenCode Go；19C2 才消费）。
   * 旧 Client 无该字段 → enabled=false（不会突然触发未来 Vision API）。
   * apiKey 只作为 transient server value：trim / 空值视为 undefined / 绝不写日志 / 不返回客户端。 */
  webPdfVisionConfig?: {
    enabled: boolean;
    model: string;
    apiKey?: string;
  };
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
  const webSearch = (typeof b.webSearchConfig === "object" && b.webSearchConfig !== null ? b.webSearchConfig : {}) as Record<string, unknown>;
  const vision = (typeof b.webPdfVisionConfig === "object" && b.webPdfVisionConfig !== null ? b.webPdfVisionConfig : {}) as Record<string, unknown>;
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
    responsePreference: normalizeKiroResponsePreference(b.responsePreference),
    reasoningEffort: normalizeReasoningEffortInput(b.reasoningEffort),
    webSearchConfig: {
      enabled: webSearch.enabled === true,
      credentialMode: webSearch.credentialMode === "byok" ? "byok" : "server",
      apiKey: typeof webSearch.apiKey === "string" ? webSearch.apiKey : undefined,
    },
    webPdfVisionConfig: {
      // 只有真正 boolean true 才接受；旧 Client 缺失 → false（不会触发未来 Vision API）
      enabled: vision.enabled === true,
      // arbitrary model id 无法穿透：非法 → 默认 mimo-v2.5
      model: normalizeWebPdfVisionModel(vision.model),
      apiKey: typeof vision.apiKey === "string" ? vision.apiKey.trim() || undefined : undefined,
    },
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
