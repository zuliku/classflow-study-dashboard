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
  it("providerOptions.openai{reasoningEffort:high,forceReasoning} → body.reasoning.effort = high（无残留字段）", async () => {
    const { bodies, model } = captureResponsesRequest();
    await generateText({
      model,
      messages: [{ role: "user", content: "hi" }],
      providerOptions: { openai: { reasoningEffort: "high", forceReasoning: true } } as never,
    });
    expect(bodies.length).toBe(1);
    expect(bodies[0].url).toContain("/responses");
    const body = bodies[0].body;
    // 序列化正确位置：reasoning.effort（forceReasoning 是 SDK 内部标志，不进请求体）
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
      providerOptions: { "classflow-kiro": { reasoningEffort: "high", forceReasoning: true } } as never,
    });
    const body = bodies[0].body;
    expect("reasoning" in body).toBe(false);
  });

  it("providerOptions.openai.reasoningEffort=low → body.reasoning.effort = low", async () => {
    const { bodies, model } = captureResponsesRequest();
    await generateText({
      model,
      messages: [{ role: "user", content: "hi" }],
      providerOptions: { openai: { reasoningEffort: "low", forceReasoning: true } } as never,
    });
    expect(bodies[0].body.reasoning).toEqual({ effort: "low", summary: "detailed" });
  });

  it("无 forceReasoning：SDK 对 gpt-5.6-luna 本身识别为 reasoning model → reasoning 仍生效", async () => {
    const { bodies, model } = captureResponsesRequest();
    await generateText({
      model,
      messages: [{ role: "user", content: "hi" }],
      providerOptions: { openai: { reasoningEffort: "medium" } } as never,
    });
    expect(bodies[0].body.reasoning).toEqual({ effort: "medium", summary: "detailed" });
  });
});

describe("OpenAI Responses image request body（Phase 3.3A，@ai-sdk/openai 4.0.42）", () => {
  // 1x1 透明 PNG（合法 base64 fixture，无需网络）
  const PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  const captureImageRequest = (modelId: string) => {
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
    }).responses(modelId);
    return { bodies, model };
  };

  it("grok-4.5：user 图片 part → 请求走 /responses，图片不被丢失，body 含 input_image base64", async () => {
    const { bodies, model } = captureImageRequest("grok-4.5");
    const bytes = Uint8Array.from(atob(PNG_BASE64), (c) => c.charCodeAt(0));
    await generateText({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "图片主体是什么颜色？" },
            { type: "image", image: bytes },
          ],
        },
      ],
    });
    expect(bodies.length).toBe(1);
    expect(bodies[0].url).toContain("/responses");
    const body = bodies[0].body;
    const input = (body.input as { role: string; content: unknown[] }[])[0];
    expect(input.role).toBe("user");
    const content = input.content as { type: string; image_url?: string }[];
    // 图片必须进入请求体（以 @ai-sdk/openai 实际输出为准，不手写猜测）
    expect(content.some((c) => c.type === "input_image")).toBe(true);
    const imagePart = content.find((c) => c.type === "input_image");
    expect(imagePart?.image_url).toContain("data:image/png;base64,");
  });

  it("store:false 作为 base provider option 真实进入请求体", async () => {
    const { bodies, model } = captureImageRequest("grok-4.5");
    await generateText({
      model,
      messages: [{ role: "user", content: "hi" }],
      providerOptions: { openai: { store: false } } as never,
    });
    expect(bodies[0].body.store).toBe(false);
  });
});
