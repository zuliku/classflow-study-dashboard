import { getModelsForProvider } from "@/lib/ai/providers/registry";
import { AICustomConfig, AIProviderId } from "@/lib/ai/providers/types";
import {
  getReasoningCapability,
} from "@/lib/ai/reasoning/providerOptions";
import { ReasoningCapability } from "@/lib/ai/reasoning/types";

export interface ResolvedModelCapabilities {
  streaming: boolean;
  tools: boolean;
  vision: boolean;
  fileParts: boolean;
  pdf: boolean;
  /** capability-driven reasoning（未声明 = fixed） */
  reasoning: ReasoningCapability;
}

/**
 * 当前模型能力（真实约束）：
 * - 内置 Provider：来自 Registry 明确配置
 * - Custom Provider：默认保守（全 false），除非用户显式开启
 * 绝不假设 OpenAI-compatible 就等于支持图片 / 支持 reasoning。
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
      reasoning: getReasoningCapability(null, input.custom),
    };
  }
  const def = getModelsForProvider(input.provider).find((m) => m.id === input.model);
  if (!def) {
    return { streaming: true, tools: true, vision: false, fileParts: false, pdf: false, reasoning: getReasoningCapability(null, input.custom) };
  }
  return {
    streaming: def.capabilities.streaming,
    tools: def.capabilities.tools,
    vision: def.capabilities.vision,
    fileParts: def.capabilities.fileParts,
    pdf: def.capabilities.pdf === true,
    reasoning: def.capabilities.reasoning ?? getReasoningCapability(null, input.custom),
  };
}
