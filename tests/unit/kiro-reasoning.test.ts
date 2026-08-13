import { describe, it, expect } from "vitest";
import {
  getReasoningCapability,
  normalizeReasoningEffort,
  resolveReasoningProviderOptions,
} from "@/lib/ai/reasoning/providerOptions";
import { FIXED_REASONING } from "@/lib/ai/reasoning/types";
import { AIModelDefinition } from "@/lib/ai/providers/types";

const adjustableDef: AIModelDefinition = {
  id: "custom-m",
  name: "Custom M",
  provider: "custom-openai",
  vendor: null,
  transport: "openai-chat",
  capabilities: {
    streaming: true,
    tools: true,
    vision: false,
    fileParts: false,
    reasoning: {
      adjustable: true,
      supportedEfforts: ["default", "low", "medium", "high"],
      mechanism: "effort",
    },
  },
};

describe("reasoning capability", () => {
  it("缺失 reasoning capability → fixed（default only）", () => {
    const def: AIModelDefinition = {
      id: "plain",
      name: "Plain",
      provider: "opencode-go",
      vendor: null,
      transport: "openai-chat",
      capabilities: { streaming: true, tools: true, vision: false, fileParts: false },
    };
    const cap = getReasoningCapability(def);
    expect(cap.adjustable).toBe(false);
    expect(cap.supportedEfforts).toEqual(["default"]);
    expect(cap.mechanism).toBe("fixed");
  });

  it("unsupported effort → 归一为 default", () => {
    expect(normalizeReasoningEffort(FIXED_REASONING, "high")).toBe("default");
    expect(normalizeReasoningEffort(FIXED_REASONING, "default")).toBe("default");
    const cap = getReasoningCapability(adjustableDef, { providerName: "x", baseURL: "https://x.example", model: "m", reasoningEffort: true });
    expect(normalizeReasoningEffort(cap, "high")).toBe("high");
  });

  it("default 不产生 provider override", () => {
    expect(
      resolveReasoningProviderOptions({ definition: adjustableDef, custom: { providerName: "x", baseURL: "https://x.example", model: "m", reasoningEffort: true }, effort: "default" })
    ).toBeUndefined();
  });

  it("DeepSeek official = fixed（transform 强制 thinking disabled 兼容）", () => {
    // deepseek provider 无 reasoning capability → fixed
    const cap = getReasoningCapability(null); // deepseek 定义不声明 reasoning
    expect(cap.adjustable).toBe(false);
    expect(resolveReasoningProviderOptions({ definition: null, custom: undefined, effort: "high" })).toBeUndefined();
  });

  it("Custom OpenAI：仅 reasoningEffort===true 可调", () => {
    expect(getReasoningCapability(null, { providerName: "x", baseURL: "https://x", model: "m" }).adjustable).toBe(false);
    expect(getReasoningCapability(null, { providerName: "x", baseURL: "https://x", model: "m", reasoningEffort: true }).adjustable).toBe(true);
  });

  it("verified effort → provider options（mechanism=effort → openai reasoningEffort）", () => {
    const options = resolveReasoningProviderOptions({
      definition: adjustableDef,
      custom: { providerName: "x", baseURL: "https://x.example", model: "m", reasoningEffort: true },
      effort: "medium",
    });
    expect(options).toEqual({ reasoningEffort: "medium" });
    expect(resolveReasoningProviderOptions({ definition: adjustableDef, custom: { providerName: "x", baseURL: "https://x.example", model: "m", reasoningEffort: true }, effort: "low" })).toEqual({ reasoningEffort: "low" });
    expect(resolveReasoningProviderOptions({ definition: adjustableDef, custom: { providerName: "x", baseURL: "https://x.example", model: "m", reasoningEffort: true }, effort: "high" })).toEqual({ reasoningEffort: "high" });
  });
});
