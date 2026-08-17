/**
 * DeepSeek 最小 Tool Smoke（Analytics V2 · Part 3）。
 * 只在设置了 DEEPSEEK_TEST_API_KEY 环境变量时运行（CI 默认跳过）：
 *   $env:DEEPSEEK_TEST_API_KEY = "sk-..." ; npx vitest run tests/aiDeepSeekKiroOutlookSmoke.test.ts
 *
 * 目的：验证 DeepSeek + 新 get_learning_outlook Tool Schema + client tool continuation，
 * 成本最小化（2 次请求，maxOutputTokens 128/96，简短 system）。
 * 测试绝不打印 / 断言 API Key 内容。
 */
import { it, expect } from "vitest";
import { z } from "zod";
import { streamText, convertToModelMessages, tool } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { deepSeekTransformRequestBody } from "@/lib/ai/providers/deepSeek";
import { AI } from "@/lib/ai/config";
import { getLearningOutlookSchema } from "@/lib/ai/tools/read/schemas";

const KEY = process.env.DEEPSEEK_TEST_API_KEY ?? "";
const run = KEY ? it : it.skip;
const TEST_TIMEOUT = 90_000;

const getOutlookTool = {
  get_learning_outlook: tool({
    description:
      "返回未来 7/14 天的确定性学习前瞻：截止任务与 Deadline Health、已安排/缺口分钟、截止前可用空闲、缺少估时任务、每日瓶颈与估时校准参考。",
    inputSchema: getLearningOutlookSchema,
  }),
};

run("DeepSeek → get_learning_outlook Tool Call → Tool Result → final（2 请求，低 token）", async () => {
  const model = createOpenAICompatible({
    name: "classflow-kiro",
    baseURL: AI.DEEPSEEK_BASE_URL,
    apiKey: KEY,
    transformRequestBody: deepSeekTransformRequestBody,
  })("deepseek-v4-flash");

  const userMsg = "查看我未来7天的学习安排。必须先调用 get_learning_outlook；得到结果后只回复一句简短结论。";
  const system = "你是 ClassFlow Kiro；必须使用提供的工具获取真实数据，回答简短。";

  // 第一请求：user → DeepSeek → 应产出 get_learning_outlook tool call
  const r1 = await streamText({
    model,
    system,
    messages: [{ role: "user", content: userMsg }],
    tools: getOutlookTool,
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
  expect(calls[0].toolName).toBe("get_learning_outlook");
  expect((calls[0].input as { horizonDays?: number }).horizonDays).toBe(7);

  // 模拟 Browser Tool Output（确定性 mock；真实数据链路由 E2E 覆盖）
  const mockOutput = {
    horizonDays: 7,
    counts: { totalDue: 2, overdue: 0, atRisk: 1, attention: 0, unscheduled: 0, safe: 0, unknown: 1, missingEstimate: 1, noDeadline: 0 },
    tasks: [
      { assignmentId: "a1", title: "概率论作业", deadline: "2026-08-20T23:59:00", estimatedMinutes: 90, health: "at-risk", reasons: ["insufficient_available_time"] },
      { assignmentId: "a2", title: "英语展示", deadline: "2026-08-22T18:00:00", estimatedMinutes: null, health: "unknown", reasons: ["missing_estimate"] },
    ],
  };

  // 第二请求：Browser Tool Result 以 UIMessage 形状回传（同 /api/ai/chat 的 client continuation）
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
        output: mockOutput,
      })),
    },
  ];
  const modelMessages = await convertToModelMessages(uiMessages as never);
  const r2 = await streamText({
    model,
    system,
    messages: modelMessages,
    tools: getOutlookTool,
    maxOutputTokens: 96,
  });
  let text = "";
  for await (const part of r2.fullStream) {
    if (part.type === "text-delta") text += part.text;
  }
  expect(text.trim().length).toBeGreaterThan(0);
}, TEST_TIMEOUT);
