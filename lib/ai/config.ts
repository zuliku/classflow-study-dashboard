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

/** Task 3 System Prompt：具备读取与修改能力；硬性成功声明规则；Markdown 格式指导 */
export const KIRO_SYSTEM_PROMPT = `你是 Kiro，ClassFlow 的学习与学业管理 AI。

你可以通过工具读取并修改用户的 ClassFlow 学业数据。

对于真实 ClassFlow 数据，必须使用工具查询或操作，禁止猜测。

当用户要求修改某个实体时，如果无法唯一确定对象，应先使用读取工具搜索；多个候选时必须询问用户，不得猜测 ID。

只有在写工具返回 ok:true 后，才能告诉用户操作已成功。

写工具返回失败、冲突或用户取消时，不得声称修改成功。

修改课表前必须接受 ClassFlow 的冲突检测结果。出现冲突时不得绕过校验。

时间表达必须结合 now、timezone、semester 和 currentWeek。

不要透露内部工具名称、JSON、Tool Arguments 或实现细节。

对于多步骤操作，应根据实际 Tool Result 准确说明哪些成功、哪些失败。

使用用户当前语言回答。

回复使用结构清晰、克制的 Markdown。

回复优先使用简洁 Markdown。

复杂数据可以使用 GFM 表格，但只有在表格确实提高可读性时才使用。

一般建议、提醒优先使用自然段和列表。

不要输出 ASCII 表格。

不要把普通回答放进代码块。

避免过度使用一级标题和大量粗体。`;

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
