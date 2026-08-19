import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveModelDefinition, resolveLanguageModel, createLanguageModelFromDefinition } from "@/lib/ai/providers/resolver";
import { AIError } from "@/lib/ai/errors";
import { OPENCODE_MODELS } from "@/lib/ai/providers/openCodeGo";

const mocks = vi.hoisted(() => ({
  openAICompatibleFactory: vi.fn(),
  anthropicFactory: vi.fn(),
  openAIFactory: vi.fn(),
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: (opts: unknown) => {
    mocks.openAICompatibleFactory(opts);
    return (id: string) => ({ provider: "openai-compatible", modelId: id });
  },
}));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: (opts: unknown) => {
    mocks.anthropicFactory(opts);
    return (id: string) => ({ provider: "anthropic", modelId: id });
  },
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: (opts: unknown) => {
    mocks.openAIFactory(opts);
    return {
      responses: (id: string) => ({ provider: "openai", modelId: id, api: "responses" }),
    };
  },
}));

const openAICompatibleFactory = mocks.openAICompatibleFactory;
const anthropicFactory = mocks.anthropicFactory;
const openAIFactory = mocks.openAIFactory;

const providerOf = (m: unknown) => (m as { provider?: string }).provider ?? "";
const modelIdOf = (m: unknown) => (m as { modelId?: string }).modelId ?? "";

describe("resolveModelDefinition", () => {
  it("A. DeepSeek：deepseek-v4-flash → openai-chat", async () => {
    const def = await resolveModelDefinition({ provider: "deepseek", model: "deepseek-v4-flash" });
    expect(def?.transport).toBe("openai-chat");
    expect(def?.provider).toBe("deepseek");
  });

  it("B. OpenCode Messages：minimax-m3 → anthropic-messages", async () => {
    const def = await resolveModelDefinition({ provider: "opencode-go", model: "minimax-m3" });
    expect(def?.transport).toBe("anthropic-messages");
    expect(def?.vendor).toBe("minimax");
  });

  it("B2. OpenCode Responses：gpt-5.6-luna → openai-responses", async () => {
    const def = await resolveModelDefinition({ provider: "opencode-go", model: "gpt-5.6-luna" });
    expect(def?.transport).toBe("openai-responses");
    expect(def?.vendor).toBe("openai");
  });

  it("B3. OpenCode Responses：grok-4.5 → openai-responses", async () => {
    const def = await resolveModelDefinition({ provider: "opencode-go", model: "grok-4.5" });
    expect(def?.transport).toBe("openai-responses");
    expect(def?.vendor).toBe("xai");
  });

  it("B4. OpenCode Responses：muse-spark-1.2 → openai-responses / meta（live verified）", async () => {
    const def = await resolveModelDefinition({ provider: "opencode-go", model: "muse-spark-1.2" });
    expect(def?.transport).toBe("openai-responses");
    expect(def?.vendor).toBe("meta");
  });

  it("Custom 固定 openai-chat（不扩展 Anthropic-compatible）", async () => {
    const def = await resolveModelDefinition({ provider: "custom-openai", model: "my-model", custom: { providerName: "x", baseURL: "https://x.example.com/v1", model: "my-model" } });
    expect(def?.transport).toBe("openai-chat");
    expect(def?.id).toBe("my-model");
  });

  it("未知模型 → null（MODEL_UNAVAILABLE 由调用方处理）；空 model → null", async () => {
    expect(await resolveModelDefinition({ provider: "opencode-go", model: "brand-new-model" })).toBeNull();
    expect(await resolveModelDefinition({ provider: "deepseek", model: "" })).toBeNull();
  });
});

describe("createLanguageModelFromDefinition（Adapter 选择）", () => {
  beforeEach(() => {
    openAICompatibleFactory.mockClear();
    anthropicFactory.mockClear();
    openAIFactory.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("F1. openai-chat → OpenAI-compatible adapter（baseURL + apiKey；custom 带 noRedirect）", () => {
    const m = createLanguageModelFromDefinition(
      { id: "deepseek-v4-flash", name: "x", provider: "deepseek", vendor: null, transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
      { baseURL: "https://api.deepseek.com", apiKey: "sk-1" }
    );
    expect(providerOf(m)).toBe("openai-compatible");
    expect(modelIdOf(m)).toBe("deepseek-v4-flash");
    expect(openAICompatibleFactory).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "https://api.deepseek.com", apiKey: "sk-1" })
    );
  });

  it("F1b. DeepSeek V4 兼容：openai-chat 注入 thinking disabled transform，且只作用于 deepseek provider", () => {
    const deepseekModel = createLanguageModelFromDefinition(
      { id: "deepseek-v4-flash", name: "x", provider: "deepseek", vendor: "deepseek", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
      { baseURL: "https://api.deepseek.com", apiKey: "sk-1" }
    );
    const dsArgs = (openAICompatibleFactory.mock.calls[0] as unknown[])[0] as { transformRequestBody?: (body: Record<string, unknown>) => Record<string, unknown> };
    expect(typeof dsArgs.transformRequestBody).toBe("function");
    const body = dsArgs.transformRequestBody?.({ model: "deepseek-v4-flash", messages: [], tools: [] });
    expect(body?.thinking).toEqual({ type: "disabled" });
    // 非 deepseek 的其他 openai-chat（如 custom-openai）不得带 transform
    createLanguageModelFromDefinition(
      { id: "my-model", name: "x", provider: "custom-openai", vendor: null, transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
      { baseURL: "https://custom.example.com/v1", apiKey: "sk-2" }
    );
    const customArgs = (openAICompatibleFactory.mock.calls[1] as unknown[])[0] as { transformRequestBody?: unknown };
    expect(customArgs.transformRequestBody).toBeUndefined();
  });

  it("F1c. OpenCode Go chat：注入 tool-schema root transform，且不叠 DeepSeek thinking transform", () => {
    createLanguageModelFromDefinition(
      { id: "deepseek-v4-flash", name: "x", provider: "opencode-go", vendor: "deepseek", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
      { baseURL: "https://opencode.ai/zen/go/v1", apiKey: "sk-go" }
    );
    const ocArgs = (openAICompatibleFactory.mock.calls[0] as unknown[])[0] as { transformRequestBody?: (body: Record<string, unknown>) => Record<string, unknown> };
    expect(typeof ocArgs.transformRequestBody).toBe("function");
    // OpenCode transform 只修 tool schema 根，不注入 DeepSeek thinking
    const body = ocArgs.transformRequestBody?.({ model: "deepseek-v4-flash", messages: [], tools: [] });
    expect(body?.thinking).toBeUndefined();
    expect(body?.tools).toEqual([]);
    // DeepSeek direct：仍只使用 deepSeekTransformRequestBody（thinking disabled），不叠 OpenCode transform
    createLanguageModelFromDefinition(
      { id: "deepseek-v4-flash", name: "x", provider: "deepseek", vendor: "deepseek", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
      { baseURL: "https://api.deepseek.com", apiKey: "sk-1" }
    );
    const dsArgs = (openAICompatibleFactory.mock.calls[1] as unknown[])[0] as { transformRequestBody?: (body: Record<string, unknown>) => Record<string, unknown> };
    const dsBody = dsArgs.transformRequestBody?.({ model: "deepseek-v4-flash", messages: [], tools: [] });
    expect(dsBody?.thinking).toEqual({ type: "disabled" });
  });

  it("F2. anthropic-messages → Anthropic adapter（x-api-key / apiKey，baseURL 不含 /messages）", () => {
    const m = createLanguageModelFromDefinition(
      { id: "minimax-m3", name: "x", provider: "opencode-go", vendor: null, transport: "anthropic-messages", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
      { baseURL: "https://opencode.ai/zen/go/v1", apiKey: "sk-go" }
    );
    expect(providerOf(m)).toBe("anthropic");
    expect(modelIdOf(m)).toBe("minimax-m3");
    const args = (anthropicFactory.mock.calls[0] as unknown[])[0] as { baseURL?: string; authToken?: string; apiKey?: string; transformRequestBody?: unknown };
    expect(args.baseURL).toBe("https://opencode.ai/zen/go/v1");
    // V4.7.2 真实验证：OpenCode Go /v1/messages 接受 x-api-key（apiKey），Bearer authToken 返回 401
    expect(args.apiKey).toBe("sk-go");
    expect(args.authToken).toBeUndefined();
    expect(args.transformRequestBody).toBeUndefined(); // Anthropic transport 不受 DeepSeek 兼容层影响
  });

  it("F3. openai-responses → @ai-sdk/openai adapter（createOpenAI + 显式 .responses(modelId)）", () => {
    const m = createLanguageModelFromDefinition(
      { id: "gpt-5.6-luna", name: "GPT 5.6 Luna", provider: "opencode-go", vendor: null, transport: "openai-responses", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
      { baseURL: "https://opencode.ai/zen/go/v1", apiKey: "sk-go" }
    );
    expect(providerOf(m)).toBe("openai");
    expect(modelIdOf(m)).toBe("gpt-5.6-luna");
    expect((m as { api?: string }).api).toBe("responses");
    expect(openAIFactory).toHaveBeenCalledWith({
      name: "classflow-kiro",
      baseURL: "https://opencode.ai/zen/go/v1",
      apiKey: "sk-go",
    });
    // Responses 不得调用 openai-compatible / anthropic adapter
    expect(openAICompatibleFactory).not.toHaveBeenCalled();
    expect(anthropicFactory).not.toHaveBeenCalled();
  });

  it("F3b. grok-4.5 同样走 @ai-sdk/openai .responses", () => {
    const m = createLanguageModelFromDefinition(
      { id: "grok-4.5", name: "Grok 4.5", provider: "opencode-go", vendor: "xai", transport: "openai-responses", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
      { baseURL: "https://opencode.ai/zen/go/v1", apiKey: "sk-go" }
    );
    expect(providerOf(m)).toBe("openai");
    expect(modelIdOf(m)).toBe("grok-4.5");
    expect(openAIFactory).toHaveBeenCalledTimes(1);
    expect(openAICompatibleFactory).not.toHaveBeenCalled();
  });

  it("F3c. muse-spark-1.2 同样走 @ai-sdk/openai .responses（meta vendor，live verified）", () => {
    const m = createLanguageModelFromDefinition(
      { id: "muse-spark-1.2", name: "Muse Spark 1.2", provider: "opencode-go", vendor: "meta", transport: "openai-responses", capabilities: { streaming: true, tools: true, vision: true, fileParts: false, visionMimeTypes: ["image/jpeg", "image/png", "image/webp"] } },
      { baseURL: "https://opencode.ai/zen/go/v1", apiKey: "sk-go" }
    );
    expect(providerOf(m)).toBe("openai");
    expect(modelIdOf(m)).toBe("muse-spark-1.2");
    expect((m as { api?: string }).api).toBe("responses");
    expect(openAIFactory).toHaveBeenCalledTimes(1);
    expect(openAICompatibleFactory).not.toHaveBeenCalled();
    expect(anthropicFactory).not.toHaveBeenCalled();
  });

  it("F4. 未知 transport → 明确 UNSUPPORTED_TRANSPORT（不偷偷降级）", () => {
    expect(() =>
      createLanguageModelFromDefinition(
        { id: "mystery", name: "x", provider: "opencode-go", vendor: null, transport: "magic-transport" as never, capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
        { baseURL: "https://opencode.ai/zen/go/v1", apiKey: "sk" }
      )
    ).toThrow(AIError);
    try {
      createLanguageModelFromDefinition(
        { id: "mystery", name: "x", provider: "opencode-go", vendor: null, transport: "magic-transport" as never, capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
        { baseURL: "https://opencode.ai/zen/go/v1", apiKey: "sk" }
      );
    } catch (e) {
      expect((e as AIError).code).toBe("UNSUPPORTED_TRANSPORT");
    }
    expect(openAICompatibleFactory).not.toHaveBeenCalled();
  });
});

describe("resolveLanguageModel（统一入口）", () => {
  beforeEach(() => {
    openAICompatibleFactory.mockClear();
    anthropicFactory.mockClear();
    openAIFactory.mockClear();
  });

  it("Chat 模型 → 完整解析 + OpenAI-compatible LanguageModel", async () => {
    const resolved = await resolveLanguageModel({
      provider: "opencode-go",
      model: "deepseek-v4-flash",
      apiKey: "sk-go",
    });
    expect(resolved.definition.transport).toBe("openai-chat");
    expect(modelIdOf(resolved.model)).toBe("deepseek-v4-flash");
  });

  it("Messages 模型 → Anthropic LanguageModel（apiKey → x-api-key）", async () => {
    const resolved = await resolveLanguageModel({
      provider: "opencode-go",
      model: "minimax-m3",
      apiKey: "sk-go",
    });
    expect(resolved.definition.transport).toBe("anthropic-messages");
    expect(providerOf(resolved.model)).toBe("anthropic");
    const args = (anthropicFactory.mock.calls[0] as unknown[])[0] as { apiKey?: string; authToken?: string };
    expect(args.apiKey).toBe("sk-go");
    expect(args.authToken).toBeUndefined();
  });

  it("未知模型 → AIError MODEL_UNAVAILABLE", async () => {
    await expect(
      resolveLanguageModel({ provider: "opencode-go", model: "never-heard-of-it", apiKey: "sk" })
    ).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
  });
});

describe("OpenCode 注册表完整性", () => {
  it("OPENCODE_MODELS：每个模型 transport 均为已支持值；官方 endpoint 表模型全覆盖", () => {
    const ids = new Set(OPENCODE_MODELS.map((m) => m.id));
    for (const id of [
      "glm-5.3", "glm-5.2", "glm-5.1", "kimi-k3", "kimi-k2.7-code", "kimi-k2.6",
      "deepseek-v4-pro", "deepseek-v4-flash", "mimo-v2.5", "mimo-v2.5-pro", "hy3",
      "grok-4.5", "gpt-5.6-luna", "muse-spark-1.2",
      "minimax-m3", "minimax-m2.7", "minimax-m2.5", "qwen3.8-max", "qwen3.7-max", "qwen3.7-plus", "qwen3.6-plus",
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });
});
