/**
 * DeepSeek 真实回归测试（Task 4）。
 *
 * 只在设置了 DEEPSEEK_TEST_API_KEY 环境变量时运行（CI 默认跳过，本地手动验证）：
 *   $env:DEEPSEEK_TEST_API_KEY = "sk-..." ; npx vitest run tests/aiDeepSeekRegression.test.ts
 *
 * 覆盖：
 * 1. Connection Test：generateText 无 tools → success（/api/ai/test 同语义）
 * 2. Kiro Chat：streamText + KIRO_TOOLS → 请求体含 thinking.type=disabled → 正常文本回答
 * 3. 完整 client-tool round：User → DeepSeek Tool Call → Browser Tool Result → 第二次模型请求 → 最终文本
 *
 * 测试绝不打印 / 断言 API Key 内容。
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { generateText, streamText, convertToModelMessages, tool } from "ai";
import { resolveLanguageModel } from "@/lib/ai/providers/resolver";
import { deepSeekTransformRequestBody } from "@/lib/ai/providers/deepSeek";
import { KIRO_TOOLS } from "@/lib/ai/tools";

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
