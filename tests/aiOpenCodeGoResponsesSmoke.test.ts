/**
 * OpenCode Go Responses 真实 smoke（Phase 3.1）。
 *
 * 只在设置了 OPENCODE_GO_TEST_API_KEY 环境变量时运行（CI 默认跳过，本地手动验证）：
 *   $env:OPENCODE_GO_TEST_API_KEY = "sk-..." ; npx vitest run tests/aiOpenCodeGoResponsesSmoke.test.ts
 *
 * 覆盖：
 * 1. Smoke A：GPT 5.6 Luna streamText 简单问题 → 命中 /v1/responses，有 text output，无 400
 * 2. Smoke B（client-tool round）：user → model tool call → JSON-safe tool output →
 *    convertToModelMessages continuation → final text（验证 Responses + Kiro UI 消息链兼容）
 *
 * 注意：Tool Output 必须是 JSON-safe 数据（string/number/boolean/null/array/plain object），
 * 不放 Date/Map/Set/class instance。
 *
 * 测试绝不打印 / 断言 API Key 内容。
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { streamText, convertToModelMessages, tool, LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { resolveLanguageModel } from "@/lib/ai/providers/resolver";
import { AI } from "@/lib/ai/config";

const KEY = process.env.OPENCODE_GO_TEST_API_KEY ?? "";
const describeGo = KEY ? describe : describe.skip;
const SMOKE_TIMEOUT = 60_000;

describeGo("OpenCode Go Responses 真实 smoke（OPENCODE_GO_TEST_API_KEY 存在时运行）", () => {
  const opts = { provider: "opencode-go" as const, model: "gpt-5.6-luna", apiKey: KEY };

  it("Smoke A：gpt-5.6-luna streamText → 命中 /v1/responses，text output，无 400", async () => {
    const hitUrls: string[] = [];
    // 与 resolver.ts 的 Responses 构造一致（name/baseURL/apiKey），仅额外捕获请求 URL
    const spy: typeof fetch = async (input, init) => {
      hitUrls.push(String(input));
      return fetch(input, init);
    };
    const model: LanguageModel = createOpenAI({
      name: "classflow-kiro",
      baseURL: AI.OPENCODE_BASE_URL,
      apiKey: KEY,
      fetch: spy,
    }).responses("gpt-5.6-luna");

    const result = streamText({
      model,
      messages: [{ role: "user", content: "只回复两个字母：OK" }],
      maxOutputTokens: 64,
    });
    let text = "";
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") text += part.text;
    }
    expect(text.trim().length).toBeGreaterThan(0);
    expect(hitUrls.some((u) => u.includes("/responses"))).toBe(true);
  }, SMOKE_TIMEOUT);

  it("Smoke B：gpt-5.6-luna client-tool round（tool call → JSON-safe output → continuation → final text）", async () => {
    const { model } = await resolveLanguageModel(opts);
    const getTimeTool = {
      get_current_time: tool({
        description: "获取当前本地时间",
        inputSchema: z.object({}),
      }),
    };
    const userMsg = "现在是几点？必须调用 get_current_time 工具获取时间后再回答";

    // 第一段：user → Responses model → tool call
    const r1 = await streamText({
      model,
      messages: [{ role: "user", content: userMsg }],
      tools: getTimeTool,
      maxOutputTokens: 128,
    });
    const content = await r1.content;
    const calls = content.filter((p) => p.type === "tool-call") as {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      input: unknown;
    }[];
    expect(calls.length).toBeGreaterThan(0);

    // 第二段：Browser Tool Result（UIMessage 形状，同 /api/ai/chat 的 client continuation）
    const uiMessages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: userMsg }] },
      {
        id: "a1",
        role: "assistant",
        parts: calls.map((c) => ({
          type: "dynamic-tool",
          state: "output-available",
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          input: c.input,
          output: { now: "2026-08-15 12:00:00" }, // JSON-safe plain object
        })),
      },
    ];
    const modelMessages = await convertToModelMessages(uiMessages as never);
    const r2 = await streamText({ model, messages: modelMessages, tools: {}, maxOutputTokens: 128 });
    let text = "";
    for await (const part of r2.fullStream) {
      if (part.type === "text-delta") text += part.text;
    }
    expect(text.trim().length).toBeGreaterThan(0);
  }, SMOKE_TIMEOUT);

  it("Smoke A（Phase 3.2A）：gpt-5.6-luna reasoning=low → body 含 reasoning.effort=low，text 正常", async () => {
    const bodies: Record<string, unknown>[] = [];
    const spy: typeof fetch = async (input, init) => {
      const body = (init as RequestInit | undefined)?.body;
      if (typeof body === "string") {
        try {
          bodies.push(JSON.parse(body) as Record<string, unknown>);
        } catch {
          // ignore
        }
      }
      return fetch(input, init);
    };
    const model: LanguageModel = createOpenAI({
      name: "classflow-kiro",
      baseURL: AI.OPENCODE_BASE_URL,
      apiKey: KEY,
      fetch: spy,
    }).responses("gpt-5.6-luna");

    const result = streamText({
      model,
      messages: [{ role: "user", content: "只回复两个字母：OK" }],
      maxOutputTokens: 128,
      providerOptions: { openai: { reasoningEffort: "low" } } as never,
    });
    let text = "";
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") text += part.text;
    }
    expect(text.trim().length).toBeGreaterThan(0);
    const body = bodies[0];
    expect((body.reasoning as { effort?: string }).effort).toBe("low");
  }, SMOKE_TIMEOUT);

  it("Smoke B（Phase 3.2A）：gpt-5.6-luna reasoning=high + client tool round（reasoning → tool call → continuation → final）", async () => {
    const { model } = await resolveLanguageModel(opts);
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
      maxOutputTokens: 256,
      providerOptions: { openai: { reasoningEffort: "high" } } as never,
    });
    const content = await r1.content;
    const calls = content.filter((p) => p.type === "tool-call") as {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      input: unknown;
    }[];
    expect(calls.length).toBeGreaterThan(0);

    const uiMessages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: userMsg }] },
      {
        id: "a1",
        role: "assistant",
        parts: calls.map((c) => ({
          type: "dynamic-tool",
          state: "output-available",
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          input: c.input,
          output: { now: "2026-08-15 12:00:00" },
        })),
      },
    ];
    const modelMessages = await convertToModelMessages(uiMessages as never);
    const r2 = await streamText({
      model,
      messages: modelMessages,
      tools: {},
      maxOutputTokens: 256,
      providerOptions: { openai: { reasoningEffort: "high" } } as never,
    });
    let text = "";
    for await (const part of r2.fullStream) {
      if (part.type === "text-delta") text += part.text;
    }
    expect(text.trim().length).toBeGreaterThan(0);
  }, SMOKE_TIMEOUT);

  it("Smoke C（Phase 3.2A，max probe）：gpt-5.6-luna reasoning=max 无 400（通过后手动把 max 加入 capability）", async () => {
    const { model } = await resolveLanguageModel(opts);
    const result = streamText({
      model,
      messages: [{ role: "user", content: "只回复两个字母：OK" }],
      maxOutputTokens: 128,
      providerOptions: { openai: { reasoningEffort: "max" } } as never,
    });
    let text = "";
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") text += part.text;
    }
    expect(text.trim().length).toBeGreaterThan(0);
  }, SMOKE_TIMEOUT);
});
