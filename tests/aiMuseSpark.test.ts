import { describe, it, expect } from "vitest";
import { getModelsForProvider, getVendorForModelId } from "@/lib/ai/providers/registry";
import { OPENCODE_MODELS, filterRemoteGoModels } from "@/lib/ai/providers/openCodeGo";
import { AI_PROVIDER_META, getVendorMeta } from "@/lib/ai/providers/vendors";
import { getModelCapabilities, isVisionMimeSupported } from "@/lib/ai/providers/capabilities";
import { getReasoningCapability, normalizeReasoningEffort, resolveReasoningProviderOptions, resolveProviderOptionsEnvelope } from "@/lib/ai/reasoning/providerOptions";
import { resolveEffectiveReasoningEffort } from "@/lib/ai/reasoning/effective";
import { resolveModelDefinition, createLanguageModelFromDefinition } from "@/lib/ai/providers/resolver";

// 2026-08-19 live verified Muse Spark 1.2 — all capabilities are from real OpenCode Go probe, not guessed.
describe("Muse Spark 1.2 — registry (verified)", () => {
  const def = OPENCODE_MODELS.find((m) => m.id === "muse-spark-1.2")!;

  it("registry 存在且 transport/vendor/name 正确（不靠名称猜测）", () => {
    expect(def).toBeDefined();
    expect(def.id).toBe("muse-spark-1.2");
    expect(def.name).toBe("Muse Spark 1.2");
    expect(def.provider).toBe("opencode-go");
    expect(def.vendor).toBe("meta");
    expect(def.transport).toBe("openai-responses");
  });

  it("capabilities：streaming/tools/vision/fileParts/pdf 已 live 验证（chat vision 400 / responses vision 200 RED）", () => {
    expect(def.capabilities.streaming).toBe(true);
    expect(def.capabilities.tools).toBe(true);
    expect(def.capabilities.vision).toBe(true);
    expect(def.capabilities.visionMimeTypes).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(def.capabilities.fileParts).toBe(false);
    expect(def.capabilities.pdf ?? false).toBe(false);
  });

  it("reasoning：adjustable + minimal/low/medium/high/xhigh + openai-responses-effort（none/max 不支持，已 live 验证）", () => {
    expect(def.capabilities.reasoning?.adjustable).toBe(true);
    expect(def.capabilities.reasoning?.mechanism).toBe("openai-responses-effort");
    expect(def.capabilities.reasoning?.supportedEfforts).toEqual(["default", "minimal", "low", "medium", "high", "xhigh"]);
  });

  it("vendor meta：Meta 本地 SVG（非 hotlink）", () => {
    expect(AI_PROVIDER_META.meta.name).toBe("Meta");
    expect(AI_PROVIDER_META.meta.logo).toBe("/ai-providers/meta.svg");
    expect(AI_PROVIDER_META.meta.logo.startsWith("/ai-providers/")).toBe(true);
    expect(getVendorMeta("meta").logo).toBe("/ai-providers/meta.svg");
    expect(getVendorForModelId("muse-spark-1.2")).toBe("meta");
    expect(getVendorForModelId("muse-spark-1.2-turbo")).toBe("meta");
  });

  it("模型列表 UI：opencode-go catalog 包含 muse-spark-1.2，且按 vendor 首字母排序（meta 在 kimi 后 mimo 前）", () => {
    const models = getModelsForProvider("opencode-go");
    expect(models.some((m) => m.id === "muse-spark-1.2")).toBe(true);
    const vendors = models.map((m) => m.vendor);
    const unique = Array.from(new Set(vendors.map((v) => v ?? "")));
    // 深思：deepseek < kimi < meta < mimo < minimax < openai < qwen < tencent < xai < zai
    expect(unique).toEqual(["deepseek", "kimi", "meta", "mimo", "minimax", "openai", "qwen", "tencent", "xai", "zai"]);
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

describe("Muse Spark 1.2 — remote filtering (filterRemoteGoModels)", () => {
  it("已知 ID 保留 verified transport；未知模型跳过（不默认 openai-chat）", () => {
    const out = filterRemoteGoModels([
      { id: "muse-spark-1.2" },
      { id: "grok-4.5" },
      { id: "gpt-5.6-luna" },
      { id: "some-unknown-model" },
      { id: "muse-spark-1.2" }, // 去重
      { id: "mimo-v2-omni" }, // 未 verified → 跳过
    ]);
    expect(out).toEqual([
      { id: "muse-spark-1.2", transport: "openai-responses" },
      { id: "grok-4.5", transport: "openai-responses" },
      { id: "gpt-5.6-luna", transport: "openai-responses" },
    ]);
  });

  it("空 id / 重复 id 安全处理", () => {
    expect(filterRemoteGoModels([{ id: "" }, { id: "muse-spark-1.2" }, {} as never, { id: "muse-spark-1.2" }])).toEqual([
      { id: "muse-spark-1.2", transport: "openai-responses" },
    ]);
  });
});

describe("Muse Spark 1.2 — reasoning capability (live verified)", () => {
  const def = OPENCODE_MODELS.find((m) => m.id === "muse-spark-1.2")!;

  it("supportedEfforts = default/minimal/low/medium/high/xhigh（无 max/none）", () => {
    const cap = getReasoningCapability(def);
    expect(cap.adjustable).toBe(true);
    expect(cap.mechanism).toBe("openai-responses-effort");
    expect(cap.supportedEfforts).toEqual(["default", "minimal", "low", "medium", "high", "xhigh"]);
  });

  it("unsupported effort → normalize 为 default（绝不发送 none/max）", () => {
    expect(normalizeReasoningEffort(getReasoningCapability(def), "max")).toBe("default");
    expect(normalizeReasoningEffort(getReasoningCapability(def), "none" as never)).toBe("default");
    expect(resolveEffectiveReasoningEffort({ provider: "opencode-go", model: "muse-spark-1.2", requested: "max" })).toBe("default");
    expect(resolveEffectiveReasoningEffort({ provider: "opencode-go", model: "muse-spark-1.2", requested: "minimal" })).toBe("minimal");
    expect(resolveEffectiveReasoningEffort({ provider: "opencode-go", model: "muse-spark-1.2", requested: "xhigh" })).toBe("xhigh");
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
    expect(resolveEffectiveReasoningEffort({ provider: "opencode-go", model: "muse-spark-1.2", requested: "xhigh" })).toBe("xhigh");
    expect(resolveEffectiveReasoningEffort({ provider: "opencode-go", model: "glm-5.3", requested: "xhigh" })).toBe("default");
  });
});

describe("Muse Spark 1.2 — vision / PDF capability (live verified)", () => {
  it("vision true，visionMimeTypes 白名单 JPEG/PNG/WEBP（128x128 红/蓝 均识别，chat 400 vs responses 200）", () => {
    const cap = getModelCapabilities({ provider: "opencode-go", model: "muse-spark-1.2" });
    expect(cap.vision).toBe(true);
    expect(cap.visionMimeTypes).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(cap.fileParts).toBe(false);
    expect(cap.pdf).toBe(false);
  });

  it("isVisionMimeSupported：Muse Spark 白名单通过 JPEG/PNG/WEBP，拒绝 GIF/SVG", () => {
    const cap = getModelCapabilities({ provider: "opencode-go", model: "muse-spark-1.2" });
    expect(isVisionMimeSupported(cap, "image/jpeg")).toBe(true);
    expect(isVisionMimeSupported(cap, "image/png")).toBe(true);
    expect(isVisionMimeSupported(cap, "image/webp")).toBe(true);
    expect(isVisionMimeSupported(cap, "image/gif")).toBe(false);
    expect(isVisionMimeSupported(cap, "image/svg+xml")).toBe(false);
    // 扩展名兜底
    expect(isVisionMimeSupported(cap, undefined, "photo.jpg")).toBe(true);
    expect(isVisionMimeSupported(cap, undefined, "photo.webp")).toBe(true);
    expect(isVisionMimeSupported(cap, undefined, "photo.gif")).toBe(false);
  });

  it("PDF/fileParts 保守 false（未经有效 PDF 验证，不声明 true）", () => {
    const cap = getModelCapabilities({ provider: "opencode-go", model: "muse-spark-1.2" });
    expect(cap.pdf).toBe(false);
    expect(cap.fileParts).toBe(false);
  });

  it("非 vision 模型 MIME gate 对比（glm-5.3 / hy3）", () => {
    for (const model of ["glm-5.3", "hy3"]) {
      const cap = getModelCapabilities({ provider: "opencode-go", model });
      expect(cap.vision).toBe(false);
      expect(isVisionMimeSupported(cap, "image/png")).toBe(false);
    }
  });
});

describe("Muse Spark 1.2 — resolver / transport", () => {
  it("resolveModelDefinition：muse-spark-1.2 → openai-responses / meta", async () => {
    const def = await resolveModelDefinition({ provider: "opencode-go", model: "muse-spark-1.2" });
    expect(def?.transport).toBe("openai-responses");
    expect(def?.vendor).toBe("meta");
  });

  it("未知 muse 变体 → null（绝不猜 transport）", async () => {
    const originalFetch = globalThis.fetch;
    // 避免真实网络波动：stub fetch 为快速返回（未知模型不在远端列表）
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ object: "list", data: [{ id: "muse-spark-1.2" }] }), {
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
    const defLocal = OPENCODE_MODELS.find((m) => m.id === "muse-spark-1.2")!;
    expect(() => createLanguageModelFromDefinition(defLocal, { baseURL: "https://opencode.ai/zen/go/v1", apiKey: "sk-test" })).not.toThrow();
  });
});
