import { AIProviderId, AIProviderConfig, AITransport } from "@/lib/ai/providers/types";

/** 全局 AI 常量（唯一来源） */
export const AI = {
  /** OpenCode Go 统一 endpoint（openai-chat → /chat/completions；anthropic-messages → /messages） */
  OPENCODE_BASE_URL: "https://opencode.ai/zen/go/v1",
  OPENCODE_MODELS_URL: "https://opencode.ai/zen/go/v1/models",
  DEEPSEEK_BASE_URL: "https://api.deepseek.com",
  /**
   * Chat 流式 turn 总预算（毫秒）。
   * 这是整个 turn 的 wall-clock 上限（含自动续跑的多段请求），不是单请求 idle 超时：
   * 客户端断开已通过 req.signal 即时取消；30s 曾把正常长回答 / reasoning 模型
   * 的流式中途掐断（错误 part）。5 分钟仍保证进程不会永久挂起。
   */
  CHAT_TIMEOUT_MS: 300_000,
  /** 测试连接超时 */
  TEST_TIMEOUT_MS: 10_000,
  /** 日常 Kiro Chat 输出上限（快速响应优先，不设极端大值） */
  CHAT_MAX_OUTPUT_TOKENS: 2048,
} as const;

/**
 * Kiro System Prompt — Prompt V2 Core（五层职责结构，见 lib/ai/prompts/kiroSystemPrompt.ts）。
 * 三档回答深度由 responsePreference.ts 动态提供（# Answer Quality Contract），不在此静态写入。
 */
export { KIRO_SYSTEM_PROMPT } from "@/lib/ai/prompts/kiroSystemPrompt";

/** Custom Base URL 归一化：允许用户粘贴完整 /chat/completions，避免拼接重复 */
export function normalizeBaseURL(raw: string): string {
  const url = (raw || "").trim().replace(/\/+$/, "");
  if (url.endsWith("/chat/completions")) {
    return url.slice(0, -"/chat/completions".length).replace(/\/+$/, "");
  }
  return url;
}

export type { AIProviderId, AIProviderConfig, AITransport };
