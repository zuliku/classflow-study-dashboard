import { describe, it, expect } from "vitest";
import {
  getReasoningCapability,
  normalizeReasoningEffort,
  resolveReasoningProviderOptions,
  resolveReasoningProviderOptionsEnvelope,
  shouldOmitToolChoice,
} from "@/lib/ai/reasoning/providerOptions";
import { resolveEffectiveReasoningEffort } from "@/lib/ai/reasoning/effective";
import { FIXED_REASONING } from "@/lib/ai/reasoning/types";
import { AIModelDefinition } from "@/lib/ai/providers/types";
import { DEEPSEEK_MODELS, deepSeekTransformRequestBody } from "@/lib/ai/providers/deepSeek";
import { OPENCODE_MODELS } from "@/lib/ai/providers/openCodeGo";
import { validateAIChatBody } from "@/lib/ai/server";

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

const deepseekFlash = DEEPSEEK_MODELS.find((m) => m.id === "deepseek-v4-flash")!;
const deepseekPro = DEEPSEEK_MODELS.find((m) => m.id === "deepseek-v4-pro")!;

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

  it("OpenCode Go（代理 Provider）= fixed（不按模型名猜能力）", () => {
    // opencode-go 的 deepseek-v4-pro 不声明 reasoning → fixed
    const goDef = {
      id: "deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      provider: "opencode-go",
      vendor: "deepseek",
      transport: "openai-chat",
      capabilities: { streaming: true, tools: true, vision: false, fileParts: false },
    } as AIModelDefinition;
    const cap = getReasoningCapability(goDef);
    expect(cap.adjustable).toBe(false);
    expect(resolveReasoningProviderOptions({ definition: goDef, effort: "max" })).toBeUndefined();
    expect(shouldOmitToolChoice({ definition: goDef, effort: "max" })).toBe(false);
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

describe("DeepSeek V4 Thinking Mode（deepseek-thinking）", () => {
  // Test 1：capability 声明
  it("V4 Flash / V4 Pro 声明 default / high / max（无 low / medium）", () => {
    for (const def of [deepseekFlash, deepseekPro]) {
      const cap = getReasoningCapability(def);
      expect(cap.adjustable).toBe(true);
      expect(cap.supportedEfforts).toEqual(["default", "high", "max"]);
      expect(cap.mechanism).toBe("deepseek-thinking");
    }
  });

  // Test 2：default → 无 provider override；transform fallback thinking disabled
  it("default → undefined；transform 后 thinking.type = disabled", () => {
    expect(
      resolveReasoningProviderOptions({ definition: deepseekFlash, effort: "default" })
    ).toBeUndefined();
    const body = deepSeekTransformRequestBody({ messages: [], thinking: undefined });
    expect(body.thinking).toEqual({ type: "disabled" });
    // 无 thinking 字段（旧请求形状）同样 fallback disabled
    const body2 = deepSeekTransformRequestBody({ messages: [] });
    expect((body2.thinking as { type: string }).type).toBe("disabled");
  });

  // Test 2b：low / medium 不制造假档位 → 归一为 default
  it("low / medium → 归一为 default（官方映射为 high，不展示假档位）", () => {
    expect(normalizeReasoningEffort(getReasoningCapability(deepseekPro), "low")).toBe("default");
    expect(normalizeReasoningEffort(getReasoningCapability(deepseekPro), "medium")).toBe("default");
    expect(resolveReasoningProviderOptions({ definition: deepseekPro, effort: "low" })).toBeUndefined();
  });

  // Test 3：high → thinking enabled + reasoningEffort high；transform 不得覆盖
  it("high → thinking.enabled + reasoningEffort=high，transform 不覆盖", () => {
    const options = resolveReasoningProviderOptions({ definition: deepseekPro, effort: "high" });
    expect(options).toEqual({ thinking: { type: "enabled" }, reasoningEffort: "high" });
    const body = deepSeekTransformRequestBody({ ...(options as object), tools: [], messages: [] });
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoningEffort).toBe("high");
  });

  // Test 4：max → thinking enabled + reasoningEffort max
  it("max → thinking.enabled + reasoningEffort=max", () => {
    const options = resolveReasoningProviderOptions({ definition: deepseekFlash, effort: "max" });
    expect(options).toEqual({ thinking: { type: "enabled" }, reasoningEffort: "max" });
    const body = deepSeekTransformRequestBody({ ...(options as object), messages: [] });
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoningEffort).toBe("max");
  });

  it("任意客户端注入的非法 thinking → transform 拒绝，fallback disabled", () => {
    const body = deepSeekTransformRequestBody({
      messages: [],
      thinking: { type: "evil" },
    });
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("thinking enabled → transform 移除 tool_choice（AI SDK 默认 auto 也不发送）", () => {
    const body = deepSeekTransformRequestBody({
      messages: [],
      thinking: { type: "enabled" },
      tool_choice: "auto",
      tools: [{ type: "function", function: { name: "x" } }],
    });
    expect("tool_choice" in body).toBe(false);
    expect((body.thinking as { type: string }).type).toBe("enabled");
    expect(body.tools).toHaveLength(1);
    // thinking disabled（默认路径）：保持现有行为，不干预 tool_choice
    const body2 = deepSeekTransformRequestBody({ messages: [], thinking: { type: "disabled" }, tool_choice: "auto" });
    expect(body2.tool_choice).toBe("auto");
  });

  // Test 5：tool schema 根节点 fix 仍然正常
  it("tool schema 根节点 type:object fix 仍然生效", () => {
    const body = deepSeekTransformRequestBody({
      tools: [
        {
          type: "function",
          function: {
            name: "create_reminder",
            description: "创建提醒",
            parameters: { properties: { text: { type: "string" } } },
          },
        },
      ],
      messages: [],
    });
    const params = (body.tools as { function: { parameters: Record<string, unknown> } }[])[0].function.parameters;
    expect(params.type).toBe("object");
    // 已有根 type 的 schema 不被修改
    const body2 = deepSeekTransformRequestBody({
      tools: [
        {
          type: "function",
          function: {
            name: "ok",
            description: "ok",
            parameters: { type: "object", properties: { a: { type: "string" } } },
          },
        },
      ],
      messages: [],
    });
    const params2 = (body2.tools as { function: { parameters: Record<string, unknown> } }[])[0].function.parameters;
    expect(params2.type).toBe("object");
    expect(Object.keys(params2).sort()).toEqual(["properties", "type"].sort());
  });
});

describe("shouldOmitToolChoice（DeepSeek Thinking Mode tool_choice 兼容）", () => {
  it("DeepSeek + high/max → true", () => {
    expect(shouldOmitToolChoice({ definition: deepseekPro, effort: "high" })).toBe(true);
    expect(shouldOmitToolChoice({ definition: deepseekFlash, effort: "max" })).toBe(true);
  });
  it("DeepSeek + default → false（thinking disabled，保持现有行为）", () => {
    expect(shouldOmitToolChoice({ definition: deepseekPro, effort: "default" })).toBe(false);
  });
  it("非 DeepSeek / 未知模型 → false", () => {
    expect(shouldOmitToolChoice({ definition: null, effort: "high" })).toBe(false);
    expect(shouldOmitToolChoice({ definition: adjustableDef, custom: { providerName: "x", baseURL: "https://x", model: "m", reasoningEffort: true }, effort: "high" })).toBe(false);
  });
});

describe("Custom OpenAI passthrough（validateAIChatBody 白名单）", () => {
  const base = {
    provider: "custom-openai",
    model: "my-model",
    apiKey: "sk-test",
  };

  // Test 6：reasoningEffort:true 必须贯通
  it("reasoningEffort=true → 解析结果保留 true", () => {
    const parsed = validateAIChatBody({
      ...base,
      customConfig: { providerName: "x", baseURL: "https://x.example", model: "my-model", reasoningEffort: true },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.customConfig).toEqual({
      providerName: "x",
      baseURL: "https://x.example",
      model: "my-model",
      vision: false,
      fileParts: false,
      reasoningEffort: true,
    });
  });

  it("reasoningEffort=false / 非 boolean → 不贯通（保守）", () => {
    const parsedFalse = validateAIChatBody({ ...base, customConfig: { providerName: "x", baseURL: "https://x", model: "m", reasoningEffort: false } });
    expect(parsedFalse.ok && parsedFalse.customConfig?.reasoningEffort).toBe(false);
    const parsedBad = validateAIChatBody({ ...base, customConfig: { providerName: "x", baseURL: "https://x", model: "m", reasoningEffort: "yes" } });
    expect(parsedBad.ok && parsedBad.customConfig?.reasoningEffort).toBe(false);
  });

  it("Custom + reasoningEffort=true → getReasoningCapability 可调，providerOptions 正常生成", () => {
    const parsed = validateAIChatBody({
      ...base,
      reasoningEffort: "high",
      customConfig: { providerName: "x", baseURL: "https://x.example", model: "my-model", reasoningEffort: true },
    });
    if (!parsed.ok) throw new Error("parse failed");
    expect(getReasoningCapability(null, parsed.customConfig).adjustable).toBe(true);
    expect(resolveReasoningProviderOptions({ definition: null, custom: parsed.customConfig, effort: parsed.reasoningEffort })).toEqual({ reasoningEffort: "high" });
  });

  // Test 7：非法 reasoning → default
  it("非法 reasoningEffort → default", () => {
    const parsed = validateAIChatBody({ ...base, reasoningEffort: "ultra" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.reasoningEffort).toBe("default");
  });
});

describe("resolveEffectiveReasoningEffort（requested → effective，UI/Turn Snapshot/Server 一致）", () => {
  const customEnabled = { providerName: "x", baseURL: "https://x.example", model: "my-model", reasoningEffort: true };

  it("1. DeepSeek requested=max → max", () => {
    expect(resolveEffectiveReasoningEffort({ provider: "deepseek", model: "deepseek-v4-flash", requested: "max" })).toBe("max");
    expect(resolveEffectiveReasoningEffort({ provider: "deepseek", model: "deepseek-v4-pro", requested: "high" })).toBe("high");
  });

  it("2. DeepSeek requested=low → default（不制造假档位）", () => {
    expect(resolveEffectiveReasoningEffort({ provider: "deepseek", model: "deepseek-v4-pro", requested: "low" })).toBe("default");
    expect(resolveEffectiveReasoningEffort({ provider: "deepseek", model: "deepseek-v4-flash", requested: "medium" })).toBe("default");
  });

  it("3. OpenCode Go fixed requested=high → default", () => {
    expect(resolveEffectiveReasoningEffort({ provider: "opencode-go", model: "deepseek-v4-flash", requested: "high" })).toBe("default");
    expect(resolveEffectiveReasoningEffort({ provider: "opencode-go", model: "grok-4.5", requested: "max" })).toBe("default");
  });

  it("4. Custom reasoningEffort=true requested=high → high", () => {
    expect(resolveEffectiveReasoningEffort({ provider: "custom-openai", model: "my-model", custom: customEnabled, requested: "high" })).toBe("high");
    expect(resolveEffectiveReasoningEffort({ provider: "custom-openai", model: "my-model", custom: customEnabled, requested: "low" })).toBe("low");
  });

  it("5. Custom reasoningEffort=true requested=max → default（max 不在 effort mechanism 档位）", () => {
    expect(resolveEffectiveReasoningEffort({ provider: "custom-openai", model: "my-model", custom: customEnabled, requested: "max" })).toBe("default");
  });

  it("Custom reasoningEffort 未开启（fixed）requested=high → default", () => {
    expect(
      resolveEffectiveReasoningEffort({
        provider: "custom-openai",
        model: "my-model",
        custom: { providerName: "x", baseURL: "https://x.example", model: "my-model" },
        requested: "high",
      })
    ).toBe("default");
  });
});

describe("GPT 5.6 Luna / Grok 4.5（openai-responses-effort，Phase 3.2A/B）", () => {
  const lunaDef = OPENCODE_MODELS.find((m) => m.id === "gpt-5.6-luna")!;
  const grokDef = OPENCODE_MODELS.find((m) => m.id === "grok-4.5")!;

  it("1. GPT Luna capability：adjustable=true", () => {
    const cap = getReasoningCapability(lunaDef);
    expect(cap.adjustable).toBe(true);
    expect(cap.mechanism).toBe("openai-responses-effort");
  });

  it("2. supportedEfforts 只含 verified 档位（default/low/medium/high；max 未 live 验证不暴露）", () => {
    const cap = getReasoningCapability(lunaDef);
    expect(cap.supportedEfforts).toEqual(["default", "low", "medium", "high"]);
  });

  it("3. default → provider options undefined", () => {
    expect(resolveReasoningProviderOptions({ definition: lunaDef, effort: "default" })).toBeUndefined();
    expect(resolveReasoningProviderOptionsEnvelope({ definition: lunaDef, effort: "default" })).toBeUndefined();
  });

  it("4. low → { reasoningEffort: low, forceReasoning: true }", () => {
    expect(resolveReasoningProviderOptions({ definition: lunaDef, effort: "low" })).toEqual({ reasoningEffort: "low", forceReasoning: true });
  });

  it("5. high → { reasoningEffort: high, forceReasoning: true }（max 未验证，不写成功测试）", () => {
    expect(resolveReasoningProviderOptions({ definition: lunaDef, effort: "high" })).toEqual({ reasoningEffort: "high", forceReasoning: true });
    expect(resolveReasoningProviderOptions({ definition: lunaDef, effort: "max" })).toBeUndefined();
  });

  it("envelope：Responses → { openai: ... }（4.0.42 固定读取 openai key）", () => {
    expect(resolveReasoningProviderOptionsEnvelope({ definition: lunaDef, effort: "high" })).toEqual({
      openai: { reasoningEffort: "high", forceReasoning: true },
    });
    // 非 Responses（chat/messages adapter）→ classflow-kiro
    expect(
      resolveReasoningProviderOptionsEnvelope({
        definition: null,
        custom: { providerName: "x", baseURL: "https://x.example", model: "m", reasoningEffort: true },
        effort: "high",
      })
    ).toEqual({ "classflow-kiro": { reasoningEffort: "high" } });
  });

  it("7. Grok 4.5：live verified（Phase 3.2B）→ adjustable，同 mechanism 复用", () => {
    const cap = getReasoningCapability(grokDef);
    expect(cap.adjustable).toBe(true);
    expect(cap.mechanism).toBe("openai-responses-effort");
    expect(cap.supportedEfforts).toEqual(["default", "low", "medium", "high"]);
    // 与 Luna 同一映射（无 Grok-specific envelope / mechanism）
    expect(resolveReasoningProviderOptions({ definition: grokDef, effort: "low" })).toEqual({ reasoningEffort: "low", forceReasoning: true });
    expect(resolveReasoningProviderOptions({ definition: grokDef, effort: "medium" })).toEqual({ reasoningEffort: "medium", forceReasoning: true });
    expect(resolveReasoningProviderOptions({ definition: grokDef, effort: "high" })).toEqual({ reasoningEffort: "high", forceReasoning: true });
    expect(resolveReasoningProviderOptions({ definition: grokDef, effort: "max" })).toBeUndefined();
    expect(resolveReasoningProviderOptionsEnvelope({ definition: grokDef, effort: "high" })).toEqual({
      openai: { reasoningEffort: "high", forceReasoning: true },
    });
  });

  it("8. OpenCode Go DeepSeek aliases 仍 fixed（不因名字复用 DeepSeek official capability）", () => {
    for (const id of ["deepseek-v4-flash", "deepseek-v4-pro"]) {
      const def = OPENCODE_MODELS.find((m) => m.id === id)!;
      expect(getReasoningCapability(def).adjustable, id).toBe(false);
    }
  });

  it("effective：Luna/Grok requested=high → high；OpenCode DeepSeek → default；max → default", () => {
    expect(resolveEffectiveReasoningEffort({ provider: "opencode-go", model: "gpt-5.6-luna", requested: "high" })).toBe("high");
    expect(resolveEffectiveReasoningEffort({ provider: "opencode-go", model: "grok-4.5", requested: "high" })).toBe("high");
    expect(resolveEffectiveReasoningEffort({ provider: "opencode-go", model: "grok-4.5", requested: "max" })).toBe("default");
    expect(resolveEffectiveReasoningEffort({ provider: "opencode-go", model: "deepseek-v4-flash", requested: "high" })).toBe("default");
  });
});
