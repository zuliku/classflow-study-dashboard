/**
 * OpenCode Go Anthropic Messages live smoke（Streaming closure 前的真实 transport 验证）。
 *
 * 只在设置了 OPENCODE_GO_TEST_API_KEY 环境变量时运行（CI 默认跳过，本地手动验证）：
 *   $env:OPENCODE_GO_TEST_API_KEY = "sk-..." ; npx vitest run tests/aiOpenCodeGoAnthropicMessagesSmoke.test.ts
 *
 * 覆盖（最低成本：1 个模型 minimax-m3）：
 * 1. Smoke A：basic stream → 有 text output，无 400
 * 2. Smoke B：client-tool round（tool call → JSON-safe output → continuation → final text）
 *
 * 验证链：ClassFlow resolver → @ai-sdk/anthropic → OpenCode Go /v1/messages。
 * 测试绝不打印 / 断言 API Key 内容，也不记录 model output 正文。
 */
import { describe, it, expect } from "vitest";
import { streamText, convertToModelMessages, tool } from "ai";
import { z } from "zod";
import { createAnthropic } from "@ai-sdk/anthropic";
import { resolveLanguageModel } from "@/lib/ai/providers/resolver";
import { AI } from "@/lib/ai/config";

const KEY = process.env.OPENCODE_GO_TEST_API_KEY ?? "";
const describeGo = KEY ? describe : describe.skip;
const SMOKE_TIMEOUT = 120_000;

describeGo("OpenCode Go Anthropic Messages 真实 smoke（OPENCODE_GO_TEST_API_KEY 存在时运行）", () => {
  const opts = { provider: "opencode-go" as const, model: "minimax-m3", apiKey: KEY };

  it("Smoke A：minimax-m3 basic stream → text output，无 400（Bearer authToken vs x-api-key 探针）", async () => {
    // 先探针：同一模型/URL，x-api-key 认证是否被接受（Bearer 已被 resolver 验证为 401）
    let xapiOk = false;
    {
      const probe = createAnthropic({
        name: "classflow-kiro-probe",
        baseURL: AI.OPENCODE_BASE_URL,
        apiKey: KEY,
      })("minimax-m3");
      try {
        const r = streamText({ model: probe, messages: [{ role: "user", content: "OK" }], maxOutputTokens: 16 });
        let t = "";
        for await (const p of r.fullStream) {
          if (p.type === "text-delta") t += p.text;
        }
        xapiOk = t.trim().length > 0;
      } catch {
        xapiOk = false;
      }
    }
    console.log(`[ANTH][x-api-key-probe] ${xapiOk ? "OK" : "FAIL"}`);
    const { model } = await resolveLanguageModel(opts);
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
  }, SMOKE_TIMEOUT);

  it("Smoke B：minimax-m3 client-tool round（tool call → JSON-safe output → continuation → final text）", async () => {
    const { model } = await resolveLanguageModel(opts);
    const probeTool = {
      probe_workspace_size: tool({
        description: "返回工作区文件数量（确定性探针）",
        inputSchema: z.object({ check: z.string() }),
      }),
    };
    const PROMPT = "你必须先调用 probe_workspace_size 工具，不调用直接回答会被判定为失败；调用后再回复一句话结论。";
    const result = streamText({
      model,
      messages: [{ role: "user", content: PROMPT }],
      tools: probeTool,
      maxOutputTokens: 256,
    });
    let toolCallId = "";
    let toolName = "";
    let assistantParts: unknown[] = [];
    for await (const part of result.fullStream) {
      if (part.type === "tool-call") {
        toolCallId = part.toolCallId;
        toolName = part.toolName;
      }
      const msg = (part as { message?: { content: unknown[] } }).message;
      if (msg) assistantParts = msg.content;
    }
    expect(toolCallId.length).toBeGreaterThan(0);
    expect(toolName).toBe("probe_workspace_size");
    // 回填 JSON-safe tool output → convertToModelMessages → continuation
    const partsWithOutput = assistantParts.map((p) => {
      const tp = p as { type?: string; toolCallId?: string; toolName?: string };
      if (tp.type === "tool-call") {
        return { ...tp, state: "output-available", output: JSON.stringify({ ok: true, fileCount: 3 }) };
      }
      return p;
    });
    const uiMessages = [
      { id: "u1", role: "user" as const, parts: [{ type: "text" as const, text: PROMPT }] },
      { id: "a1", role: "assistant" as const, parts: partsWithOutput },
    ];
    const modelMessages = await convertToModelMessages(uiMessages as never);
    const final = streamText({ model, messages: modelMessages, tools: probeTool, maxOutputTokens: 256 });
    let finalText = "";
    for await (const part of final.fullStream) {
      if (part.type === "text-delta") finalText += part.text;
    }
    expect(finalText.trim().length).toBeGreaterThan(0);
  }, SMOKE_TIMEOUT);
});



