/**
 * DeepSeek 真实回归测试（Task 4）+ Reasoning Phase 2 真实 Smoke（Thinking Mode）。
 *
 * 只在设置了 DEEPSEEK_TEST_API_KEY 环境变量时运行（CI 默认跳过，本地手动验证）：
 *   $env:DEEPSEEK_TEST_API_KEY = "sk-..." ; npx vitest run tests/aiDeepSeekRegression.test.ts
 *
 * 覆盖：
 * 1. Connection Test：generateText 无 tools → success（/api/ai/test 同语义）
 * 2. Kiro Chat：streamText + KIRO_TOOLS → 请求体含 thinking.type=disabled → 正常文本回答
 * 3. 完整 client-tool round：User → DeepSeek Tool Call → Browser Tool Result → 第二次模型请求 → 最终文本
 * 4. Smoke A（Reasoning Phase 2）：V4 Pro + high → thinking enabled + reasoning_effort=high → 普通问题正常回答
 * 5. Smoke B（Reasoning Phase 2，最重要）：完整 Tool round 中 reasoning_content 回传 continuation
 *    → 确认无 400 / 无 tool_choice / 第二次请求带 thinking + reasoning_content
 *
 * 测试绝不打印 / 断言 API Key 内容。
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { generateText, streamText, convertToModelMessages, tool, LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { resolveLanguageModel } from "@/lib/ai/providers/resolver";
import { deepSeekTransformRequestBody, DEEPSEEK_MODELS } from "@/lib/ai/providers/deepSeek";
import { KIRO_TOOLS } from "@/lib/ai/tools";
import { AI } from "@/lib/ai/config";
import { resolveReasoningProviderOptions } from "@/lib/ai/reasoning/providerOptions";

const KEY = process.env.DEEPSEEK_TEST_API_KEY ?? "";
const describeDeepSeek = KEY ? describe : describe.skip;
const TEST_TIMEOUT = 60_000;

describeDeepSeek("DeepSeek 真实回归（DEEPSEEK_TEST_API_KEY 存在时运行）", () => {
  const opts = { provider: "deepseek" as const, model: "deepseek-v4-flash", apiKey: KEY };

  it("Connection Test：generateText 无 tools → success", async () => {
    const { model } = await resolveLanguageModel(opts);
    const res = await generateText({ model, prompt: "只回复两个字母：OK", maxOutputTokens: 8 });
    expect(res.text.trim().length).toBeGreaterThan(0);
  }, TEST_TIMEOUT);

  it("request body 明确包含 thinking.type=disabled（纯函数断言，不依赖网络）", () => {
    const body = deepSeekTransformRequestBody({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "search_assignments" } }],
    });
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.tools).toHaveLength(1); // 不得删除 tools
  });

  it("DeepSeek schema 归一：无根 type 的工具 schema（z.discriminatedUnion）自动补 type=object", () => {
    // 与 create_reminder 相同结构：discriminatedUnion → 根节点无 type
    const badRoot = { anyOf: [{ type: "object", properties: { timingMode: { const: "relative" } } }] };
    const body = deepSeekTransformRequestBody({
      model: "deepseek-v4-flash",
      messages: [],
      tools: [{ type: "function", function: { name: "create_reminder", parameters: badRoot } }],
    });
    const params = (body.tools as { function: { parameters: Record<string, unknown> } }[])[0].function.parameters;
    expect(params.type).toBe("object");
    expect(params.anyOf).toHaveLength(1); // 分支保留
    // 已有 type:object 的 schema 原样保留
    const okSchema = { type: "object", properties: { a: { type: "string" } } };
    const body2 = deepSeekTransformRequestBody({
      tools: [{ type: "function", function: { name: "x", parameters: okSchema } }],
    });
    expect((body2.tools as { function: { parameters: unknown } }[])[0].function.parameters).toBe(okSchema);
  });

  it("Kiro Chat：streamText + KIRO_TOOLS → 正常文本回答", async () => {
    const { model } = await resolveLanguageModel(opts);
    const result = streamText({
      model,
      system: "你是 Kiro，ClassFlow 的学习助手。回答尽量简短。",
      messages: [{ role: "user", content: "只回答两个字：你好" }],
      tools: KIRO_TOOLS,
      maxOutputTokens: 256,
    });
    let text = "";
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") text += part.text;
    }
    expect(text.trim().length).toBeGreaterThan(0);
  }, TEST_TIMEOUT);

  it("完整 client-tool round：DeepSeek Tool Call → Tool Result → 第二次请求 → 最终文本", async () => {
    const { model } = await resolveLanguageModel(opts);
    const getTimeTool = {
      get_current_time: tool({
        description: "获取当前本地时间",
        inputSchema: z.object({}),
      }),
    };

    // 第一段：User → DeepSeek Tool Call（模拟 Browser 收到 tool-call 前）
    const userMsg: { role: "user"; content: string } = {
      role: "user",
      content: "现在是几点？必须调用 get_current_time 工具获取时间后再回答",
    };
    const r1 = await streamText({
      model,
      messages: [userMsg],
      tools: getTimeTool,
      maxOutputTokens: 256,
    });
    const content = await r1.content;
    const calls = content.filter((p) => p.type === "tool-call") as {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      input: unknown;
    }[];
    expect(calls.length).toBeGreaterThan(0);

    // 第二段：Browser Tool Result 以 UIMessage 形状回传（v7：assistant 消息内
    // 单个 dynamic-tool part，addToolOutput 原地更新 state 为 output-available）
    // → convertToModelMessages（与 /api/ai/chat 同款转换）→ 第二次模型请求
    const uiMessages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "现在是几点？必须调用 get_current_time 工具获取时间后再回答" }] },
      {
        id: "a1",
        role: "assistant",
        parts: calls.map((c) => ({
          type: "dynamic-tool",
          state: "output-available",
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          input: c.input,
          output: { now: "2026-08-11 10:00:00" },
        })),
      },
    ];
    const modelMessages = await convertToModelMessages(uiMessages as never);
    const r2 = await streamText({ model, messages: modelMessages, tools: getTimeTool, maxOutputTokens: 256 });
    let text = "";
    for await (const part of r2.fullStream) {
      if (part.type === "text-delta") text += part.text;
    }
    expect(text.trim().length).toBeGreaterThan(0);
  }, TEST_TIMEOUT);
});

describeDeepSeek("DeepSeek Reasoning Phase 2 真实 Smoke（Thinking Mode）", () => {
  const SMOKE_TIMEOUT = 120_000;
  const v4ProDef = DEEPSEEK_MODELS.find((m) => m.id === "deepseek-v4-pro")!;

  /** 捕获每次真实请求 body（断言 thinking / reasoning_effort / tool_choice / reasoning_content） */
  const captureBodies = (): { bodies: Record<string, unknown>[]; model: LanguageModel } => {
    const bodies: Record<string, unknown>[] = [];
    const spy: typeof fetch = async (input, init) => {
      const body = (init as RequestInit | undefined)?.body;
      if (typeof body === "string") {
        try {
          bodies.push(JSON.parse(body) as Record<string, unknown>);
        } catch {
          // 忽略不可解析 body（只用于断言）
        }
      }
      return fetch(input, init);
    };
    // 与 resolver.ts 的 DeepSeek 构造完全一致（name/baseURL/apiKey/transformRequestBody）
    const model = createOpenAICompatible({
      name: "classflow-kiro",
      baseURL: AI.DEEPSEEK_BASE_URL,
      apiKey: KEY,
      transformRequestBody: deepSeekTransformRequestBody,
      fetch: spy,
    })("deepseek-v4-pro");
    return { bodies, model };
  };

  it("Smoke A：V4 Pro + high → thinking enabled + reasoning_effort=high，普通问题正常回答（无 400）", async () => {
    const { bodies, model } = captureBodies();
    const options = resolveReasoningProviderOptions({ definition: v4ProDef, effort: "high" });
    expect(options).toEqual({ thinking: { type: "enabled" }, reasoningEffort: "high" });

    const result = streamText({
      model,
      messages: [{ role: "user", content: "比较 9.11 和 9.8，并解释原因。" }],
      maxOutputTokens: 1024,
      providerOptions: { "classflow-kiro": options } as Parameters<typeof streamText>[0]["providerOptions"],
    });
    let text = "";
    let reasoning = "";
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") text += part.text;
      if (part.type === "reasoning-delta") reasoning += part.text;
    }
    expect(text.trim().length).toBeGreaterThan(0);
    expect(reasoning.length).toBeGreaterThan(0);

    const body = bodies[0];
    expect((body.thinking as { type: string }).type).toBe("enabled");
    expect(body.reasoning_effort).toBe("high");
    expect("tool_choice" in body).toBe(false);
  }, SMOKE_TIMEOUT);

  it("Smoke B：V4 Pro + high → 完整 client-tool round（thinking → tool call → reasoning_content 回传 continuation → final）", async () => {
    const { bodies, model } = captureBodies();
    const options = resolveReasoningProviderOptions({ definition: v4ProDef, effort: "high" });
    expect(options).toEqual({ thinking: { type: "enabled" }, reasoningEffort: "high" });
    const getTimeTool = {
      get_current_time: tool({
        description: "获取当前本地时间",
        inputSchema: z.object({}),
      }),
    };
    const userMsg = "现在是几点？必须调用 get_current_time 工具获取时间后再回答";

    // 第一段：user → DeepSeek（thinking）→ tool call（thinking mode 下不发送 tool_choice）
    const r1 = await streamText({
      model,
      messages: [{ role: "user", content: userMsg }],
      tools: getTimeTool,
      maxOutputTokens: 1024,
      providerOptions: { "classflow-kiro": options } as Parameters<typeof streamText>[0]["providerOptions"],
    });
    let reasoning1 = "";
    for await (const part of r1.fullStream) {
      if (part.type === "reasoning-delta") reasoning1 += part.text;
    }
    const content = await r1.content;
    const calls = content.filter((p) => p.type === "tool-call") as {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      input: unknown;
    }[];
    expect(calls.length).toBeGreaterThan(0);
    expect(reasoning1.length).toBeGreaterThan(0);

    const body1 = bodies[0];
    expect((body1.thinking as { type: string }).type).toBe("enabled");
    expect(body1.reasoning_effort).toBe("high");
    expect("tool_choice" in body1).toBe(false);

    // 第二段：Browser Tool Result（UIMessage 形状，同 /api/ai/chat 的 client continuation）。
    // assistant 消息必须携带 r1 的 reasoning part（真实 client 的 UIMessage 同样包含它）：
    // convertToModelMessages → reasoning part → 下一次请求 assistant.reasoning_content。
    const uiMessages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: userMsg }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          ...(reasoning1.length > 0 ? [{ type: "reasoning", text: reasoning1 }] : []),
          ...calls.map((c) => ({
            type: "dynamic-tool",
            state: "output-available",
            toolCallId: c.toolCallId,
            toolName: c.toolName,
            input: c.input,
            output: { now: "2026-08-15 12:00:00" },
          })),
        ],
      },
    ];
    const modelMessages = await convertToModelMessages(uiMessages as never);
    const r2 = await streamText({
      model,
      messages: modelMessages,
      tools: {},
      maxOutputTokens: 1024,
      providerOptions: { "classflow-kiro": options } as Parameters<typeof streamText>[0]["providerOptions"],
    });
    let text2 = "";
    for await (const part of r2.fullStream) {
      if (part.type === "text-delta") text2 += part.text;
    }
    expect(text2.trim().length).toBeGreaterThan(0);

    const body2 = bodies[1];
    expect((body2.thinking as { type: string }).type).toBe("enabled");
    expect(body2.reasoning_effort).toBe("high");
    expect("tool_choice" in body2).toBe(false);
    const assistantMsg = (body2.messages as { role: string; reasoning_content?: string }[]).find(
      (m) => m.role === "assistant"
    );
    expect(typeof assistantMsg?.reasoning_content).toBe("string");
    expect((assistantMsg?.reasoning_content ?? "").length).toBeGreaterThan(0);
  }, SMOKE_TIMEOUT);
});
