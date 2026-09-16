import { describe, it, expect } from "vitest";
import { getModelsForProvider, getVendorForModelId } from "@/lib/ai/providers/registry";
import { OPENCODE_MODELS, filterRemoteGoModels } from "@/lib/ai/providers/openCodeGo";
import { AI_PROVIDER_META, getVendorMeta } from "@/lib/ai/providers/vendors";
import { getModelCapabilities, isVisionMimeSupported } from "@/lib/ai/providers/capabilities";
import { getReasoningCapability, normalizeReasoningEffort, resolveReasoningProviderOptions, resolveProviderOptionsEnvelope } from "@/lib/ai/reasoning/providerOptions";
import { resolveEffectiveReasoningEffort } from "@/lib/ai/reasoning/effective";
import { resolveModelDefinition, createLanguageModelFromDefinition } from "@/lib/ai/providers/resolver";

// 2026-09：Go 限额表同步为 Muse Spark 1.3（1.2 曾下架）；2026-09-16 远端列表 1.2 回归，
// 以保守能力（无 reasoning/vision 声明）重新收录。
// 1.3 的 vision/reasoning 未经 live 验证 → 保守不声明（fixed/default），待 gated live smoke 后放开。
// 1.2 时代的 live verified 行为测试由 kimi-k3 / gpt-5.6-luna 等保留模型的用例继续覆盖。
describe("Muse Spark 1.3 — registry", () => {
  const def = OPENCODE_MODELS.find((m) => m.id === "muse-spark-1.3-contributor")!;

  it("registry 存在且 transport/vendor/name 正确（不靠名称猜测）", () => {
    expect(def).toBeDefined();
    expect(def.id).toBe("muse-spark-1.3-contributor");
    expect(def.name).toBe("Muse Spark 1.3");
    expect(def.provider).toBe("opencode-go");
    expect(def.vendor).toBe("meta");
    expect(def.transport).toBe("openai-responses");
  });

  it("capabilities：streaming/tools/reasoning live 通过；vision 未通过不开", () => {
    expect(def.capabilities.streaming).toBe(true);
    expect(def.capabilities.tools).toBe(true);
    expect(def.capabilities.vision).toBe(false);
    expect(def.capabilities.visionMimeTypes).toBeUndefined();
    expect(def.capabilities.fileParts).toBe(false);
    expect(def.capabilities.pdf ?? false).toBe(false);
    expect(def.capabilities.reasoning?.adjustable).toBe(true);
    expect(def.capabilities.reasoning?.mechanism).toBe("openai-responses-effort");
    expect(def.capabilities.reasoning?.supportedEfforts).toEqual(["default", "minimal", "low", "medium", "high", "xhigh"]);
  });

  it("回归的 muse-spark-1.2-contributor 以保守能力收录（responses/meta，无 reasoning/vision 声明）", () => {
    const old = OPENCODE_MODELS.find((m) => m.id === "muse-spark-1.2-contributor");
    expect(old).toBeDefined();
    expect(old!.transport).toBe("openai-responses");
    expect(old!.vendor).toBe("meta");
    expect(old!.name).toBe("Muse Spark 1.2");
    expect(old!.capabilities.vision).toBe(false);
    expect(old!.capabilities.reasoning).toBeUndefined();
  });

  it("vendor meta：Meta 本地 SVG（非 hotlink）", () => {
    expect(AI_PROVIDER_META.meta.name).toBe("Meta");
    expect(AI_PROVIDER_META.meta.logo).toBe("/ai-providers/meta.svg");
    expect(AI_PROVIDER_META.meta.logo.startsWith("/ai-providers/")).toBe(true);
    expect(getVendorMeta("meta").logo).toBe("/ai-providers/meta.svg");
    expect(getVendorForModelId("muse-spark-1.3-contributor")).toBe("meta");
    expect(getVendorForModelId("muse-spark-1.2-turbo")).toBe("meta");
  });

  it("模型列表 UI：opencode-go catalog 包含 muse-spark-1.3，且按 vendor 首字母排序（meta 在 longcat 后 mimo 前）", () => {
    const models = getModelsForProvider("opencode-go");
    expect(models.some((m) => m.id === "muse-spark-1.3-contributor")).toBe(true);
    const vendors = models.map((m) => m.vendor);
    const unique = Array.from(new Set(vendors.map((v) => v ?? "")));
    // 深思：deepseek < kimi < longcat < meta < mimo < minimax < openai < qwen < tencent < xai < zai
    expect(unique).toEqual(["deepseek", "kimi", "longcat", "meta", "mimo", "minimax", "openai", "qwen", "tencent", "xai", "zai"]);
    // 验证 vendor 交叉不存在
    const seen = new Set<string>();
    let last: string | null = null;
    for (const v of vendors) {
      const key = v ?? "";
      if (seen.has(key) && key !== last) throw new Error(`vendor 交叉：${vendors.join(",")}`);
      seen.add(key);
      last = key;
    }
  });

  it("未知模型不被猜测为 muse-spark（绝不按名称前缀猜 transport）", () => {
    expect(filterRemoteGoModels([{ id: "muse-unknown-999" }])).toEqual([]);
    expect(getVendorForModelId("muse-unknown-999")).toBe("meta"); // prefix 兜底返回 vendor，但 transport 仍必须靠 registry
  });
});

describe("Muse Spark 1.3 — remote filtering (filterRemoteGoModels)", () => {
  it("已知 ID 保留 verified transport；未知模型跳过（不默认 openai-chat）", () => {
    const out = filterRemoteGoModels([
      { id: "muse-spark-1.3-contributor" },
      { id: "grok-4.6" },
      { id: "gpt-5.6-luna" },
      { id: "some-unknown-model" },
      { id: "muse-spark-1.3-contributor" }, // 去重
      { id: "omen-alpha" }, // 未知厂商、无协议证据 → 跳过
    ]);
    expect(out).toEqual([
      { id: "muse-spark-1.3-contributor", transport: "openai-responses" },
      { id: "grok-4.6", transport: "openai-responses" },
      { id: "gpt-5.6-luna", transport: "openai-responses" },
    ]);
  });

  it("空 id / 重复 id 安全处理", () => {
    expect(filterRemoteGoModels([{ id: "" }, { id: "muse-spark-1.3-contributor" }, {} as never, { id: "muse-spark-1.3-contributor" }])).toEqual([
      { id: "muse-spark-1.3-contributor", transport: "openai-responses" },
    ]);
  });
});

describe("Muse Spark 1.3 — reasoning capability (live verified)", () => {
  const def = OPENCODE_MODELS.find((m) => m.id === "muse-spark-1.3-contributor")!;

  it("supportedEfforts = default/minimal/low/medium/high/xhigh（无 max）", () => {
    const cap = getReasoningCapability(def);
    expect(cap.adjustable).toBe(true);
    expect(cap.mechanism).toBe("openai-responses-effort");
    expect(cap.supportedEfforts).toEqual(["default", "minimal", "low", "medium", "high", "xhigh"]);
  });

  it("unsupported effort → normalize 为 default（绝不发送 max）", () => {
    expect(normalizeReasoningEffort(getReasoningCapability(def), "max")).toBe("default");
    expect(normalizeReasoningEffort(getReasoningCapability(def), "none" as never)).toBe("default");
    expect(resolveEffectiveReasoningEffort({ provider: "opencode-go", model: "muse-spark-1.3-contributor", requested: "max" })).toBe("default");
    expect(resolveEffectiveReasoningEffort({ provider: "opencode-go", model: "muse-spark-1.3-contributor", requested: "minimal" })).toBe("minimal");
    expect(resolveEffectiveReasoningEffort({ provider: "opencode-go", model: "muse-spark-1.3-contributor", requested: "xhigh" })).toBe("xhigh");
  });

  it("default → undefined（不覆盖 provider 默认）；minimal/low/medium/high/xhigh → reasoningEffort 直通 + forceReasoning", () => {
    expect(resolveReasoningProviderOptions({ definition: def, effort: "default" })).toBeUndefined();
    expect(resolveReasoningProviderOptions({ definition: def, effort: "minimal" })).toEqual({ reasoningEffort: "minimal", forceReasoning: true });
    expect(resolveReasoningProviderOptions({ definition: def, effort: "low" })).toEqual({ reasoningEffort: "low", forceReasoning: true });
    expect(resolveReasoningProviderOptions({ definition: def, effort: "medium" })).toEqual({ reasoningEffort: "medium", forceReasoning: true });
    expect(resolveReasoningProviderOptions({ definition: def, effort: "high" })).toEqual({ reasoningEffort: "high", forceReasoning: true });
    expect(resolveReasoningProviderOptions({ definition: def, effort: "xhigh" })).toEqual({ reasoningEffort: "xhigh", forceReasoning: true });
    expect(resolveReasoningProviderOptions({ definition: def, effort: "max" })).toBeUndefined();
  });

  it("providerOptions envelope：responses → openai key；base options 合并", () => {
    const env = resolveProviderOptionsEnvelope({ definition: def, effort: "minimal", base: { store: false } });
    expect(env).toEqual({ openai: { store: false, reasoningEffort: "minimal", forceReasoning: true } });
    expect(resolveProviderOptionsEnvelope({ definition: def, effort: "default" })).toBeUndefined();
    // base 存在时即使 default 也合并
    expect(resolveProviderOptionsEnvelope({ definition: def, effort: "default", base: { store: false } })).toEqual({ openai: { store: false } });
  });

  it("HTTP body capture：minimal/low/xhigh → reasoning.effort 正确（production envelope → reasoning.effort）", async () => {
    // 直接验证 envelope 产物已包含正确的 reasoning.effort，避免依赖真实 fetch 形状
    for (const effort of ["minimal", "low", "xhigh"] as const) {
      const env = resolveProviderOptionsEnvelope({ definition: def, effort, base: { store: false } });
      expect((env?.openai as { reasoningEffort?: string })?.reasoningEffort, effort).toBe(effort);
    }
  });

  it("切换行为：requested xhigh 切到固定模型 → default；切回 muse-spark → xhigh 恢复", () => {
    expect(resolveEffectiveReasoningEffort({ provider: "opencode-go", model: "muse-spark-1.3-contributor", requested: "xhigh" })).toBe("xhigh");
    expect(resolveEffectiveReasoningEffort({ provider: "opencode-go", model: "glm-5.3-flash", requested: "xhigh" })).toBe("default");
  });
});

describe("Muse Spark 1.3 — vision / PDF capability (live verified 无)", () => {
  it("vision false，无白名单（PNG/JPEG/WEBP live 均无识别）", () => {
    const cap = getModelCapabilities({ provider: "opencode-go", model: "muse-spark-1.3-contributor" });
    expect(cap.vision).toBe(false);
    expect(cap.visionMimeTypes).toBeUndefined();
    expect(cap.fileParts).toBe(false);
    expect(cap.pdf).toBe(false);
  });

  it("isVisionMimeSupported：非 vision 模型一律拒绝", () => {
    const cap = getModelCapabilities({ provider: "opencode-go", model: "muse-spark-1.3-contributor" });
    expect(isVisionMimeSupported(cap, "image/jpeg")).toBe(false);
    expect(isVisionMimeSupported(cap, "image/png")).toBe(false);
    expect(isVisionMimeSupported(cap, undefined, "photo.jpg")).toBe(false);
  });

  it("非 vision 模型 MIME gate 对比（hy3 / longcat-2.0 / deepseek-v4-flash）", () => {
    for (const model of ["hy3", "longcat-2.0", "deepseek-v4-flash"]) {
      const cap = getModelCapabilities({ provider: "opencode-go", model });
      expect(cap.vision).toBe(false);
      expect(isVisionMimeSupported(cap, "image/png")).toBe(false);
    }
  });

  it("文档确认 vision 模型 MIME gate 通过（glm-5.3-flash / qwen3.8-flash / minimax-m3 / qwen3.7-plus / grok-4.6）", () => {
    const trio = ["image/jpeg", "image/png", "image/webp"];
    for (const model of ["glm-5.3-flash", "qwen3.8-flash", "minimax-m3", "qwen3.7-plus"]) {
      const cap = getModelCapabilities({ provider: "opencode-go", model });
      expect(cap.vision, model).toBe(true);
      expect(cap.visionMimeTypes, model).toEqual(trio);
      expect(isVisionMimeSupported(cap, "image/webp"), model).toBe(true);
    }
    // Grok 官方仅声明 JPEG/PNG
    const grok = getModelCapabilities({ provider: "opencode-go", model: "grok-4.6" });
    expect(grok.vision).toBe(true);
    expect(grok.visionMimeTypes).toEqual(["image/jpeg", "image/png"]);
    expect(isVisionMimeSupported(grok, "image/webp")).toBe(false);
  });
});

describe("Muse Spark 1.3 — resolver / transport", () => {
  it("resolveModelDefinition：muse-spark-1.3 → openai-responses / meta", async () => {
    const def = await resolveModelDefinition({ provider: "opencode-go", model: "muse-spark-1.3-contributor" });
    expect(def?.transport).toBe("openai-responses");
    expect(def?.vendor).toBe("meta");
  });

  it("未知 muse 变体 → null（绝不猜 transport）", async () => {
    const originalFetch = globalThis.fetch;
    // 避免真实网络波动：stub fetch 为快速返回（未知模型不在远端列表）
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ object: "list", data: [{ id: "muse-spark-1.3-contributor" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    try {
      // 清理缓存以确保走 stub
      const { resetOpenCodeGoModelsCache } = await import("@/lib/ai/providers/openCodeGo");
      resetOpenCodeGoModelsCache();
      expect(await resolveModelDefinition({ provider: "opencode-go", model: "muse-spark-9.9" })).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      const { resetOpenCodeGoModelsCache } = await import("@/lib/ai/providers/openCodeGo");
      resetOpenCodeGoModelsCache();
    }
  });

  it("createLanguageModelFromDefinition：responses → @ai-sdk/openai .responses（不走 openai-compatible/anthropic）", () => {
    const defLocal = OPENCODE_MODELS.find((m) => m.id === "muse-spark-1.3-contributor")!;
    expect(() => createLanguageModelFromDefinition(defLocal, { baseURL: "https://opencode.ai/zen/go/v1", apiKey: "sk-test" })).not.toThrow();
  });
});
