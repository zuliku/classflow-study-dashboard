import { AI } from "@/lib/ai/config";
import { AIModelDefinition, AIProviderConfig } from "@/lib/ai/providers/types";

/** DeepSeek 官方模型（Task 1 正式支持；默认 V4 Flash：速度/价格更适合日常 Kiro Chat） */
export const DEEPSEEK_MODELS: AIModelDefinition[] = [
  {
    id: "deepseek-v4-flash",
    name: "V4 Flash",
    provider: "deepseek",
    transport: "openai-chat",
    capabilities: { streaming: true, tools: true, vision: false, fileParts: false },
  },
  {
    id: "deepseek-v4-pro",
    name: "V4 Pro",
    provider: "deepseek",
    transport: "openai-chat",
    capabilities: { streaming: true, tools: true, vision: false, fileParts: false },
  },
];

export const DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-flash";

export function getDeepSeekConfig(apiKey: string): AIProviderConfig {
  return { baseURL: AI.DEEPSEEK_BASE_URL, apiKey };
}
