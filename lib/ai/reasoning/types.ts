/**
 * Kiro Reasoning Effort（与 responsePreference 严格分离）：
 * reasoning = 模型推理投入；responsePreference = 最终回答表达深度/篇幅。
 * `default` = 不主动覆盖 provider/model 默认推理行为（非 adaptive）。
 * `max`：DeepSeek V4 官方支持的最高档（reasoning_effort=max），不折叠进 high。
 *
 * requested vs effective：
 * - Store 保存 requested（用户 preference，跨模型切换不重置）；
 * - 实际生效的是 effective = resolveEffectiveReasoningEffort() 结合当前模型
 *   capability 归一后的值（UI 显示 / Turn Snapshot 发送 / Server 二次校验）。
 * requested 不在当前模型 supportedEfforts 中 → effective = "default"。
 */
export type KiroReasoningEffort = "default" | "low" | "medium" | "high" | "max";

export interface ReasoningCapability {
  /** 是否可调（不可调 → UI 显示固定态，不展示假 control） */
  adjustable: boolean;
  supportedEfforts: KiroReasoningEffort[];
  mechanism:
    | "effort"
    | "anthropic-effort"
    | "thinking-budget"
    | "deepseek-thinking"
    | "openai-responses-effort"
    | "fixed";
}

export const REASONING_EFFORTS: KiroReasoningEffort[] = ["default", "low", "medium", "high", "max"];

/** 固定模型能力（不可调，仅 default） */
export const FIXED_REASONING: ReasoningCapability = {
  adjustable: false,
  supportedEfforts: ["default"],
  mechanism: "fixed",
};
