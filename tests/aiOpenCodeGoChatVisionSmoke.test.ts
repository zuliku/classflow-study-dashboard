/**
 * OpenCode Go Chat Vision live smoke（Phase 3.3B/C）。
 *
 * 只在设置了 OPENCODE_GO_TEST_API_KEY 环境变量时运行（CI 默认跳过）：
 *   $env:OPENCODE_GO_TEST_API_KEY = "sk-..." ; npx vitest run tests/aiOpenCodeGoChatVisionSmoke.test.ts
 *
 * 成本策略（Phase 3.3C）：
 * - 默认（Tier 1，低成本）：只跑 MiMo V2.5（control + PNG 识别 + UIMessage round-trip，
 *   约 3 个真实请求）。日常开发 smoke 用这个。
 * - 完整矩阵（Tier 2）：显式设置
 *     $env:OPENCODE_GO_VISION_FULL_MATRIX = "1"
 *   才追加 MiMo JPEG/WEBP 与 Kimi K3 全部格式（SDK 升级 / 代理变更 / capability audit 时用）。
 * 不要默认把全部 Vision 模型都调用一遍。
 *
 * 验证链：ClassFlow resolver → @ai-sdk/openai-compatible → OpenCode Go /v1/chat/completions。
 * 颜色识别是硬断言：模型必须真的读到图片（仅 text 非空不算通过）。
 * 已 live-verified：Kimi K3 / MiMo V2.5 的 PNG / JPEG / WEBP 与 UIMessage round-trip（Phase 3.3B）。
 */
import { describe, it, expect } from "vitest";
import { streamText, convertToModelMessages } from "ai";
import { createCanvas } from "@napi-rs/canvas";
import { resolveLanguageModel } from "@/lib/ai/providers/resolver";

const KEY = process.env.OPENCODE_GO_TEST_API_KEY ?? "";
const FULL_MATRIX = process.env.OPENCODE_GO_VISION_FULL_MATRIX === "1";
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

/** Tier 1：低成本核心链（control + PNG + UIMessage） */
function tier1Smoke(modelId: string) {
  describe(`Vision Tier 1: ${modelId}`, () => {
    it("control：纯文本请求成功", async () => {
      const text = await assertTextOk(modelId, "只回复 OK", `${modelId} control`);
      expect(text.toUpperCase()).toContain("OK");
    }, SMOKE_TIMEOUT);

    it("image/png：红色识别（必须含 RED）", async () => {
      const fixture = makeRedFixture("image/png");
      await assertRedRecognized(modelId, fixture.bytes, `${modelId} image/png`);
    }, SMOKE_TIMEOUT);

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

/** Tier 2：完整格式矩阵（JPEG/WEBP 与 Kimi 追加覆盖） */
function tier2Matrix(modelId: string) {
  describe(`Vision Tier 2 matrix: ${modelId}`, () => {
    for (const format of ["image/jpeg", "image/webp"] as const) {
      it(`${format}：红色识别（必须含 RED）`, async () => {
        const fixture = makeRedFixture(format);
        await assertRedRecognized(modelId, fixture.bytes, `${modelId} ${format}`);
      }, SMOKE_TIMEOUT);
    }
  });
}

describeGo("OpenCode Go Chat Vision live smoke（OPENCODE_GO_TEST_API_KEY 存在时运行）", () => {
  // Tier 1：默认低成本 smoke —— 只跑 MiMo V2.5（用户指定的低成本策略模型）
  tier1Smoke("mimo-v2.5");
  // Tier 2：仅显式开启 OPENCODE_GO_VISION_FULL_MATRIX=1 时才追加完整矩阵
  if (FULL_MATRIX) {
    tier2Matrix("mimo-v2.5");
    tier1Smoke("kimi-k3");
    tier2Matrix("kimi-k3");
  }
});
