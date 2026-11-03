/**
 * OpenCode Go x-opencode-session 会话头（2026-09-05 起强制；缺失 → 400 MissingSessionID）：
 * 1. resolveOpenCodeGoSessionId：显式优先 / trim / 截断；回落同 key 稳定、跨 key 隔离、不含 key 明文
 * 2. 生产 resolver（stub fetch + generateText）：opencode-go chat（mimo-v2.5 精确复现）
 *    与 anthropic-messages 请求必带该头；deepseek 绝不带
 * 3. 同 key 多次调用稳定；显式 sessionId 直通
 */
import { describe, it, expect } from "vitest";
import { generateText } from "ai";
import { resolveLanguageModel } from "@/lib/ai/providers/resolver";
import {
  OPENCODE_SESSION_HEADER,
  resolveOpenCodeGoSessionId,
} from "@/lib/ai/providers/openCodeGo";

const KEY_A = "sk-test-session-a";
const KEY_B = "sk-test-session-b";

const FAKE_CHAT_COMPLETION = {
  id: "chatcmpl_1",
  object: "chat.completion",
  created: 0,
  model: "mimo-v2.5",
  choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

const FAKE_ANTHROPIC_MESSAGE = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "minimax-m3",
  content: [{ type: "text", text: "OK" }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
};

/** stub fetch：捕获请求头，按 URL 返回对应假响应 */
function captureHeadersWithFakeResponses() {
  const seen: { url: string; sessionHeader: string | null }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    seen.push({ url, sessionHeader: headers.get(OPENCODE_SESSION_HEADER) });
    const body = url.includes("/messages") ? FAKE_ANTHROPIC_MESSAGE : FAKE_CHAT_COMPLETION;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { seen, restore: () => (globalThis.fetch = originalFetch) };
}

describe("resolveOpenCodeGoSessionId", () => {
  it("显式会话 id 优先（trim + 空白折叠 + 截断）", () => {
    expect(resolveOpenCodeGoSessionId({ sessionId: "conv-42", apiKey: KEY_A })).toBe("conv-42");
    expect(resolveOpenCodeGoSessionId({ sessionId: "  spaced id  ", apiKey: KEY_A })).toBe("spaced-id");
    expect(resolveOpenCodeGoSessionId({ sessionId: "   ", apiKey: KEY_A })).toMatch(/^classflow-[0-9a-f]+$/);
    const long = resolveOpenCodeGoSessionId({ sessionId: "x".repeat(200), apiKey: KEY_A });
    expect(long.length).toBeLessThanOrEqual(128);
  });

  it("回落：同 key 稳定、跨 key 隔离、绝不含 key 明文", () => {
    const a1 = resolveOpenCodeGoSessionId({ apiKey: KEY_A });
    const a2 = resolveOpenCodeGoSessionId({ apiKey: KEY_A });
    const b = resolveOpenCodeGoSessionId({ apiKey: KEY_B });
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1).toMatch(/^classflow-[0-9a-f]+$/);
    expect(a1).not.toContain(KEY_A);
    expect(b).not.toContain(KEY_B);
  });
});

describe("生产 resolver 会话头透出（stub fetch）", () => {
  it("mimo-v2.5（用户故障精确复现）：/chat/completions 必带 x-opencode-session", async () => {
    const capture = captureHeadersWithFakeResponses();
    try {
      const { model } = await resolveLanguageModel({ provider: "opencode-go", model: "mimo-v2.5", apiKey: KEY_A });
      await generateText({ model, prompt: "只回复两个字母：OK", maxOutputTokens: 8 });
    } finally {
      capture.restore();
    }
    const chat = capture.seen.find((s) => s.url.includes("/chat/completions"));
    expect(chat).toBeTruthy();
    expect(chat!.sessionHeader).toBe(resolveOpenCodeGoSessionId({ apiKey: KEY_A }));
  });

  it("同 key 多次调用会话头稳定；显式 sessionId 直通", async () => {
    const capture = captureHeadersWithFakeResponses();
    try {
      const r1 = await resolveLanguageModel({ provider: "opencode-go", model: "mimo-v2.5", apiKey: KEY_A });
      await generateText({ model: r1.model, prompt: "hi", maxOutputTokens: 8 });
      const r2 = await resolveLanguageModel({ provider: "opencode-go", model: "mimo-v2.5", apiKey: KEY_A });
      await generateText({ model: r2.model, prompt: "hi", maxOutputTokens: 8 });
      const r3 = await resolveLanguageModel({
        provider: "opencode-go",
        model: "mimo-v2.5",
        apiKey: KEY_A,
        sessionId: "conv-explicit",
      });
      await generateText({ model: r3.model, prompt: "hi", maxOutputTokens: 8 });
    } finally {
      capture.restore();
    }
    const headers = capture.seen.map((s) => s.sessionHeader);
    expect(headers.length).toBe(3);
    expect(headers[0]).toBe(headers[1]);
    expect(headers[2]).toBe("conv-explicit");
  });

  it("anthropic-messages（minimax-m3）：同样携带", async () => {
    const capture = captureHeadersWithFakeResponses();
    try {
      const { model } = await resolveLanguageModel({ provider: "opencode-go", model: "minimax-m3", apiKey: KEY_A });
      await generateText({ model, prompt: "hi", maxOutputTokens: 8 });
    } finally {
      capture.restore();
    }
    const msg = capture.seen.find((s) => s.url.includes("/messages"));
    expect(msg).toBeTruthy();
    expect(msg!.sessionHeader).toBe(resolveOpenCodeGoSessionId({ apiKey: KEY_A }));
  });

  it("deepseek：绝不发送该头（原样）", async () => {
    const capture = captureHeadersWithFakeResponses();
    try {
      const { model } = await resolveLanguageModel({ provider: "deepseek", model: "deepseek-flash", apiKey: KEY_A });
      await generateText({ model, prompt: "hi", maxOutputTokens: 8 });
    } finally {
      capture.restore();
    }
    // deepseek 官方 endpoint + chat/completions
    expect(capture.seen.length).toBeGreaterThan(0);
    for (const s of capture.seen) {
      expect(s.url).not.toContain("opencode.ai");
      expect(s.sessionHeader).toBeNull();
    }
  });
});
