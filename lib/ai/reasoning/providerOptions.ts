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
 * 保守策略（Part 1 + Reasoning Phase 2）：
 * - DeepSeek official：明确声明 reasoning capability（deepseek-thinking）。
 *   default → thinking disabled（历史稳定行为）；high/max → thinking enabled + reasoning_effort。
 * - OpenCode Go（代理 Provider）：对具体模型的 reasoning/tool calling 兼容行为未逐模型验证前，
 *   capability 一律 fixed（default only），绝不根据模型名推断。
 * - Custom OpenAI：仅当 custom.reasoningEffort === true（用户显式声明）才标记可调，
 *   mechanism = "effort"（@ai-sdk/openai-compatible 支持 reasoningEffort 字符串）。
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
    case "deepseek-thinking": {
      // DeepSeek V4 官方 Thinking Mode（OpenAI-format）：
      // thinking: { type: "enabled" } + reasoning_effort（官方有效档位 high / max）。
      // effort 已经 normalize（low/medium 不在 supportedEfforts → default → 已提前 return）。
      return {
        thinking: { type: "enabled" },
        reasoningEffort: effort === "max" ? "max" : "high",
      };
    }
    case "openai-responses-effort": {
      // @ai-sdk/openai Responses：providerOptions.openai.reasoningEffort
      // → request body reasoning.effort（4.0.42 schema：string，无 enum 限制）。
      // effort 已 normalize（仅 capability 声明的档位到达这里；default 已提前 return）。
      return { reasoningEffort: effort };
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

/**
 * DeepSeek Thinking Mode 不接受 tool_choice（不满足约束可能返回 400）。
 * Final Answer Boundary 已通过 finalTools={} / activeTools=[] 关闭全部工具，
 * 此时只依赖空 tools，不再额外发送 toolChoice:"none"。
 * 仅 DeepSeek 官方 + high/max（normalize 后）返回 true；其他 Provider 行为不变。
 */
export function shouldOmitToolChoice(input: {
  definition: AIModelDefinition | null;
  custom?: AICustomConfig;
  effort: KiroReasoningEffort;
}): boolean {
  const capability = getReasoningCapability(input.definition, input.custom);
  const effort = normalizeReasoningEffort(capability, input.effort);
  return (
    input.definition?.provider === "deepseek" &&
    capability.mechanism === "deepseek-thinking" &&
    (effort === "high" || effort === "max")
  );
}

/**
 * providerOptions envelope（按 adapter 返回正确 key）：
 * - openai-chat（@ai-sdk/openai-compatible）/ anthropic-messages（@ai-sdk/anthropic）：
 *   读取 name 一致的 key "classflow-kiro"
 * - openai-responses（@ai-sdk/openai 4.0.42 实测）：Responses LanguageModel 固定读取
 *   providerOptions["openai"]（config.provider 含 azure 时为 "azure"），不读 name。
 * 返回 undefined = 无 verified reasoning options（default / 不可调）。
 */
export function resolveReasoningProviderOptionsEnvelope(input: {
  definition: AIModelDefinition | null;
  custom?: AICustomConfig;
  effort: KiroReasoningEffort;
}): Record<string, unknown> | undefined {
  const options = resolveReasoningProviderOptions(input);
  if (!options) return undefined;
  if (input.definition?.transport === "openai-responses") {
    return { openai: options };
  }
  return { "classflow-kiro": options };
}
