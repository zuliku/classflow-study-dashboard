import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveModelDefinition, resolveLanguageModel, createLanguageModelFromDefinition } from "@/lib/ai/providers/resolver";
import { AIError } from "@/lib/ai/errors";
import { OPENCODE_MODELS } from "@/lib/ai/providers/openCodeGo";

const mocks = vi.hoisted(() => ({
  openAICompatibleFactory: vi.fn(),
  anthropicFactory: vi.fn(),
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

const openAICompatibleFactory = mocks.openAICompatibleFactory;
const anthropicFactory = mocks.anthropicFactory;

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
    expect(def?.vendor).toBeNull();
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

  it("F2. anthropic-messages → Anthropic adapter（Bearer authToken，baseURL 不含 /messages）", () => {
    const m = createLanguageModelFromDefinition(
      { id: "minimax-m3", name: "x", provider: "opencode-go", vendor: null, transport: "anthropic-messages", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
      { baseURL: "https://opencode.ai/zen/go/v1", apiKey: "sk-go" }
    );
    expect(providerOf(m)).toBe("anthropic");
    expect(modelIdOf(m)).toBe("minimax-m3");
    const args = (anthropicFactory.mock.calls[0] as unknown[])[0] as { baseURL?: string; authToken?: string; apiKey?: string };
    expect(args.baseURL).toBe("https://opencode.ai/zen/go/v1");
    expect(args.authToken).toBe("sk-go");
    expect(args.apiKey).toBeUndefined();
  });

  it("E. openai-responses → 明确 UNSUPPORTED_TRANSPORT（不偷偷降级为 openai-chat）", () => {
    expect(() =>
      createLanguageModelFromDefinition(
        { id: "gpt-5.6-luna", name: "x", provider: "opencode-go", vendor: null, transport: "openai-responses", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
        { baseURL: "https://opencode.ai/zen/go/v1", apiKey: "sk" }
      )
    ).toThrow(AIError);
    try {
      createLanguageModelFromDefinition(
        { id: "gpt-5.6-luna", name: "x", provider: "opencode-go", vendor: null, transport: "openai-responses", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
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

  it("Messages 模型 → Anthropic LanguageModel（authToken）", async () => {
    const resolved = await resolveLanguageModel({
      provider: "opencode-go",
      model: "minimax-m3",
      apiKey: "sk-go",
    });
    expect(resolved.definition.transport).toBe("anthropic-messages");
    expect(providerOf(resolved.model)).toBe("anthropic");
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
      "grok-4.5", "glm-5.2", "glm-5.1", "kimi-k3", "kimi-k2.7-code", "kimi-k2.6",
      "deepseek-v4-pro", "deepseek-v4-flash", "mimo-v2.5", "mimo-v2.5-pro", "hy3",
      "minimax-m3", "minimax-m2.7", "minimax-m2.5", "qwen3.8-max", "qwen3.7-max", "qwen3.7-plus", "qwen3.6-plus",
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });
});
