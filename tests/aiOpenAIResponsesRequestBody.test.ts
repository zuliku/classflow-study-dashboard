/**
 * OpenAI Responses request-body capture test（Phase 3.2A，纯本地，无网络）。
 *
 * 目的：验证 @ai-sdk/openai@4.0.42 的 Responses LanguageModel
 * 把 providerOptions["openai"].reasoningEffort 序列化为真实 request body 的
 * reasoning.effort —— 而不是 reasoningEffort / reasoning_effort 残留错误位置。
 * 同时确认 providerOptions key 必须是 "openai"（4.0.42 Responses 固定读取，
 * 不读 createOpenAI name 参数）。
 */
import { describe, it, expect } from "vitest";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

const FAKE_BODY: Record<string, unknown> = {
  id: "resp_1",
  object: "response",
  created_at: 0,
  status: "completed",
  model: "gpt-5.6-luna",
  output: [
    {
      type: "message",
      id: "msg_1",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "OK", annotations: [] }],
    },
  ],
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
};

function captureResponsesRequest() {
  const bodies: { url: string; body: Record<string, unknown> }[] = [];
  const spy: typeof fetch = async (input, init) => {
    const body = (init as RequestInit | undefined)?.body;
    bodies.push({
      url: String(input),
      body: typeof body === "string" ? (JSON.parse(body) as Record<string, unknown>) : {},
    });
    return new Response(JSON.stringify(FAKE_BODY), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const model = createOpenAI({
    name: "classflow-kiro",
    baseURL: "https://fake.example/v1",
    apiKey: "test-key",
    fetch: spy,
  }).responses("gpt-5.6-luna");
  return { bodies, model };
}

describe("OpenAI Responses reasoning request body（@ai-sdk/openai 4.0.42）", () => {
  it("providerOptions.openai.reasoningEffort=high → body.reasoning.effort = high（无残留字段）", async () => {
    const { bodies, model } = captureResponsesRequest();
    await generateText({
      model,
      messages: [{ role: "user", content: "hi" }],
      providerOptions: { openai: { reasoningEffort: "high" } } as never,
    });
    expect(bodies.length).toBe(1);
    expect(bodies[0].url).toContain("/responses");
    const body = bodies[0].body;
    // 序列化正确位置：reasoning.effort
    expect(body.reasoning).toEqual({ effort: "high", summary: "detailed" });
    // 不得残留在错误位置
    expect("reasoningEffort" in body).toBe(false);
    expect("reasoning_effort" in body).toBe(false);
  });

  it("providerOptions 使用 name key（classflow-kiro）→ reasoning 不生效（验证 key 必须为 openai）", async () => {
    const { bodies, model } = captureResponsesRequest();
    await generateText({
      model,
      messages: [{ role: "user", content: "hi" }],
      providerOptions: { "classflow-kiro": { reasoningEffort: "high" } } as never,
    });
    const body = bodies[0].body;
    expect("reasoning" in body).toBe(false);
  });

  it("providerOptions.openai.reasoningEffort=low → body.reasoning.effort = low", async () => {
    const { bodies, model } = captureResponsesRequest();
    await generateText({
      model,
      messages: [{ role: "user", content: "hi" }],
      providerOptions: { openai: { reasoningEffort: "low" } } as never,
    });
    expect(bodies[0].body.reasoning).toEqual({ effort: "low", summary: "detailed" });
  });
});
