/**
 * OpenCode Go Chat Vision live smoke（Phase 3.3B）：kimi-k3 / mimo-v2.5。
 *
 * 只在设置了 OPENCODE_GO_TEST_API_KEY 环境变量时运行（CI 默认跳过）：
 *   $env:OPENCODE_GO_TEST_API_KEY = "sk-..." ; npx vitest run tests/aiOpenCodeGoChatVisionSmoke.test.ts
 *
 * 验证链：ClassFlow resolver → @ai-sdk/openai-compatible → OpenCode Go /v1/chat/completions
 * → Kimi K3 / MiMo V2.5。包括：
 * 1. 纯文本 control
 * 2. PNG / JPEG / WEBP 颜色识别（128x128 纯红色，prompt 强制输出 RED/BLUE）
 * 3. UIMessage → convertToModelMessages round-trip（useChat 真实路径）
 *
 * 颜色识别是硬断言：模型必须真的读到图片（仅 text 非空不算通过）。
 */
import { describe, it, expect } from "vitest";
import { streamText, convertToModelMessages } from "ai";
import { createCanvas } from "@napi-rs/canvas";
import { resolveLanguageModel } from "@/lib/ai/providers/resolver";

const KEY = process.env.OPENCODE_GO_TEST_API_KEY ?? "";
const describeGo = KEY ? describe : describe.skip;
const SMOKE_TIMEOUT = 90_000;

const PROMPT = "图片是什么颜色？只能回答 RED 或 BLUE。";

function makeRedFixture(format: "image/png" | "image/jpeg" | "image/webp"): { bytes: Uint8Array; mime: string; ext: string } {
  const c = createCanvas(128, 128);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(0, 0, 128, 128);
  // @napi-rs/canvas toBuffer 类型未收窄 PNG（运行时支持）；cast 仅为类型
  const buf = c.toBuffer(format === "image/png" ? ("image/png" as "image/jpeg" | "image/webp") : format);
  return { bytes: new Uint8Array(buf), mime: format, ext: format.split("/")[1] };
}

/** 颜色识别：规范化后必须包含 RED（证明模型真实读取图片） */
async function assertRedRecognized(modelId: string, image: Uint8Array, label: string) {
  const { model } = await resolveLanguageModel({ provider: "opencode-go", model: modelId, apiKey: KEY });
  const result = streamText({
    model,
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: PROMPT }, { type: "image", image }],
      },
    ],
    maxOutputTokens: 512,
  });
  let text = "";
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") text += part.text;
  }
  const normalized = text.toUpperCase();
  expect(normalized.includes("RED"), `${label}: 未识别红色（text="${text.slice(0, 80)}"）`).toBe(true);
  return text;
}

async function assertTextOk(modelId: string, content: string, label: string): Promise<string> {
  const { model } = await resolveLanguageModel({ provider: "opencode-go", model: modelId, apiKey: KEY });
  // OpenCode Go 偶发空响应（连续请求下的波动）→ 允许一次重试，断言仍要求 text 非空
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = streamText({ model, messages: [{ role: "user", content }], maxOutputTokens: 256 });
    let text = "";
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") text += part.text;
    }
    if (text.trim().length > 0) return text;
  }
  throw new Error(`${label}: 两次尝试均无文本输出`);
}

function visionMatrix(modelId: string) {
  describe(`Vision matrix: ${modelId}`, () => {
    it("control：纯文本请求成功", async () => {
      const text = await assertTextOk(modelId, "只回复 OK", `${modelId} control`);
      expect(text.toUpperCase()).toContain("OK");
    }, SMOKE_TIMEOUT);

    for (const format of ["image/png", "image/jpeg", "image/webp"] as const) {
      it(`${format}：红色识别（必须含 RED）`, async () => {
        const fixture = makeRedFixture(format);
        await assertRedRecognized(modelId, fixture.bytes, `${modelId} ${format}`);
      }, SMOKE_TIMEOUT);
    }

    it("UIMessage → convertToModelMessages round-trip：图片不丢失且识别红色", async () => {
      const fixture = makeRedFixture("image/png");
      const { model } = await resolveLanguageModel({ provider: "opencode-go", model: modelId, apiKey: KEY });
      const uiMessages = [
        {
          id: "u1",
          role: "user",
          parts: [
            { type: "text", text: PROMPT },
            {
              type: "file",
              mediaType: fixture.mime,
              filename: `red.${fixture.ext}`,
              url: `data:${fixture.mime};base64,${Buffer.from(fixture.bytes).toString("base64")}`,
            },
          ],
        },
      ];
      const modelMessages = await convertToModelMessages(uiMessages as never);
      const result = streamText({ model, messages: modelMessages, maxOutputTokens: 512 });
      let text = "";
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") text += part.text;
      }
      expect(text.toUpperCase().includes("RED"), `UIMessage round-trip 未识别红色（text="${text.slice(0, 80)}"）`).toBe(true);
    }, SMOKE_TIMEOUT);
  });
}

describeGo("OpenCode Go Chat Vision live smoke（OPENCODE_GO_TEST_API_KEY 存在时运行）", () => {
  visionMatrix("kimi-k3");
  visionMatrix("mimo-v2.5");
});
