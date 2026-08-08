import { getModelsForProvider } from "@/lib/ai/providers/registry";
import { AICustomConfig, AIProviderId } from "@/lib/ai/providers/types";

export interface ResolvedModelCapabilities {
  streaming: boolean;
  tools: boolean;
  vision: boolean;
  fileParts: boolean;
  pdf: boolean;
}

/**
 * 当前模型能力（真实约束）：
 * - 内置 Provider：来自 Registry 明确配置
 * - Custom Provider：默认保守（全 false），除非用户显式开启
 * 绝不假设 OpenAI-compatible 就等于支持图片。
 */
export function getModelCapabilities(input: {
  provider: AIProviderId;
  model: string;
  custom?: AICustomConfig;
}): ResolvedModelCapabilities {
  if (input.provider === "custom-openai") {
    return {
      streaming: true,
      tools: true,
      vision: input.custom?.vision === true,
      fileParts: input.custom?.fileParts === true,
      pdf: false,
    };
  }
  const def = getModelsForProvider(input.provider).find((m) => m.id === input.model);
  if (!def) return { streaming: true, tools: true, vision: false, fileParts: false, pdf: false };
  return {
    streaming: def.capabilities.streaming,
    tools: def.capabilities.tools,
    vision: def.capabilities.vision,
    fileParts: def.capabilities.fileParts,
    pdf: def.capabilities.pdf === true,
  };
}
