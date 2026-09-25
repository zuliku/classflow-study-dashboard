/**
 * Kiro Composer P3 — Model · Reasoning 合并展示（纯逻辑）。
 *
 * 一级只显示一个控件：`GPT-5.6 Sol · 高`（reasoning default / fixed → 只显示模型名）。
 * Reasoning 是 Model preference，与 Computer 开关无关（不在 Composer 里做 capability 耦合）。
 */
import type { KiroReasoningEffort, ReasoningCapability } from "@/lib/ai/reasoning/types";

/** 单一 effort label source（Composer 思考程度控件共用；S5 已删除遗留 KiroReasoningMenu） */
export const REASONING_EFFORT_LABELS: Record<KiroReasoningEffort, string> = {
  default: "默认",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "超高",
  max: "极高",
};

export function reasoningEffortLabel(effort: KiroReasoningEffort): string {
  return REASONING_EFFORT_LABELS[effort];
}

/** 模型是否可调 reasoning（fixed / 单档 → 不展示思考程度区） */
export function isComposerReasoningAdjustable(capability?: ReasoningCapability | null): boolean {
  return !!capability && capability.adjustable && capability.supportedEfforts.length > 1;
}

/** 档位索引（滑块位置单一来源；未知档位 → 0） */
export function reasoningStepIndex(steps: KiroReasoningEffort[], effort: KiroReasoningEffort): number {
  const index = steps.indexOf(effort);
  return index < 0 ? 0 : index;
}
