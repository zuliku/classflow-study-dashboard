import { AIProviderId, AICustomConfig } from "@/lib/ai/providers/types";
import { getModelCapabilities } from "@/lib/ai/providers/capabilities";
import { KiroReasoningEffort } from "@/lib/ai/reasoning/types";

/**
 * requested vs effective：
 * - requested = Store 中的用户 preference（跨模型切换保留，不随模型变化重置）
 * - effective = 结合当前模型 capability 后真正生效的 effort（UI / Turn Snapshot 显示与发送值）
 *
 * 规则与 Server 的 normalizeReasoningEffort 一致：requested 不在当前 capability
 * 的 supportedEfforts 中（或模型不可调）→ "default"。
 * 不复制任何 provider 特定判断，全部依赖 capability。
 */
export function resolveEffectiveReasoningEffort(input: {
  provider: AIProviderId;
  model: string;
  custom?: AICustomConfig;
  requested: KiroReasoningEffort;
}): KiroReasoningEffort {
  const capability = getModelCapabilities({
    provider: input.provider,
    model: input.model,
    custom: input.custom,
  }).reasoning;
  if (!capability.adjustable) return "default";
  return capability.supportedEfforts.includes(input.requested) ? input.requested : "default";
}
