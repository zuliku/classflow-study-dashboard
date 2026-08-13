/**
 * Kiro Reasoning Effort（与 responsePreference 严格分离）：
 * reasoning = 模型推理投入；responsePreference = 最终回答表达深度/篇幅。
 * `default` = 不主动覆盖 provider/model 默认推理行为（非 adaptive）。
 */
export type KiroReasoningEffort = "default" | "low" | "medium" | "high";

export interface ReasoningCapability {
  /** 是否可调（不可调 → UI 显示固定态，不展示假 control） */
  adjustable: boolean;
  supportedEfforts: KiroReasoningEffort[];
  mechanism:
    | "effort"
    | "anthropic-effort"
    | "thinking-budget"
    | "fixed";
}

export const REASONING_EFFORTS: KiroReasoningEffort[] = ["default", "low", "medium", "high"];

/** 固定模型能力（不可调，仅 default） */
export const FIXED_REASONING: ReasoningCapability = {
  adjustable: false,
  supportedEfforts: ["default"],
  mechanism: "fixed",
};
