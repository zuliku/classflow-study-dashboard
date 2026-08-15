/**
 * OpenCode Go Responses 真实 smoke（Phase 3.1）。
 *
 * 只在设置了 OPENCODE_GO_TEST_API_KEY 环境变量时运行（CI 默认跳过，本地手动验证）：
 *   $env:OPENCODE_GO_TEST_API_KEY = "sk-..." ; npx vitest run tests/aiOpenCodeGoResponsesSmoke.test.ts
 *
 * 覆盖：
 * 1. Smoke A：GPT 5.6 Luna streamText 简单问题 → 命中 /v1/responses，有 text output，无 400
 * 2. Smoke B（client-tool round）：user → model tool call → JSON-safe tool output →
 *    convertToModelMessages continuation → final text（验证 Responses + Kiro UI 消息链兼容）
 *
 * 注意：Tool Output 必须是 JSON-safe 数据（string/number/boolean/null/array/plain object），
 * 不放 Date/Map/Set/class instance。
 *
 * 测试绝不打印 / 断言 API Key 内容。
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { streamText, convertToModelMessages, toUIMessageStream, readUIMessageStream, tool, LanguageModel, UIMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { resolveLanguageModel } from "@/lib/ai/providers/resolver";
import { AI } from "@/lib/ai/config";
import { createCanvas } from "@napi-rs/canvas";

const KEY = process.env.OPENCODE_GO_TEST_API_KEY ?? "";
const describeGo = KEY ? describe : describe.skip;
const SMOKE_TIMEOUT = 60_000;

describeGo("OpenCode Go Responses 真实 smoke（OPENCODE_GO_TEST_API_KEY 存在时运行）", () => {
  const opts = { provider: "opencode-go" as const, model: "gpt-5.6-luna", apiKey: KEY };

  it("Smoke A：gpt-5.6-luna streamText → 命中 /v1/responses，text output，无 400", async () => {
    const hitUrls: string[] = [];
    // 与 resolver.ts 的 Responses 构造一致（name/baseURL/apiKey），仅额外捕获请求 URL
    const spy: typeof fetch = async (input, init) => {
      hitUrls.push(String(input));
      return fetch(input, init);
    };
    const model: LanguageModel = createOpenAI({
      name: "classflow-kiro",
      baseURL: AI.OPENCODE_BASE_URL,
      apiKey: KEY,
      fetch: spy,
    }).responses("gpt-5.6-luna");

    const result = streamText({
      model,
      messages: [{ role: "user", content: "只回复两个字母：OK" }],
      maxOutputTokens: 64,
    });
    let text = "";
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") text += part.text;
    }
    expect(text.trim().length).toBeGreaterThan(0);
    expect(hitUrls.some((u) => u.includes("/responses"))).toBe(true);
  }, SMOKE_TIMEOUT);

  it("Smoke B：gpt-5.6-luna client-tool round（tool call → JSON-safe output → continuation → final text）", async () => {
    const { model } = await resolveLanguageModel(opts);
    const getTimeTool = {
      get_current_time: tool({
        description: "获取当前本地时间",
        inputSchema: z.object({}),
      }),
    };
    const userMsg = "现在是几点？必须调用 get_current_time 工具获取时间后再回答";

    // 第一段：user → Responses model → tool call
    const r1 = await streamText({
      model,
      messages: [{ role: "user", content: userMsg }],
      tools: getTimeTool,
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

    // 第二段：Browser Tool Result（UIMessage 形状，同 /api/ai/chat 的 client continuation）
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
          output: { now: "2026-08-15 12:00:00" }, // JSON-safe plain object
        })),
      },
    ];
    const modelMessages = await convertToModelMessages(uiMessages as never);
    const r2 = await streamText({ model, messages: modelMessages, tools: {}, maxOutputTokens: 128 });
    let text = "";
    for await (const part of r2.fullStream) {
      if (part.type === "text-delta") text += part.text;
    }
    expect(text.trim().length).toBeGreaterThan(0);
  }, SMOKE_TIMEOUT);

  it("Smoke A（Phase 3.2A）：gpt-5.6-luna reasoning=low → body 含 reasoning.effort=low，text 正常", async () => {
    const bodies: Record<string, unknown>[] = [];
    const spy: typeof fetch = async (input, init) => {
      const body = (init as RequestInit | undefined)?.body;
      if (typeof body === "string") {
        try {
          bodies.push(JSON.parse(body) as Record<string, unknown>);
        } catch {
          // ignore
        }
      }
      return fetch(input, init);
    };
    const model: LanguageModel = createOpenAI({
      name: "classflow-kiro",
      baseURL: AI.OPENCODE_BASE_URL,
      apiKey: KEY,
      fetch: spy,
    }).responses("gpt-5.6-luna");

    const result = streamText({
      model,
      messages: [{ role: "user", content: "只回复两个字母：OK" }],
      maxOutputTokens: 128,
      providerOptions: { openai: { reasoningEffort: "low", forceReasoning: true } } as never,
    });
    let text = "";
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") text += part.text;
    }
    expect(text.trim().length).toBeGreaterThan(0);
    const body = bodies[0];
    expect((body.reasoning as { effort?: string }).effort).toBe("low");
  }, SMOKE_TIMEOUT);

  it("Smoke B（Phase 3.2A）：gpt-5.6-luna reasoning=high + client tool round（reasoning → tool call → continuation → final）", async () => {
    const { model } = await resolveLanguageModel(opts);
    const getTimeTool = {
      get_current_time: tool({
        description: "获取当前本地时间",
        inputSchema: z.object({}),
      }),
    };
    const userMsg = "现在是几点？必须调用 get_current_time 工具获取时间后再回答";

    const r1 = await streamText({
      model,
      messages: [{ role: "user", content: userMsg }],
      tools: getTimeTool,
      maxOutputTokens: 256,
      providerOptions: { openai: { reasoningEffort: "high", forceReasoning: true } } as never,
    });
    const content = await r1.content;
    const calls = content.filter((p) => p.type === "tool-call") as {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      input: unknown;
    }[];
    expect(calls.length).toBeGreaterThan(0);

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
          output: { now: "2026-08-15 12:00:00" },
        })),
      },
    ];
    const modelMessages = await convertToModelMessages(uiMessages as never);
    const r2 = await streamText({
      model,
      messages: modelMessages,
      tools: {},
      maxOutputTokens: 256,
      providerOptions: { openai: { reasoningEffort: "high", forceReasoning: true } } as never,
    });
    let text = "";
    for await (const part of r2.fullStream) {
      if (part.type === "text-delta") text += part.text;
    }
    expect(text.trim().length).toBeGreaterThan(0);
  }, SMOKE_TIMEOUT);

  it("Smoke C（Phase 3.2A，max probe）：gpt-5.6-luna reasoning=max 无 400（通过后手动把 max 加入 capability）", async () => {
    const { model } = await resolveLanguageModel(opts);
    const result = streamText({
      model,
      messages: [{ role: "user", content: "只回复两个字母：OK" }],
      maxOutputTokens: 128,
      providerOptions: { openai: { reasoningEffort: "max", forceReasoning: true } } as never,
    });
    let text = "";
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") text += part.text;
    }
    expect(text.trim().length).toBeGreaterThan(0);
  }, SMOKE_TIMEOUT);
});

describeGo("Grok 4.5 reasoning probe（Phase 3.2B，OPENCODE_GO_TEST_API_KEY 存在时运行）", () => {
  // 官方边界：low / medium / high（默认 high，不能关闭）。
  // 全部通过后才允许把 grok-4.5 改为 adjustable（见 lib/ai/providers/openCodeGo.ts）。
  const grokModel = (capture: { urls: string[]; bodies: Record<string, unknown>[] }): LanguageModel =>
    createOpenAI({
      name: "classflow-kiro",
      baseURL: AI.OPENCODE_BASE_URL,
      apiKey: KEY,
      fetch: async (input, init) => {
        const body = (init as RequestInit | undefined)?.body;
        capture.urls.push(String(input));
        if (typeof body === "string") {
          try {
            capture.bodies.push(JSON.parse(body) as Record<string, unknown>);
          } catch {
            // ignore
          }
        }
        return fetch(input, init);
      },
    }).responses("grok-4.5");

  const collectText = async (result: ReturnType<typeof streamText>) => {
    let text = "";
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") text += part.text;
    }
    return text;
  };

  it("Smoke A：grok-4.5 基础 Responses 正常（control，无 reasoning override）", async () => {
    const capture = { urls: [] as string[], bodies: [] as Record<string, unknown>[] };
    const model = grokModel(capture);
    const text = await collectText(
      streamText({ model, messages: [{ role: "user", content: "只回复两个字母：OK" }], maxOutputTokens: 64 })
    );
    expect(capture.urls[0]).toContain("/responses");
    expect(text.trim().length).toBeGreaterThan(0);
  }, SMOKE_TIMEOUT);

  it("Smoke B：reasoning=low → outbound reasoning.effort=low，记录 summary 形状", async () => {
    const capture = { urls: [] as string[], bodies: [] as Record<string, unknown>[] };
    const model = grokModel(capture);
    const text = await collectText(
      streamText({
        model,
        messages: [{ role: "user", content: "只回复两个字母：OK" }],
        maxOutputTokens: 64,
        // 与生产映射一致：openai-responses-effort → reasoningEffort + forceReasoning
        providerOptions: { openai: { reasoningEffort: "low", forceReasoning: true } } as never,
      })
    );
    const reasoning = capture.bodies[0].reasoning as { effort?: string; summary?: string } | undefined;
    // 关键兼容点：SDK 4.0.42 会生成 effort + 自动 summary:"detailed"，Go proxy 必须接受
    expect(reasoning?.effort).toBe("low");
    console.info(`[grok probe] outbound reasoning = ${JSON.stringify(reasoning)}`);
    expect(text.trim().length).toBeGreaterThan(0);
  }, SMOKE_TIMEOUT);

  it("Smoke C：reasoning=medium 与 high 均无 400", async () => {
    for (const effort of ["medium", "high"] as const) {
      const capture = { urls: [] as string[], bodies: [] as Record<string, unknown>[] };
      const model = grokModel(capture);
      const text = await collectText(
        streamText({
          model,
          messages: [{ role: "user", content: "只回复两个字母：OK" }],
          maxOutputTokens: 64,
          providerOptions: { openai: { reasoningEffort: effort, forceReasoning: true } } as never,
        })
      );
      expect((capture.bodies[0].reasoning as { effort?: string }).effort, effort).toBe(effort);
      expect(text.trim().length, effort).toBeGreaterThan(0);
    }
  }, SMOKE_TIMEOUT * 2);

  it("Smoke D：reasoning=high + 真实 client-tool continuation（UIMessage 路径，保留 reasoning parts）", async () => {
    const { model } = await resolveLanguageModel({ provider: "opencode-go", model: "grok-4.5", apiKey: KEY });
    const getTimeTool = {
      get_current_time: tool({
        description: "获取当前本地时间",
        inputSchema: z.object({}),
      }),
    };
    const userMsg = "现在是几点？必须调用 get_current_time 工具获取时间后再回答";
    const userUIMessage = { id: "u1", role: "user" as const, parts: [{ type: "text" as const, text: userMsg }] };

    // 真实 Kiro 路径：Responses stream → toUIMessageStream → UIMessage（含 reasoning parts / providerMetadata）
    const r1 = streamText({
      model,
      messages: [{ role: "user", content: userMsg }],
      tools: getTimeTool,
      maxOutputTokens: 256,
      providerOptions: { openai: { reasoningEffort: "high", forceReasoning: true } } as never,
    });
    const uiStream = toUIMessageStream({
      stream: r1.stream,
      originalMessages: [userUIMessage] as never,
    });
    let assistantMessage: UIMessage | undefined;
    for await (const m of readUIMessageStream({ stream: uiStream })) {
      assistantMessage = m;
    }
    expect(assistantMessage).toBeDefined();
    const assistant = assistantMessage as UIMessage;
    const toolParts = ((assistantMessage?.parts ?? []) as { type?: string; toolCallId?: string; toolName?: string; input?: unknown }[]).filter(
      (p) => p.type === "dynamic-tool" || p.type?.startsWith("tool-")
    );
    expect(toolParts.length).toBeGreaterThan(0);

    // client 回填 JSON-safe tool output → convertToModelMessages → continuation
    const parts = assistant.parts.map((p) => {
      const tp = p as { type?: string; toolCallId?: string; toolName?: string; input?: unknown };
      if (tp.type === "dynamic-tool" || tp.type?.startsWith("tool-")) {
        return {
          ...tp,
          state: "output-available",
          output: { now: "2026-08-15 12:00:00" }, // JSON-safe plain object
        };
      }
      return p;
    });
    const modelMessages = await convertToModelMessages(
      [userUIMessage, { id: assistant.id, role: "assistant" as const, parts }] as never
    );
    const r2 = await streamText({
      model,
      messages: modelMessages,
      tools: {},
      maxOutputTokens: 256,
      providerOptions: { openai: { reasoningEffort: "high", forceReasoning: true } } as never,
    });
    const text = await collectText(r2);
    expect(text.trim().length).toBeGreaterThan(0);
  }, SMOKE_TIMEOUT * 2);
});

describeGo("Grok 4.5 Vision smoke（Phase 3.3A，OPENCODE_GO_TEST_API_KEY 存在时运行）", () => {
  // 已知 blocker（2026-08 实测）：OpenCode Go 对 grok-4.5 的 image 请求返回
  // HTTP 200 + response.failed（response.error=null，代理吞掉上游错误详情）。
  // 请求体为标准 input_image + data:image/png;base64（本地 capture 已验证），
  // 纯文本请求正常 → 代理/上游当前不支持 Grok 图片输入。
  // 这些测试作为未来修复后的探针保留；在代理支持前会失败（符合预期），
  // 通过后即可按 Phase 3.3A 文档把 grok-4.5 vision 打开。
  // 确定性 fixture：16x16 红色方块（@napi-rs/canvas 本地生成，无网络变量）
  const redPng = (() => {
    const c = createCanvas(16, 16);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 16, 16);
    return c.toBuffer("image/png");
  })();
  const redJpeg = (() => {
    const c = createCanvas(16, 16);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(0, 0, 16, 16);
    return c.toBuffer("image/jpeg");
  })();

  const captureModel = (capture: { urls: string[]; bodies: Record<string, unknown>[] }): LanguageModel =>
    createOpenAI({
      name: "classflow-kiro",
      baseURL: AI.OPENCODE_BASE_URL,
      apiKey: KEY,
      fetch: async (input, init) => {
        const body = (init as RequestInit | undefined)?.body;
        capture.urls.push(String(input));
        if (typeof body === "string") {
          try {
            capture.bodies.push(JSON.parse(body) as Record<string, unknown>);
          } catch {
            // ignore
          }
        }
        return fetch(input, init);
      },
    }).responses("grok-4.5");

  const collectText = async (result: ReturnType<typeof streamText>) => {
    let text = "";
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") text += part.text;
    }
    return text;
  };

  it("Vision A：grok + 红色 PNG → /responses 成功，body 含 input_image + store=false，text 非空", async () => {
    const capture = { urls: [] as string[], bodies: [] as Record<string, unknown>[] };
    const model = captureModel(capture);
    const text = await collectText(
      streamText({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "图片主体是什么颜色？只回答颜色名称。" },
              { type: "image", image: new Uint8Array(redPng) },
            ],
          },
        ],
        maxOutputTokens: 128,
        providerOptions: { openai: { store: false } } as never,
      })
    );
    expect(capture.urls[0]).toContain("/responses");
    expect(capture.bodies[0].store).toBe(false);
    const input = capture.bodies[0].input as { content: { type: string }[] }[];
    expect(input[0].content.some((c) => c.type === "input_image")).toBe(true);
    expect(text.trim().length).toBeGreaterThan(0);
  }, SMOKE_TIMEOUT * 2);

  it("Vision B：grok + 红色 JPEG → /responses 成功，text 非空", async () => {
    const capture = { urls: [] as string[], bodies: [] as Record<string, unknown>[] };
    const model = captureModel(capture);
    const text = await collectText(
      streamText({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "图片主体是什么颜色？只回答颜色名称。" },
              { type: "image", image: new Uint8Array(redJpeg) },
            ],
          },
        ],
        maxOutputTokens: 128,
        providerOptions: { openai: { store: false } } as never,
      })
    );
    expect(capture.bodies[0].store).toBe(false);
    const input = capture.bodies[0].input as { content: { type: string; image_url?: string }[] }[];
    const imagePart = input[0].content.find((c) => c.type === "input_image");
    expect(imagePart?.image_url).toContain("data:image/jpeg;base64,");
    expect(text.trim().length).toBeGreaterThan(0);
  }, SMOKE_TIMEOUT * 2);

  it("Vision C：UIMessage → convertToModelMessages round-trip 后图片仍进入 Responses 请求（真实 Kiro 路径）", async () => {
    const capture = { urls: [] as string[], bodies: [] as Record<string, unknown>[] };
    const model = captureModel(capture);
    // UI file part 形状：url = data URL（useChat 上传路径的序列化形式）
    const uiMessages = [
      {
        id: "u1",
        role: "user",
        parts: [
          { type: "text", text: "图片主体是什么颜色？只回答颜色名称。" },
          { type: "file", mimeType: "image/png", filename: "red.png", url: `data:image/png;base64,${Buffer.from(redPng).toString("base64")}` },
        ],
      },
    ];
    const modelMessages = await convertToModelMessages(uiMessages as never);
    const text = await collectText(
      streamText({
        model,
        messages: modelMessages,
        maxOutputTokens: 128,
        providerOptions: { openai: { store: false } } as never,
      })
    );
    const input = capture.bodies[0].input as { content: { type: string }[] }[];
    expect(input[0].content.some((c) => c.type === "input_image")).toBe(true);
    expect(text.trim().length).toBeGreaterThan(0);
  }, SMOKE_TIMEOUT * 2);
});
