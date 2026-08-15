/**
 * Kimi K3 Reasoning 真实 smoke（Phase 3.5A）。
 *
 * 双 gate：
 *   $env:OPENCODE_GO_TEST_API_KEY = "sk-..."     （必需）
 *   $env:OPENCODE_GO_KIMI_REASONING_SMOKE = "1"  （显式开启，默认 skip）
 *
 * 只跑最小场景（成本控制）：
 *   Kimi K3 + reasoning effort=low + 1 次简单 tool call + 1 次 continuation。
 * 不跑 Vision / 全档位真实 API / full matrix（HTTP body 档位已在 mocked fetch 测试覆盖）。
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { streamText, convertToModelMessages, tool } from "ai";
import { resolveLanguageModel } from "@/lib/ai/providers/resolver";
import { OPENCODE_MODELS } from "@/lib/ai/providers/openCodeGo";
import { resolveReasoningProviderOptions } from "@/lib/ai/reasoning/providerOptions";

const KEY = process.env.OPENCODE_GO_TEST_API_KEY ?? "";
const ENABLED = process.env.OPENCODE_GO_KIMI_REASONING_SMOKE === "1";
const describeKimi = KEY && ENABLED ? describe : describe.skip;
const TIMEOUT = 90_000;

const kimiDef = OPENCODE_MODELS.find((m) => m.id === "kimi-k3")!;

describeKimi("Kimi K3 Reasoning real smoke（OPENCODE_GO_TEST_API_KEY + OPENCODE_GO_KIMI_REASONING_SMOKE=1）", () => {
  it("low + client tool round：reasoning → tool call → continuation → final text", async () => {
    const { model } = await resolveLanguageModel({ provider: "opencode-go", model: "kimi-k3", apiKey: KEY });
    const options = resolveReasoningProviderOptions({ definition: kimiDef, effort: "low" });
    expect(options).toEqual({ reasoningEffort: "low" });
    const getTimeTool = {
      get_current_time: tool({
        description: "获取当前本地时间",
        inputSchema: z.object({}),
      }),
    };
    const userMsg = "现在是几点？必须调用 get_current_time 工具获取时间后再回答";

    const r1 = await streamText({
      model,
      messages: [{ role: "user", content: userMsg }],
      tools: getTimeTool,
      maxOutputTokens: 512,
      providerOptions: (options ? { "classflow-kiro": options } : undefined) as Parameters<typeof streamText>[0]["providerOptions"],
    });
    const content = await r1.content;
    const calls = content.filter((p) => p.type === "tool-call") as {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      input: unknown;
    }[];
    expect(calls.length).toBeGreaterThan(0);
    // streamText result.reasoning 是 PromiseLike（deprecated 但仍可用）→ await 取字符串
    const reasoningText = (await r1.reasoning)
      .map((p) => ("text" in p ? (p as { text: string }).text : ""))
      .join("");

    const uiMessages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: userMsg }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          ...(reasoningText ? [{ type: "reasoning", text: reasoningText }] : []),
          ...calls.map((c) => ({
            type: "dynamic-tool",
            state: "output-available",
            toolCallId: c.toolCallId,
            toolName: c.toolName,
            input: c.input,
            output: { now: "2026-08-15 12:00:00" }, // JSON-safe
          })),
        ],
      },
    ];
    const modelMessages = await convertToModelMessages(uiMessages as never);
    const r2 = await streamText({
      model,
      messages: modelMessages,
      tools: {},
      maxOutputTokens: 512,
      providerOptions: (options ? { "classflow-kiro": options } : undefined) as Parameters<typeof streamText>[0]["providerOptions"],
    });
    let text = "";
    for await (const part of r2.fullStream) {
      if (part.type === "text-delta") text += part.text;
    }
    expect(text.trim().length).toBeGreaterThan(0);
  }, TIMEOUT);
});
