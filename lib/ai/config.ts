import { AIProviderId, AIProviderConfig, AIModelDefinition, AITransport } from "@/lib/ai/providers/types";

/** 全局 AI 常量（唯一来源） */
export const AI = {
  /** OpenCode Go Chat Completions endpoint */
  OPENCODE_BASE_URL: "https://opencode.ai/zen/go/v1",
  OPENCODE_MODELS_URL: "https://opencode.ai/zen/go/v1/models",
  DEEPSEEK_BASE_URL: "https://api.deepseek.com",
  /** Chat 请求超时（毫秒） */
  CHAT_TIMEOUT_MS: 30_000,
  /** 测试连接超时 */
  TEST_TIMEOUT_MS: 10_000,
  /** 日常 Kiro Chat 输出上限（快速响应优先，不设极端大值） */
  CHAT_MAX_OUTPUT_TOKENS: 2048,
} as const;

/** Task 1 极简 System Prompt：普通对话 + 学习辅助，无数据/工具能力声明 */
export const KIRO_SYSTEM_PROMPT = `你是 Kiro，ClassFlow 的学习与学业管理 AI。

当前阶段你可以进行普通对话和学习辅助，但尚未获得 ClassFlow 学业数据与操作工具。

不要声称自己已经读取、创建、修改或删除 ClassFlow 中的任何课程、课表、任务、DDL 或小组数据。

如果用户要求你操作 ClassFlow，应明确说明该操作能力尚未接入，而不是假装执行成功。

回答使用用户当前使用的语言，保持简洁、自然、清晰。`;

/** Task 1 明确不支持的 OpenCode Go 模型（走其他 transport） */
export const OPENCODE_NON_CHAT_MODEL_IDS: string[] = [
  "gpt-5.6-luna",
  "minimax-m3",
  "qwen3.8-max",
];

/** Custom Base URL 归一化：允许用户粘贴完整 /chat/completions，避免拼接重复 */
export function normalizeBaseURL(raw: string): string {
  const url = (raw || "").trim().replace(/\/+$/, "");
  if (url.endsWith("/chat/completions")) {
    return url.slice(0, -"/chat/completions".length).replace(/\/+$/, "");
  }
  return url;
}

/** 当前 Task 支持与否（仅 openai-chat transport） */
export function isTask1Supported(model: Pick<AIModelDefinition, "transport">): boolean {
  return model.transport === "openai-chat";
}

export type { AIProviderId, AIProviderConfig, AITransport };
