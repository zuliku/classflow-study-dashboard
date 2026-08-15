/**
 * Kimi K3 Reasoning（Phase 3.5A）focused tests：
 * 1. capability：default / low / high / max（无 medium）
 * 2. HTTP body capture（生产 resolver + mocked fetch）：default/low/high/max、medium 归一
 * 3. Custom Provider（mechanism "effort"）passthrough 无回归
 * 4. Preserved Thinking：ModelMessage reasoning + tool_calls → 下一次 HTTP assistant history
 * 5. UIMessage → convertToModelMessages → continuation 保留 reasoning
 *
 * 全部走生产 resolver（resolveLanguageModel → createOpenAICompatible），仅 stub global fetch。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { generateText, convertToModelMessages, tool } from "ai";
import { resolveLanguageModel } from "@/lib/ai/providers/resolver";
import { OPENCODE_MODELS } from "@/lib/ai/providers/openCodeGo";
import {
  getReasoningCapability,
  normalizeReasoningEffort,
  resolveReasoningProviderOptions,
} from "@/lib/ai/reasoning/providerOptions";
import { resolveEffectiveReasoningEffort } from "@/lib/ai/reasoning/effective";

const KEY = "sk-test-kimi";

const FAKE_COMPLETION: Record<string, unknown> = {
  id: "chatcmpl_1",
  object: "chat.completion",
  created: 0,
  model: "kimi-k3",
  choices: [
    { index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" },
  ],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

/** 捕获生产 resolver 发出的 /chat/completions 请求体 */
function captureKimiRequests() {
  const bodies: Record<string, unknown>[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body;
    if (typeof body === "string") {
      try {
        bodies.push(JSON.parse(body) as Record<string, unknown>);
      } catch {
        // ignore
      }
    }
    return new Response(JSON.stringify(FAKE_COMPLETION), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { bodies, restore: () => (globalThis.fetch = originalFetch) };
}

const kimiDef = OPENCODE_MODELS.find((m) => m.id === "kimi-k3")!;

describe("Kimi K3 reasoning capability（Phase 3.5A）", () => {
  it("1. supportedEfforts = default/low/high/max（无 medium）", () => {
    const cap = getReasoningCapability(kimiDef);
    expect(cap.adjustable).toBe(true);
    expect(cap.supportedEfforts).toEqual(["default", "low", "high", "max"]);
    expect(cap.mechanism).toBe("effort");
  });

  it("2. requested=medium → normalize 为 default（绝不发送 medium）", () => {
    expect(normalizeReasoningEffort(getReasoningCapability(kimiDef), "medium")).toBe("default");
    expect(resolveEffectiveReasoningEffort({ provider: "opencode-go", model: "kimi-k3", requested: "medium" })).toBe("default");
    expect(resolveReasoningProviderOptions({ definition: kimiDef, effort: "medium" })).toBeUndefined();
  });

  it("default → undefined（不覆盖 provider 默认，非 thinking-disabled 语义）", () => {
    expect(resolveReasoningProviderOptions({ definition: kimiDef, effort: "default" })).toBeUndefined();
  });

  it("low/high/max → reasoningEffort 直通（max 不折叠）", () => {
    expect(resolveReasoningProviderOptions({ definition: kimiDef, effort: "low" })).toEqual({ reasoningEffort: "low" });
    expect(resolveReasoningProviderOptions({ definition: kimiDef, effort: "high" })).toEqual({ reasoningEffort: "high" });
    expect(resolveReasoningProviderOptions({ definition: kimiDef, effort: "max" })).toEqual({ reasoningEffort: "max" });
  });

  it("切换行为：requested max 切到固定模型 → default；切回 Kimi → max 恢复", () => {
    expect(resolveEffectiveReasoningEffort({ provider: "opencode-go", model: "kimi-k3", requested: "max" })).toBe("max");
    expect(resolveEffectiveReasoningEffort({ provider: "opencode-go", model: "glm-5.3", requested: "max" })).toBe("default");
  });
});

describe("Kimi HTTP body capture（生产 resolver → /chat/completions）", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const send = async (effort: string | undefined) => {
    const capture = captureKimiRequests();
    try {
      const { model } = await resolveLanguageModel({ provider: "opencode-go", model: "kimi-k3", apiKey: KEY });
      const options = effort
        ? resolveReasoningProviderOptions({ definition: kimiDef, effort: effort as never })
        : undefined;
      await generateText({
        model,
        messages: [{ role: "user", content: "hi" }],
        providerOptions: (options ? { "classflow-kiro": options } : undefined) as Parameters<typeof generateText>[0]["providerOptions"],
      });
    } finally {
      capture.restore();
    }
    return capture.bodies[0];
  };

  it("3. default：body 无 reasoning_effort", async () => {
    const body = await send(undefined);
    expect("reasoning_effort" in body).toBe(false);
  });

  it("4. low → reasoning_effort = low", async () => {
    const body = await send("low");
    expect(body.reasoning_effort).toBe("low");
  });

  it("5. high → reasoning_effort = high", async () => {
    const body = await send("high");
    expect(body.reasoning_effort).toBe("high");
  });

  it("6. max → reasoning_effort = max（不是 medium）", async () => {
    const body = await send("max");
    expect(body.reasoning_effort).toBe("max");
  });

  it("medium → 归一 default：body 无 reasoning_effort，绝不出现 medium", async () => {
    const body = await send("medium");
    expect("reasoning_effort" in body).toBe(false);
  });
});

describe("Custom Provider（mechanism effort）passthrough 回归", () => {
  it("7. Custom low/medium/high 仍正确映射（medium 不被破坏）", () => {
    const custom = { providerName: "x", baseURL: "https://x.example", model: "m", reasoningEffort: true };
    expect(resolveReasoningProviderOptions({ definition: null, custom, effort: "low" })).toEqual({ reasoningEffort: "low" });
    expect(resolveReasoningProviderOptions({ definition: null, custom, effort: "medium" })).toEqual({ reasoningEffort: "medium" });
    expect(resolveReasoningProviderOptions({ definition: null, custom, effort: "high" })).toEqual({ reasoningEffort: "high" });
  });
});

describe("Kimi Preserved Thinking（assistant reasoning → continuation）", () => {
  afterEach(() => vi.restoreAllMocks());

  it("8. ModelMessage：assistant reasoning + tool_calls 保留在下次 HTTP history（reasoning_content）", async () => {
    const capture = captureKimiRequests();
    try {
      const { model } = await resolveLanguageModel({ provider: "opencode-go", model: "kimi-k3", apiKey: KEY });
      const history = [
        { role: "user" as const, content: [{ type: "text" as const, text: "现在是几点？" }] },
        {
          role: "assistant" as const,
          content: [
            { type: "reasoning" as const, text: "用户需要当前时间，我需要调用工具获取" },
            { type: "tool-call" as const, toolCallId: "call_1", toolName: "get_current_time", input: {} },
          ],
        },
        {
          role: "tool" as const,
          content: [
            {
              type: "tool-result" as const,
              toolCallId: "call_1",
              toolName: "get_current_time",
              output: { type: "json" as const, value: { now: "2026-08-15 12:00:00" } },
            },
          ],
        },
      ];
      await generateText({
        model,
        messages: history,
        tools: {
          get_current_time: tool({ description: "获取当前本地时间", inputSchema: z.object({}) }),
        },
      });
    } finally {
      capture.restore();
    }
    const body = capture.bodies[0];
    const messages = body.messages as { role: string; reasoning_content?: string; tool_calls?: unknown[] }[];
    const assistantMsg = messages.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    // preserved thinking：assistant reasoning 必须序列化进 history（reasoning_content）
    expect(typeof assistantMsg?.reasoning_content).toBe("string");
    expect((assistantMsg?.reasoning_content ?? "").length).toBeGreaterThan(0);
    // tool_calls 同时保留
    expect(Array.isArray(assistantMsg?.tool_calls)).toBe(true);
    expect((assistantMsg?.tool_calls ?? []).length).toBeGreaterThan(0);
  });

  it("9+10. UIMessage → convertToModelMessages → continuation：reasoning 未丢失，tool result 后的请求仍带 assistant reasoning history", async () => {
    const capture = captureKimiRequests();
    try {
      const { model } = await resolveLanguageModel({ provider: "opencode-go", model: "kimi-k3", apiKey: KEY });
      const uiMessages = [
        { id: "u1", role: "user" as const, parts: [{ type: "text" as const, text: "现在是几点？" }] },
        {
          id: "a1",
          role: "assistant" as const,
          parts: [
            // UIMessage reasoning part（toUIMessageStream 默认 sendReasoning=true 产生）
            { type: "reasoning" as const, text: "用户需要当前时间，我需要调用工具获取" },
            {
              type: "dynamic-tool" as const,
              state: "output-available" as const,
              toolCallId: "call_1",
              toolName: "get_current_time",
              input: {},
              output: { now: "2026-08-15 12:00:00" },
            },
          ],
        },
      ];
      const modelMessages = await convertToModelMessages(uiMessages as never);
      await generateText({
        model,
        messages: modelMessages,
        tools: {
          get_current_time: tool({ description: "获取当前本地时间", inputSchema: z.object({}) }),
        },
      });
    } finally {
      capture.restore();
    }
    const body = capture.bodies[0];
    const messages = body.messages as { role: string; reasoning_content?: string }[];
    const assistantMsg = messages.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(typeof assistantMsg?.reasoning_content).toBe("string");
    expect((assistantMsg?.reasoning_content ?? "").length).toBeGreaterThan(0);
  });
});
