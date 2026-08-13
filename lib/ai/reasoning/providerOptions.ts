import {
  KiroReasoningEffort,
  ReasoningCapability,
  FIXED_REASONING,
} from "@/lib/ai/reasoning/types";
import { AIModelDefinition, AICustomConfig } from "@/lib/ai/providers/types";

/**
 * 能力驱动的 Reasoning Provider 映射（server-only 消费）。
 * 客户端只能发送 reasoningEffort；providerOptions 一律由 server 构建，绝不信任客户端。
 *
 * 保守策略（Part 1）：
 * - 内置 Provider（deepseek / opencode-go）：未对具体模型验证 reasoning 兼容前，
 *   capability 一律 fixed（default only）。
 * - Custom OpenAI：仅当 custom.reasoningEffort === true（用户显式声明）才标记可调，
 *   mechanism = "effort"（@ai-sdk/openai-compatible 支持 reasoningEffort 字符串）。
 * - DeepSeek official：transform 强制 thinking disabled（tool calling 兼容），永不可调。
 */

/** 从模型定义解析 ReasoningCapability（未声明 → fixed） */
export function getReasoningCapability(
  definition: AIModelDefinition | null,
  custom?: AICustomConfig
): ReasoningCapability {
  // custom-openai 没有静态 definition（resolve 返回 null）；由 custom 显式声明决定
  if (definition === null && custom) {
    return custom.reasoningEffort === true
      ? { adjustable: true, supportedEfforts: ["default", "low", "medium", "high"], mechanism: "effort" }
      : FIXED_REASONING;
  }
  if (definition?.provider === "custom-openai") {
    return custom?.reasoningEffort === true
      ? { adjustable: true, supportedEfforts: ["default", "low", "medium", "high"], mechanism: "effort" }
      : FIXED_REASONING;
  }
  return definition?.capabilities?.reasoning ?? FIXED_REASONING;
}

/** 归一化 effort：unsupported / 不可调 → "default" */
export function normalizeReasoningEffort(
  capability: ReasoningCapability,
  requested: KiroReasoningEffort | undefined
): KiroReasoningEffort {
  if (!capability.adjustable) return "default";
  if (!requested) return "default";
  return capability.supportedEfforts.includes(requested) ? requested : "default";
}

/**
 * 构建 provider options（仅当 verified capability 且 effort 非 default）。
 * 返回 undefined = 不添加任何覆盖（保持 provider 默认行为）。
 */
export function resolveReasoningProviderOptions(input: {
  definition: AIModelDefinition | null;
  custom?: AICustomConfig;
  effort: KiroReasoningEffort;
}): Record<string, unknown> | undefined {
  const capability = getReasoningCapability(input.definition, input.custom);
  const effort = normalizeReasoningEffort(capability, input.effort);
  if (effort === "default") return undefined;

  switch (capability.mechanism) {
    case "effort": {
      // @ai-sdk/openai-compatible: { reasoningEffort?: string }（openai-compatible 传输层）
      const value =
        effort === "low" ? "low" : effort === "high" ? "high" : "medium";
      return { reasoningEffort: value };
    }
    case "anthropic-effort":
      // 当前无已验证的 anthropic-messages 可调模型 → 保守不产出
      return undefined;
    case "thinking-budget":
      return undefined;
    case "fixed":
      return undefined;
  }
}
