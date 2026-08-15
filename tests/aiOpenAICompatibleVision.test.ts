/**
 * OpenAI-compatible（@ai-sdk/openai-compatible）Vision request-body capture（Phase 3.3B，纯本地）。
 *
 * 目标：证明 ClassFlow 的 image part（{ type: "image", image: bytes }）经
 * createOpenAICompatible → /v1/chat/completions 转换后确实变成 multimodal
 * user.content + image part。实际 shape 以 SDK 生成为准，先捕获再断言。
 */
import { describe, it, expect } from "vitest";
import { generateText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// 1x1 透明 PNG（合法 base64 fixture，无需网络）
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const FAKE_COMPLETION: Record<string, unknown> = {
  id: "chatcmpl_1",
  object: "chat.completion",
  created: 0,
  model: "kimi-k3",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content: "OK" },
      finish_reason: "stop",
    },
  ],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

function captureChatRequest() {
  const bodies: { url: string; body: Record<string, unknown> }[] = [];
  const spy: typeof fetch = async (input, init) => {
    const body = (init as RequestInit | undefined)?.body;
    bodies.push({
      url: String(input),
      body: typeof body === "string" ? (JSON.parse(body) as Record<string, unknown>) : {},
    });
    return new Response(JSON.stringify(FAKE_COMPLETION), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const model = createOpenAICompatible({
    name: "classflow-kiro",
    baseURL: "https://fake.example/v1",
    apiKey: "test-key",
    fetch: spy,
  })("kimi-k3");
  return { bodies, model };
}

describe("OpenAI-compatible Vision request body（@ai-sdk/openai-compatible 3.0.27）", () => {
  it("image part → /chat/completions + multimodal user.content + image_url data URL", async () => {
    const { bodies, model } = captureChatRequest();
    const bytes = Uint8Array.from(atob(PNG_BASE64), (c) => c.charCodeAt(0));
    await generateText({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "描述图片" },
            { type: "image", image: bytes },
          ],
        },
      ],
    });
    expect(bodies.length).toBe(1);
    expect(bodies[0].url).toContain("/chat/completions");
    const body = bodies[0].body;
    const messages = body.messages as { role: string; content: unknown }[];
    expect(messages[0].role).toBe("user");
    // multimodal array（不是纯字符串）
    const content = messages[0].content as { type: string }[];
    expect(Array.isArray(content)).toBe(true);
    const imagePart = content.find((c) => c.type === "image_url") as
      | { image_url: { url?: string } }
      | undefined;
    expect(imagePart).toBeDefined();
    expect(imagePart?.image_url?.url).toContain("data:image/png;base64,");
  });

  it("纯文本消息不被破坏（image part 不存在时 content 为 string）", async () => {
    const { bodies, model } = captureChatRequest();
    await generateText({ model, messages: [{ role: "user", content: "hi" }] });
    const messages = bodies[0].body.messages as { content: unknown }[];
    expect(typeof messages[0].content).toBe("string");
  });
});
