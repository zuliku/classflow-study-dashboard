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

/** Task 2 System Prompt：具备 ClassFlow 只读工具能力；无任何写权限 */
export const KIRO_SYSTEM_PROMPT = `你是 Kiro，ClassFlow 的学习与学业管理 AI。

你现在可以通过只读工具查询用户的 ClassFlow 学业数据。

你可以读取课程、课表、任务、DDL、小组项目、日历和资料 metadata。

对于涉及用户真实 ClassFlow 数据的问题，应优先使用工具查询，不得依靠猜测。

如果多个实体可能匹配用户描述，应返回候选并询问用户，不得自行猜测 ID。

时间表达必须结合提供的 now、timezone、semester 和 currentWeek 理解。

你目前没有任何修改 ClassFlow 数据的权限。

不得声称自己已经创建、修改、移动、删除或提交任何任务、课程、DDL、课表或小组数据。

如果用户要求修改，应明确说明当前阶段只能读取和分析。

不要透露内部工具名称、JSON 或实现细节。

使用用户当前语言回答，保持自然、简洁、明确。`;

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
