/**
 * DeepSeek 最小 Tool Schema Smoke（Analytics V2 · Part 5）。
 * 只在设置了 DEEPSEEK_TEST_API_KEY 环境变量时运行（CI 默认跳过）：
 *   $env:DEEPSEEK_TEST_API_KEY = "sk-..." ; npx vitest run tests/aiDeepSeekKiroRebalanceSmoke.test.ts
 *
 * 目的：验证新 propose_study_rebalance Tool Schema + client tool continuation；
 * 成本最小化（2 次请求，maxOutputTokens 128/80，简短 system）。
 * 测试绝不打印 / 断言 API Key 内容。
 */
import { it, expect } from "vitest";
import { z } from "zod";
import { streamText, convertToModelMessages, tool } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { deepSeekTransformRequestBody } from "@/lib/ai/providers/deepSeek";
import { AI } from "@/lib/ai/config";
import { proposeStudyRebalanceSchema } from "@/lib/ai/tools/read/schemas";

const KEY = process.env.DEEPSEEK_TEST_API_KEY ?? "";
const run = KEY ? it : it.skip;
const TEST_TIMEOUT = 90_000;

const rebalanceTool = {
  propose_study_rebalance: tool({
    description:
      "对已有 Kiro-generated StudyBlock 生成只移动、不新增/删除的学习计划重排建议。本工具只是 Proposal，绝不修改 Store；manual StudyBlock 不会被移动。",
    inputSchema: proposeStudyRebalanceSchema,
  }),
};

run("DeepSeek → propose_study_rebalance Tool Call → Tool Result → final（2 请求，低 token）", async () => {
  const model = createOpenAICompatible({
    name: "classflow-kiro",
    baseURL: AI.DEEPSEEK_BASE_URL,
    apiKey: KEY,
    transformRequestBody: deepSeekTransformRequestBody,
  })("deepseek-v4-flash");

  const userMsg = "请调整已有学习计划。必须先调用 propose_study_rebalance。";
  const system = "你是 ClassFlow Kiro；必须使用提供的工具获取真实数据，回答简短。";

  // 第一请求：user → DeepSeek → 应产出 propose_study_rebalance tool call
  const r1 = await streamText({
    model,
    system,
    messages: [{ role: "user", content: userMsg }],
    tools: rebalanceTool,
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
  expect(calls[0].toolName).toBe("propose_study_rebalance");
  expect((calls[0].input as { horizonDays?: number }).horizonDays).toBe(7);

  // 模拟 Browser Tool Result（确定性 mock；真实数据链路由 E2E 覆盖）
  const mockOutput = {
    proposal: {
      horizonDays: 7,
      moves: [
        {
          blockId: "sb1",
          assignmentId: "a1",
          title: "概率论作业",
          courseId: "c1",
          minutes: 60,
          reason: "after_deadline",
          from: { date: "2026-08-20", startTime: "19:00", endTime: "20:00" },
          to: { date: "2026-08-19", startTime: "19:00", endTime: "20:00" },
        },
      ],
      summary: { movedBlocks: 1, movedMinutes: 60, hardIssuesResolved: 1, shortfallBefore: 0, shortfallAfter: 0, releasedEarlyCapacityMinutes: 0 },
      reasons: [],
    },
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
    tools: rebalanceTool,
    maxOutputTokens: 80,
  });
  let text = "";
  for await (const part of r2.fullStream) {
    if (part.type === "text-delta") text += part.text;
  }
  expect(text.trim().length).toBeGreaterThan(0);
}, TEST_TIMEOUT);
