import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveModelDefinition, resolveLanguageModel, createLanguageModelFromDefinition } from "@/lib/ai/providers/resolver";
import { AIError } from "@/lib/ai/errors";
import { AI } from "@/lib/ai/config";
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

  it("B3. OpenCode Responses：grok-4.7 → openai-responses", async () => {
    const def = await resolveModelDefinition({ provider: "opencode-go", model: "grok-4.7" });
    expect(def?.transport).toBe("openai-responses");
    expect(def?.vendor).toBe("xai");
  });

  it("B4. OpenCode：muse-spark-1.3-contributor → openai-responses / meta", async () => {
    const def = await resolveModelDefinition({ provider: "opencode-go", model: "muse-spark-1.3-contributor" });
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

  it("F0. OpenCode Go 官方 endpoint（2026-11 文档）：OpenAI / Anthropic / models 分路径", () => {
    expect(AI.OPENCODE_BASE_URL).toBe("https://opencode.ai/inference/go/openai/v1");
    expect(AI.OPENCODE_ANTHROPIC_BASE_URL).toBe("https://opencode.ai/inference/go/anthropic/v1");
    expect(AI.OPENCODE_MODELS_URL).toBe("https://opencode.ai/inference/go/v1/models");
  });

  it("F1c. OpenCode Go chat：官方 OpenAI Base + tool-schema root transform + UA/session", () => {
    createLanguageModelFromDefinition(
      { id: "deepseek-v4-flash", name: "x", provider: "opencode-go", vendor: "deepseek", transport: "openai-chat", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
      { baseURL: "https://ignored.example.com/v1", apiKey: "sk-go" }
    );
    const ocArgs = (openAICompatibleFactory.mock.calls[0] as unknown[])[0] as { baseURL?: string; transformRequestBody?: (body: Record<string, unknown>) => Record<string, unknown>; headers?: Record<string, string> };
    expect(ocArgs.baseURL).toBe(AI.OPENCODE_BASE_URL);
    expect(typeof ocArgs.transformRequestBody).toBe("function");
    // 官方要求：稳定 session + 自有 User-Agent
    expect(ocArgs.headers?.["x-opencode-session"]).toMatch(/^classflow-[0-9a-f]+$/);
    expect(ocArgs.headers?.["user-agent"]).toMatch(/^ClassFlow\//);
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

  it("F2. anthropic-messages → Anthropic adapter（Bearer authToken；Anthropic Base 不含 /messages）", () => {
    const m = createLanguageModelFromDefinition(
      { id: "minimax-m3", name: "x", provider: "opencode-go", vendor: null, transport: "anthropic-messages", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
      { baseURL: "https://ignored.example.com/v1", apiKey: "sk-go" }
    );
    expect(providerOf(m)).toBe("anthropic");
    expect(modelIdOf(m)).toBe("minimax-m3");
    const args = (anthropicFactory.mock.calls[0] as unknown[])[0] as { baseURL?: string; authToken?: string; apiKey?: string; transformRequestBody?: unknown; headers?: Record<string, string> };
    expect(args.baseURL).toBe(AI.OPENCODE_ANTHROPIC_BASE_URL);
    // 官方文档：Bearer <token>
    expect(args.authToken).toBe("sk-go");
    expect(args.apiKey).toBeUndefined();
    expect(args.transformRequestBody).toBeUndefined(); // Anthropic transport 不受 DeepSeek 兼容层影响
    expect(args.headers?.["x-opencode-session"]).toMatch(/^classflow-[0-9a-f]+$/);
    expect(args.headers?.["user-agent"]).toMatch(/^ClassFlow\//);
  });

  it("F3. openai-responses → @ai-sdk/openai adapter（OpenAI Base + 显式 .responses）", () => {
    const m = createLanguageModelFromDefinition(
      { id: "gpt-5.6-luna", name: "GPT 5.6 Luna", provider: "opencode-go", vendor: null, transport: "openai-responses", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
      { baseURL: "https://ignored.example.com/v1", apiKey: "sk-go" }
    );
    expect(providerOf(m)).toBe("openai");
    expect(modelIdOf(m)).toBe("gpt-5.6-luna");
    expect((m as { api?: string }).api).toBe("responses");
    expect(openAIFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "classflow-kiro",
        baseURL: AI.OPENCODE_BASE_URL,
        apiKey: "sk-go",
        headers: expect.objectContaining({
          "x-opencode-session": expect.stringMatching(/^classflow-[0-9a-f]+$/),
          "user-agent": expect.stringMatching(/^ClassFlow\//),
        }),
      })
    );
    // Responses 不得调用 openai-compatible / anthropic adapter
    expect(openAICompatibleFactory).not.toHaveBeenCalled();
    expect(anthropicFactory).not.toHaveBeenCalled();
  });

  it("F3b. grok-4.7 同样走 @ai-sdk/openai .responses", () => {
    const m = createLanguageModelFromDefinition(
      { id: "grok-4.7", name: "Grok 4.7", provider: "opencode-go", vendor: "xai", transport: "openai-responses", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
      { baseURL: "https://opencode.ai/inference/go/openai/v1", apiKey: "sk-go" }
    );
    expect(providerOf(m)).toBe("openai");
    expect(modelIdOf(m)).toBe("grok-4.7");
    expect(openAIFactory).toHaveBeenCalledTimes(1);
    expect(openAICompatibleFactory).not.toHaveBeenCalled();
  });

  it("F3c. muse-spark-1.3-contributor 走 @ai-sdk/openai .responses（meta vendor，保守 caps）", () => {
    const m = createLanguageModelFromDefinition(
      { id: "muse-spark-1.3-contributor", name: "Muse Spark 1.3", provider: "opencode-go", vendor: "meta", transport: "openai-responses", capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
      { baseURL: "https://opencode.ai/inference/go/openai/v1", apiKey: "sk-go" }
    );
    expect(providerOf(m)).toBe("openai");
    expect(modelIdOf(m)).toBe("muse-spark-1.3-contributor");
    expect((m as { api?: string }).api).toBe("responses");
    expect(openAIFactory).toHaveBeenCalledTimes(1);
    expect(openAICompatibleFactory).not.toHaveBeenCalled();
    expect(anthropicFactory).not.toHaveBeenCalled();
  });

  it("F4. 未知 transport → 明确 UNSUPPORTED_TRANSPORT（不偷偷降级）", () => {
    expect(() =>
      createLanguageModelFromDefinition(
        { id: "mystery", name: "x", provider: "opencode-go", vendor: null, transport: "magic-transport" as never, capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
        { baseURL: "https://opencode.ai/inference/go/openai/v1", apiKey: "sk" }
      )
    ).toThrow(AIError);
    try {
      createLanguageModelFromDefinition(
        { id: "mystery", name: "x", provider: "opencode-go", vendor: null, transport: "magic-transport" as never, capabilities: { streaming: true, tools: true, vision: false, fileParts: false } },
        { baseURL: "https://opencode.ai/inference/go/openai/v1", apiKey: "sk" }
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
      model: "deepseek-v4.1-flash",
      apiKey: "sk-go",
    });
    expect(resolved.definition.transport).toBe("openai-chat");
    expect(modelIdOf(resolved.model)).toBe("deepseek-v4.1-flash");
  });

  it("Messages 模型 → Anthropic LanguageModel（Bearer authToken）", async () => {
    const resolved = await resolveLanguageModel({
      provider: "opencode-go",
      model: "minimax-m3",
      apiKey: "sk-go",
    });
    expect(resolved.definition.transport).toBe("anthropic-messages");
    expect(providerOf(resolved.model)).toBe("anthropic");
    const args = (anthropicFactory.mock.calls[0] as unknown[])[0] as { apiKey?: string; authToken?: string };
    expect(args.authToken).toBe("sk-go");
    expect(args.apiKey).toBeUndefined();
  });

  it("未知模型 → AIError MODEL_UNAVAILABLE", async () => {
    await expect(
      resolveLanguageModel({ provider: "opencode-go", model: "never-heard-of-it", apiKey: "sk" })
    ).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
  });
});

describe("OpenCode 注册表完整性", () => {
  it("OPENCODE_MODELS：每个模型 transport 均为已支持值；2026-10-29 官方目录 28 款", () => {
    const ids = new Set(OPENCODE_MODELS.map((m) => m.id));
    expect(OPENCODE_MODELS).toHaveLength(28);
    for (const id of [
      "glm-5.3-flash", "glm-5.3", "glm-5.2", "kimi-k3",
      "kimi-k3.1-pro", "kimi-k2.7-code",
      "deepseek-v4.1-flash", "deepseek-v4-pro",
      "mimo-v2.5", "mimo-v2.5-pro", "mimo-v2.6-pro", "mimo-v2.6-flash",
      "hy3", "hy4-preview", "longcat-2.0", "step-5-preview",
      "gemini-4-argon", "minimax-m3.1-flash",
      "grok-4.7", "gpt-6-luna", "gpt-5.6-luna",
      "muse-spark-1.2-contributor", "muse-spark-1.3-contributor",
      "minimax-m3", "claude-haiku-5-5",
      "qwen3.7-plus", "qwen3.8-flash", "qwen3.8-max",
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });
});
