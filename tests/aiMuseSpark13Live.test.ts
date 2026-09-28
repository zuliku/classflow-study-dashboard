/**
 * Muse Spark 1.3 Contributor live 验证（gated；仅本地显式 OPENCODE_GO_TEST_API_KEY 才运行）。
 *
 * 已验证结论（2026-09-03 真实 Go probe）：
 * - vision：PNG/JPEG/WEBP 均无识别（input 到达 wire，但无 RED 文本）→ registry 不声明
 * - reasoning：minimal/low/medium（1024 配额）与 high/xhigh（4096 配额，需约 450+ 推理 token）通过；
 *   max 无输出（NoOutputGeneratedError）→ 不声明
 * - 1.3 默认重度思考：小配额（64）下 finishReason=length 且无文本，探针配额须留足
 *
 * 运行：
 *   $env:OPENCODE_GO_TEST_API_KEY = "sk-..." ; npx vitest run tests/aiMuseSpark13Live.test.ts
 *
 * 测试绝不打印 / 断言 API Key 内容。
 */
import { describe, it, expect } from "vitest";
import { streamText, LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createCanvas } from "@napi-rs/canvas";
import { AI } from "@/lib/ai/config";
import { OPENCODE_SESSION_HEADER, resolveOpenCodeGoSessionId } from "@/lib/ai/providers/openCodeGo";

const KEY = process.env.OPENCODE_GO_TEST_API_KEY ?? "";
const describeGo = KEY ? describe : describe.skip;
const SMOKE_TIMEOUT = 90_000;
const MODEL = "muse-spark-1.3-contributor";

function responsesModel(capture?: { urls: string[]; bodies: Record<string, unknown>[] }): LanguageModel {
  return createOpenAI({
    name: "classflow-kiro",
    baseURL: AI.OPENCODE_BASE_URL,
    apiKey: KEY,
    // 生产 resolver 同源：OpenCode Go 强制 x-opencode-session（缺失 → 400 MissingSessionID）；
    // 测试无 sessionId 时与生产一致用 apiKey 稳定派生
    headers: { [OPENCODE_SESSION_HEADER]: resolveOpenCodeGoSessionId({ apiKey: KEY }) },
    fetch: capture
      ? (async (input, init) => {
          capture.urls.push(String(input));
          const body = (init as RequestInit | undefined)?.body;
          if (typeof body === "string") {
            try {
              capture.bodies.push(JSON.parse(body) as Record<string, unknown>);
            } catch {
              // ignore
            }
          }
          return fetch(input, init);
        })
      : undefined,
  }).responses(MODEL);
}

async function collectText(result: ReturnType<typeof streamText>): Promise<string> {
  let text = "";
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") text += part.text;
  }
  return text;
}

/**
 * 空文本重试一次：远端偶发 response.failed/server_error（已验证隔离重跑通过），
 * 两次皆空才算真失败，避免把 transient 毛刺误判为档位回归。
 */
async function collectTextWithTransientRetry(
  run: () => ReturnType<typeof streamText>,
  label: string
): Promise<string> {
  const first = await collectText(run());
  if (first.trim().length > 0) return first;
  const second = await collectText(run());
  if (second.trim().length > 0) return second;
  throw new Error(`${label}: 两次请求均返回空文本（非 transient）`);
}

describeGo("Muse Spark 1.3 vision 状态（responses input_image）", () => {
  it("Vision：当前不支持（input 到达 wire 但无识别；若未来通过则同步放开 registry）", async () => {
    const capture = { urls: [] as string[], bodies: [] as Record<string, unknown>[] };
    const model = responsesModel(capture);
    const c = createCanvas(16, 16);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 16, 16);
    const bytes = new Uint8Array(c.toBuffer("image/png" as "image/jpeg"));
    const text = await collectText(
      streamText({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "图片主体是什么颜色？只回答颜色名称。" },
              { type: "image", image: bytes, mediaType: "image/png" },
            ],
          },
        ],
        maxOutputTokens: 1024,
        providerOptions: { openai: { store: false } } as never,
      })
    );
    expect(capture.urls[0]).toContain("/responses");
    const input = capture.bodies[0]?.input as { content: { type: string }[] }[] | undefined;
    expect(input?.[0]?.content.some((p) => p.type === "input_image")).toBe(true);
    expect(text.toUpperCase().includes("RED")).toBe(false);
  }, SMOKE_TIMEOUT);
});

describeGo("Muse Spark 1.3 reasoning 档位（responses reasoning.effort）", () => {
  // 轻档位：1024 配额足够
  for (const effort of ["minimal", "low", "medium"] as const) {
    it(`Reasoning：effort=${effort} → outbound 回显且有文本`, async () => {
      const capture = { urls: [] as string[], bodies: [] as Record<string, unknown>[] };
      const model = responsesModel(capture);
      const text = await collectTextWithTransientRetry(
        () =>
          streamText({
            model,
            messages: [{ role: "user", content: "只回复两个字母：OK" }],
            maxOutputTokens: 1024,
            providerOptions: { openai: { reasoningEffort: effort, forceReasoning: true } } as never,
          }),
        effort
      );
      const reasoning = capture.bodies[0]?.reasoning as { effort?: string } | undefined;
      expect(reasoning?.effort, effort).toBe(effort);
      expect(text.trim().length, effort).toBeGreaterThan(0);
    }, SMOKE_TIMEOUT);
  }

  // 重档位 hungry（trivial prompt 约 450+ reasoning tokens）：4096 配额
  for (const effort of ["high", "xhigh"] as const) {
    it(`Reasoning：effort=${effort}（hungry，4096 配额）→ outbound 回显且有文本`, async () => {
      const capture = { urls: [] as string[], bodies: [] as Record<string, unknown>[] };
      const model = responsesModel(capture);
      const text = await collectTextWithTransientRetry(
        () =>
          streamText({
            model,
            messages: [{ role: "user", content: "只回复两个字母：OK" }],
            maxOutputTokens: 4096,
            providerOptions: { openai: { reasoningEffort: effort, forceReasoning: true } } as never,
          }),
        effort
      );
      const reasoning = capture.bodies[0]?.reasoning as { effort?: string } | undefined;
      expect(reasoning?.effort, effort).toBe(effort);
      expect(text.trim().length, effort).toBeGreaterThan(0);
    }, SMOKE_TIMEOUT * 2);
  }
});
