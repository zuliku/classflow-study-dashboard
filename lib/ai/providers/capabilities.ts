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
  /** 该模型 vision 的 MIME 白名单；undefined = 无额外限制（历史行为） */
  visionMimeTypes?: string[];
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
    visionMimeTypes: def.capabilities.visionMimeTypes,
    reasoning: def.capabilities.reasoning ?? getReasoningCapability(null, input.custom),
  };
}

/**
 * Vision MIME gate（纯函数，发送前调用）：
 * - vision=false → false
 * - vision=true + visionMimeTypes undefined → true（历史行为，无额外限制）
 * - vision=true + visionMimeTypes 声明 → includes(mimeType)
 * 浏览器 File.type 可能为空：仅在 visionMimeTypes 已声明时按扩展名做有限映射
 * （.jpg/.jpeg → image/jpeg；.png → image/png）。绝不把 .webp 伪装成 JPEG。
 */
export function isVisionMimeSupported(capability: ResolvedModelCapabilities, mimeType: string | undefined, fileName?: string): boolean {
  if (!capability.vision) return false;
  if (!capability.visionMimeTypes) return true;
  if (mimeType && capability.visionMimeTypes.includes(mimeType)) return true;
  // File.type 为空时的有限扩展名兜底（仅当白名单已声明）
  if (!mimeType && fileName) {
    const lower = fileName.toLowerCase();
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return capability.visionMimeTypes.includes("image/jpeg");
    if (lower.endsWith(".png")) return capability.visionMimeTypes.includes("image/png");
  }
  return false;
}
