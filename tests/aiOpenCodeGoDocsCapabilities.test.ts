/**
 * 模型能力契约（2026-09-23 文档放开 + 2026-10-29 官方目录同步）：
 * - gpt-5.6-luna：vision + reasoning [default,low,medium,high,xhigh,max]
 * - deepseek-v4.1-flash：vision + reasoning [default,low,high,max]
 * - glm-5.3：reasoning [default,low,high,max]（官方 text-only → vision 保持关闭）
 * - qwen3.8-max / kimi-k2.7-code：vision
 * - 2026-10 新增：claude-haiku-5-5（vision + anthropic-effort）、gemini-4-argon（vision）、
 *   kimi-k3.1-pro / minimax-m3.1-flash（vision + effort）、muse-spark-1.2（vision + responses effort）
 *
 * 这些声明直接驱动附件 gate（图片是否可发）与 Kiro 思考程度滑块；
 * 本文件锁定「能力声明 → 传输层 providerOptions」的端到端语义。
 */
import { describe, it, expect } from "vitest";
import { OPENCODE_MODELS } from "@/lib/ai/providers/openCodeGo";
import { getModelCapabilities, isVisionMimeSupported } from "@/lib/ai/providers/capabilities";
import {
  ANTHROPIC_EFFORT_BUDGET_TOKENS,
  getReasoningCapability,
  normalizeReasoningEffort,
  resolveReasoningProviderOptions,
  resolveProviderOptionsEnvelope,
} from "@/lib/ai/reasoning/providerOptions";
import { resolveEffectiveReasoningEffort } from "@/lib/ai/reasoning/effective";

function def(id: string) {
  const found = OPENCODE_MODELS.find((m) => m.id === id);
  if (!found) throw new Error(`missing model: ${id}`);
  return found;
}

describe("官方文档放开：vision（图片可发送）", () => {
  it.each([
    "gpt-5.6-luna",
    "deepseek-v4.1-flash",
    "qwen3.8-max",
    "kimi-k2.7-code",
    "kimi-k3.1-pro",
    "minimax-m3.1-flash",
    "gemini-4-argon",
    "claude-haiku-5-5",
    "muse-spark-1.2-contributor",
  ])("%s vision=true 且 JPEG/PNG/WEBP 通过 gate", (id) => {
    const cap = getModelCapabilities({ provider: "opencode-go", model: id });
    expect(cap.vision).toBe(true);
    expect(cap.visionMimeTypes).toEqual(["image/jpeg", "image/png", "image/webp"]);
    for (const mime of ["image/jpeg", "image/png", "image/webp"]) {
      expect(isVisionMimeSupported(cap, mime), mime).toBe(true);
    }
    expect(isVisionMimeSupported(cap, "image/gif")).toBe(false);
  });

  it("glm-5.3 官方 text-only → vision 仍关闭", () => {
    const cap = getModelCapabilities({ provider: "opencode-go", model: "glm-5.3" });
    expect(cap.vision).toBe(false);
    expect(isVisionMimeSupported(cap, "image/png")).toBe(false);
  });
});

describe("官方文档放开：reasoning（chat effort 直通）", () => {
  it.each([
    ["deepseek-v4.1-flash", ["default", "low", "high", "max"]],
    ["glm-5.3", ["default", "low", "high", "max"]],
  ])("%s capability = effort 档位（无 medium）", (id, efforts) => {
    const cap = getReasoningCapability(def(id));
    expect(cap.adjustable).toBe(true);
    expect(cap.mechanism).toBe("effort");
    expect(cap.supportedEfforts).toEqual(efforts);
    // medium 不在官方档位 → normalize 回落 default
    expect(normalizeReasoningEffort(cap, "medium")).toBe("default");
    expect(resolveEffectiveReasoningEffort({ provider: "opencode-go", model: id, requested: "medium" })).toBe(
      "default"
    );
    expect(resolveEffectiveReasoningEffort({ provider: "opencode-go", model: id, requested: "max" })).toBe("max");
  });

  it.each(["deepseek-v4.1-flash", "glm-5.3"])("%s：low/high/max → reasoningEffort 直通；default → 不覆盖", (id) => {
    const definition = def(id);
    expect(resolveReasoningProviderOptions({ definition, effort: "default" })).toBeUndefined();
    expect(resolveReasoningProviderOptions({ definition, effort: "low" })).toEqual({
      reasoningEffort: "low",
    });
    expect(resolveReasoningProviderOptions({ definition, effort: "high" })).toEqual({
      reasoningEffort: "high",
    });
    expect(resolveReasoningProviderOptions({ definition, effort: "max" })).toEqual({
      reasoningEffort: "max",
    });
    // chat transport → "classflow-kiro" envelope（@ai-sdk/openai-compatible 读取 name 一致 key）
    expect(resolveProviderOptionsEnvelope({ definition, effort: "max" })).toEqual({
      "classflow-kiro": { reasoningEffort: "max" },
    });
  });

  it("kimi-k2.7-code：官方 thinking 常开且无 effort 参数 → 不声明可调", () => {
    const cap = getReasoningCapability(def("kimi-k2.7-code"));
    expect(cap.adjustable).toBe(false);
    expect(resolveReasoningProviderOptions({ definition: def("kimi-k2.7-code"), effort: "max" })).toBeUndefined();
  });
});

describe("官方文档放开：GPT 5.6 Luna 档位扩展", () => {
  it("supportedEfforts = default/low/medium/high/xhigh/max", () => {
    const cap = getReasoningCapability(def("gpt-5.6-luna"));
    expect(cap.mechanism).toBe("openai-responses-effort");
    expect(cap.supportedEfforts).toEqual(["default", "low", "medium", "high", "xhigh", "max"]);
  });

  it("xhigh / max → responses envelope（reasoningEffort + forceReasoning）", () => {
    const definition = def("gpt-5.6-luna");
    expect(resolveProviderOptionsEnvelope({ definition, effort: "xhigh", base: { store: false } })).toEqual({
      openai: { store: false, reasoningEffort: "xhigh", forceReasoning: true },
    });
    expect(resolveProviderOptionsEnvelope({ definition, effort: "max" })).toEqual({
      openai: { reasoningEffort: "max", forceReasoning: true },
    });
    expect(resolveProviderOptionsEnvelope({ definition, effort: "default" })).toBeUndefined();
  });

  it("视觉 + 推理可同时使用（luna 是精选列表默认推理旗舰）", () => {
    const cap = getModelCapabilities({ provider: "opencode-go", model: "gpt-5.6-luna" });
    expect(cap.vision).toBe(true);
    expect(cap.reasoning.adjustable).toBe(true);
  });
});

describe("2026-10-29 官方目录：新增模型的能力 → providerOptions", () => {
  it("Claude Haiku 5.5：anthropic-effort 档位齐全，high/max 有 budget 映射", () => {
    const cap = getReasoningCapability(def("claude-haiku-5-5"));
    expect(cap).toEqual({
      adjustable: true,
      supportedEfforts: ["default", "low", "medium", "high", "xhigh", "max"],
      mechanism: "anthropic-effort",
    });
    for (const effort of ["low", "medium", "high", "xhigh", "max"] as const) {
      expect(ANTHROPIC_EFFORT_BUDGET_TOKENS[effort], effort).toBeGreaterThan(0);
      expect(resolveReasoningProviderOptions({ definition: def("claude-haiku-5-5"), effort })).toEqual({
        thinking: { type: "enabled", budgetTokens: ANTHROPIC_EFFORT_BUDGET_TOKENS[effort] },
      });
    }
    // 预算阶梯严格递增（越高越深，方向正确）
    expect(ANTHROPIC_EFFORT_BUDGET_TOKENS.low).toBeLessThan(ANTHROPIC_EFFORT_BUDGET_TOKENS.medium);
    expect(ANTHROPIC_EFFORT_BUDGET_TOKENS.medium).toBeLessThan(ANTHROPIC_EFFORT_BUDGET_TOKENS.high);
    expect(ANTHROPIC_EFFORT_BUDGET_TOKENS.high).toBeLessThan(ANTHROPIC_EFFORT_BUDGET_TOKENS.xhigh);
    expect(ANTHROPIC_EFFORT_BUDGET_TOKENS.xhigh).toBeLessThan(ANTHROPIC_EFFORT_BUDGET_TOKENS.max);
  });

  it("Kimi K3.1 Pro：effort 直通（low/high/max，无 medium）", () => {
    const definition = def("kimi-k3.1-pro");
    expect(resolveReasoningProviderOptions({ definition, effort: "medium" })).toBeUndefined();
    expect(resolveReasoningProviderOptions({ definition, effort: "high" })).toEqual({ reasoningEffort: "high" });
    expect(resolveProviderOptionsEnvelope({ definition, effort: "max" })).toEqual({
      "classflow-kiro": { reasoningEffort: "max" },
    });
  });

  it("Gemini 4 Argon：翻译层 openai-chat + effort 档位", () => {
    const definition = def("gemini-4-argon");
    expect(definition.transport).toBe("openai-chat");
    expect(resolveReasoningProviderOptions({ definition, effort: "low" })).toEqual({ reasoningEffort: "low" });
    expect(resolveReasoningProviderOptions({ definition, effort: "max" })).toBeUndefined();
  });

  it("Muse Spark 1.2：responses effort（minimal..xhigh），vision 可同时使用", () => {
    const definition = def("muse-spark-1.2-contributor");
    expect(resolveProviderOptionsEnvelope({ definition, effort: "xhigh" })).toEqual({
      openai: { reasoningEffort: "xhigh", forceReasoning: true },
    });
    const cap = getModelCapabilities({ provider: "opencode-go", model: "muse-spark-1.2-contributor" });
    expect(cap.vision).toBe(true);
    expect(cap.reasoning.adjustable).toBe(true);
  });
});
