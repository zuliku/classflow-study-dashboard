import {
  AIProviderId,
  AICustomConfig,
  AIProviderConfig,
  AIModelDefinition,
  AIModelVendor,
} from "@/lib/ai/providers/types";
import { DEEPSEEK_MODELS, DEEPSEEK_DEFAULT_MODEL, getDeepSeekConfig } from "@/lib/ai/providers/deepSeek";
import {
  OPENCODE_CHAT_MODELS,
  OPENCODE_DEFAULT_MODEL,
  getOpenCodeGoConfig,
} from "@/lib/ai/providers/openCodeGo";
import {
  assertCustomBaseURLValid,
  getCustomOpenAIConfig,
} from "@/lib/ai/providers/customOpenAI";

/** Model Registry：模型 metadata 的唯一来源（Settings 与 Composer 共用，不在多处复制） */

export function getModelsForProvider(provider: AIProviderId): AIModelDefinition[] {
  switch (provider) {
    case "deepseek":
      return DEEPSEEK_MODELS;
    case "opencode-go":
      return OPENCODE_CHAT_MODELS;
    case "custom-openai":
      return [];
  }
}

export function getDefaultModel(provider: AIProviderId): string {
  switch (provider) {
    case "deepseek":
      return DEEPSEEK_DEFAULT_MODEL;
    case "opencode-go":
      return OPENCODE_DEFAULT_MODEL;
    case "custom-openai":
      return "";
  }
}

/** 当前设置下的展示模型名（Composer / Settings 共用） */
export function getActiveModelName(input: {
  provider: AIProviderId;
  model: string;
  customModel: string;
}): string {
  if (input.provider === "custom-openai") {
    return input.customModel ? input.customModel : "未设置模型";
  }
  const def = getModelsForProvider(input.provider).find((m) => m.id === input.model);
  if (def) return def.name;
  const fallback = getModelsForProvider(input.provider)[0];
  return fallback ? fallback.name : "选择模型";
}

/**
 * 模型 → 厂商（Logo）查找：UI 绝不根据模型名称猜厂商。
 * 已知模型返回明确 vendor；未知模型（如远端新增）返回 null → UI 使用 neutral fallback。
 */
export function getVendorForModelId(modelId: string): AIModelVendor | null {
  if (!modelId) return null;
  for (const def of [...DEEPSEEK_MODELS, ...OPENCODE_CHAT_MODELS]) {
    if (def.id === modelId) return def.vendor;
  }
  // 前缀兜底（仅覆盖已知厂商的命名空间，绝不猜厂商）
  if (modelId.startsWith("deepseek-")) return "deepseek";
  if (modelId.startsWith("kimi-")) return "kimi";
  if (modelId.startsWith("glm-")) return "zai";
  if (modelId.startsWith("grok-")) return "xai";
  if (modelId.startsWith("mimo-")) return "mimo";
  return null;
}

/** 当前选中模型的厂商（Composer 按钮 Logo） */
export function getActiveModelVendor(input: {
  provider: AIProviderId;
  model: string;
  customModel: string;
}): AIModelVendor | null {
  if (input.provider === "custom-openai") {
    return input.customModel ? null : null;
  }
  return getVendorForModelId(input.model);
}

/** Server 侧：根据设置构造 Provider 连接配置 */
export function getProviderConfig(input: {
  provider: AIProviderId;
  apiKey: string;
  custom?: AICustomConfig;
}): AIProviderConfig {
  switch (input.provider) {
    case "deepseek":
      return getDeepSeekConfig(input.apiKey);
    case "opencode-go":
      return getOpenCodeGoConfig(input.apiKey);
    case "custom-openai": {
      const baseURL = input.custom?.baseURL ?? "";
      assertCustomBaseURLValid(baseURL);
      return getCustomOpenAIConfig({ apiKey: input.apiKey, baseURL });
    }
  }
}

export { DEEPSEEK_DEFAULT_MODEL, OPENCODE_DEFAULT_MODEL };
export type { AIProviderId, AICustomConfig, AIProviderConfig, AIModelDefinition, AIModelVendor };
