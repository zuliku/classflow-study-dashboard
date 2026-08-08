import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

/** 构造 OpenAI Chat Completions SSE 流 */
function sseChunks(chunks: string[]): Response {
  const body = chunks.map((c) => `data: ${c}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function completionChunk(delta: string, finish: string | null): string {
  return JSON.stringify({
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: delta ? { content: delta } : {}, finish_reason: finish }],
  });
}

/** 记录最后一次 fetch 调用（验证 URL 与 header） */
let lastFetch: { url: string; init?: RequestInit } | undefined;
let fetchMock: ReturnType<typeof vi.fn>;

/** 依据请求体 stream 开关返回 SSE 或 JSON 完成响应（generateText 用 JSON） */
function smartFetch() {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    lastFetch = { url: String(input), init };
    const bodyStr = String(init?.body ?? "");
    if (!bodyStr.includes('"stream"')) {
      // 非流式请求（generateText）：返回 JSON 完成响应
      return new Response(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return sseChunks([
      completionChunk("你", null),
      completionChunk("好", null),
      completionChunk("", "stop"),
    ]);
  };
}

beforeEach(() => {
  lastFetch = undefined;
  fetchMock = vi.fn(smartFetch());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function post(route: { POST: (req: NextRequest) => Promise<Response> }, body: unknown) {
  return route.POST(
    new Request("http://localhost/api/ai/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as unknown as NextRequest
  );
}

import { POST as chatPOST } from "@/app/api/ai/chat/route";
import { POST as testPOST } from "@/app/api/ai/test/route";
import { GET as modelsGET } from "@/app/api/ai/models/route";

describe("/api/ai/chat（流式）", () => {
  const baseBody = {
    provider: "deepseek",
    model: "deepseek-v4-flash",
    apiKey: "sk-test-secret",
    messages: [{ role: "user", content: "什么是工具变量？" }],
  };

  it("DeepSeek stream success：返回 UI message stream，含 text-delta", async () => {
    const res = await post({ POST: chatPOST }, baseBody);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"type":"text-delta"');
    expect(text).toContain('"delta":"你"');
    expect(text).toContain('"delta":"好"');
    // 不泄漏 API Key
    expect(text).not.toContain("sk-test-secret");
    expect(lastFetch?.url).toBe("https://api.deepseek.com/chat/completions");
  });

  it("OpenCode Go stream success：请求到 opencode endpoint", async () => {
    const res = await post(
      { POST: chatPOST },
      { ...baseBody, provider: "opencode-go", model: "deepseek-v4-flash" }
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"type":"text-delta"');
    expect(lastFetch?.url).toBe("https://opencode.ai/zen/go/v1/chat/completions");
    expect(text).not.toContain("sk-test-secret");
  });

  it("401 → 流内 error part 为 INVALID_API_KEY（客户端只收到归一化 code）", async () => {
    fetchMock.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    const res = await post({ POST: chatPOST }, baseBody);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"type":"error"');
    expect(text).toContain("INVALID_API_KEY");
    expect(text).not.toContain("sk-test-secret");
  });

  it("429 → RATE_LIMITED（SDK 重试后仍 429）", async () => {
    fetchMock.mockImplementation(async () => new Response("rate limited", { status: 429 }));
    const res = await post({ POST: chatPOST }, baseBody);
    const text = await res.text();
    expect(text).toContain("RATE_LIMITED");
  }, 30000);

  it("timeout（fetch 挂起 + timeoutMs=100）→ TIMEOUT", async () => {
    fetchMock.mockImplementationOnce(
      (input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        })
    );
    const res = await post({ POST: chatPOST }, { ...baseBody, timeoutMs: 100 });
    const text = await res.text();
    expect(text).toContain("TIMEOUT");
  });

  it("Custom base URL 指向私网 → 直接 400 INVALID_CUSTOM_URL，不发请求", async () => {
    const res = await post(
      { POST: chatPOST },
      {
        ...baseBody,
        provider: "custom-openai",
        model: "my-model",
        customConfig: { providerName: "x", baseURL: "http://localhost:9000/v1", model: "my-model" },
      }
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as { code: string };
    expect(data.code).toBe("INVALID_CUSTOM_URL");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("缺少 API Key → 400 INVALID_API_KEY", async () => {
    const res = await post({ POST: chatPOST }, { ...baseBody, apiKey: "" });
    const data = (await res.json()) as { code: string };
    expect(data.code).toBe("INVALID_API_KEY");
  });

  it("缺少 messages → 400", async () => {
    const res = await post({ POST: chatPOST }, { provider: "deepseek", model: "x", apiKey: "k" });
    expect(res.status).toBe(400);
  });

  it("Read Tool Call 从 /api/ai/chat 流入 UI Message Stream（tool-input 协议）", async () => {
    // Mock Provider 返回 tool_calls（get_upcoming_assignments）
    const toolChunk = JSON.stringify({
      id: "chatcmpl-tool",
      object: "chat.completion.chunk",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: { name: "get_upcoming_assignments", arguments: '{"days":7}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });
    fetchMock.mockImplementation(async () => {
      const body = `data: ${toolChunk}\n\ndata: [DONE]\n\n`;
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    });

    const res = await post(
      { POST: chatPOST },
      {
        ...baseBody,
        baseContext: { version: 1, now: "2026-08-08T10:00:00.000Z", timezone: "Asia/Shanghai", summary: { courseCount: 1 } },
        contextRefs: [{ kind: "week", id: "current", label: "本周" }],
      }
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"type":"tool-input-start"');
    expect(text).toContain('"toolName":"get_upcoming_assignments"');
    expect(text).toContain('"type":"tool-input-available"');
    // 不泄漏 API Key
    expect(text).not.toContain("sk-test-secret");
  });

  it("多轮 client tool call：tool output 消息被转换为 ModelMessage（role=tool 进入请求体）", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      lastFetch = { url: String(input), init };
      const bodyStr = String(init?.body ?? "");
      const body = JSON.parse(bodyStr);
      const roles = body.messages.map((m: { role: string }) => m.role);
      // 第二轮（含 tool output）：请求体必须包含 role=tool 消息
      if (roles.includes("tool")) {
        return sseChunks([
          completionChunk("最近", null),
          completionChunk("的 DDL 是统计学作业。", "stop"),
        ]);
      }
      const toolChunk = JSON.stringify({
        id: "chatcmpl-tool2",
        object: "chat.completion.chunk",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_2",
                  type: "function",
                  function: { name: "search_assignments", arguments: "{}" },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      });
      return new Response(`data: ${toolChunk}\n\ndata: [DONE]\n\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    // 客户端多轮消息：user → assistant(tool-call) → tool(output) → user? 
    // 用 UIMessage 结构（tool-call part + output-available part）验证转换
    const messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "我最近有什么 DDL？" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-call",
            toolCallId: "call_2",
            toolName: "search_assignments",
            state: "output-available",
            input: {},
            output: { ok: true, data: { items: [] } },
          },
        ],
      },
    ];
    const res = await post({ POST: chatPOST }, { ...baseBody, messages });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"delta":"最近"');
    expect(text).not.toContain("sk-test-secret");
  });
});

describe("/api/ai/test（连接测试）", () => {
  const baseBody = {
    provider: "deepseek",
    model: "deepseek-v4-flash",
    apiKey: "sk-test-secret",
  };

  it("success → { ok: true }", async () => {
    const res = await post({ POST: testPOST }, baseBody);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // 测试请求必须极小（maxOutputTokens 8）
    const body = JSON.parse(String(lastFetch?.init?.body ?? "{}"));
    expect(body.max_tokens).toBeLessThanOrEqual(8);
  });

  it("401 → INVALID_API_KEY", async () => {
    fetchMock.mockResolvedValueOnce(new Response("invalid key", { status: 401 }));
    const res = await post({ POST: testPOST }, baseBody);
    const data = (await res.json()) as { ok: boolean; code: string };
    expect(data.ok).toBe(false);
    expect(data.code).toBe("INVALID_API_KEY");
  });

  it("429 → RATE_LIMITED（SDK 重试后仍 429）", async () => {
    fetchMock.mockImplementation(async () => new Response("slow down", { status: 429 }));
    const res = await post({ POST: testPOST }, baseBody);
    const data = (await res.json()) as { code: string };
    expect(data.code).toBe("RATE_LIMITED");
  }, 30000);

  it("timeout → TIMEOUT", async () => {
    fetchMock.mockImplementationOnce(
      (input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        })
    );
    const res = await post({ POST: testPOST }, { ...baseBody, timeoutMs: 100 });
    const data = (await res.json()) as { code: string };
    expect(data.code).toBe("TIMEOUT");
  });
});

describe("/api/ai/models", () => {
  it("deepseek：返回 registry 固定列表", async () => {
    const res = await modelsGET(new Request("http://localhost/api/ai/models?provider=deepseek") as never);
    const data = (await res.json()) as { models: { id: string }[]; defaultModel: string };
    expect(data.models.map((m) => m.id)).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);
    expect(data.defaultModel).toBe("deepseek-v4-flash");
  });

  it("opencode-go：远端 /models 失败 → 回落 registry fallback", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const res = await modelsGET(new Request("http://localhost/api/ai/models?provider=opencode-go") as never);
    const data = (await res.json()) as { models: { id: string }[]; source: string };
    expect(data.source).toBe("registry");
    expect(data.models.map((m) => m.id)).toContain("grok-4.5");
  });

  it("opencode-go：远端成功 → 使用远端列表（剔除黑名单）", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          models: [
            { id: "grok-4.5", transport: "openai-chat" },
            { id: "gpt-5.6-luna", transport: "openai-responses" },
            { id: "brand-new-model" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const res = await modelsGET(new Request("http://localhost/api/ai/models?provider=opencode-go") as never);
    const data = (await res.json()) as { models: { id: string }[]; source: string };
    expect(data.source).toBe("remote");
    const ids = data.models.map((m) => m.id);
    expect(ids).toContain("grok-4.5");
    expect(ids).toContain("brand-new-model");
    expect(ids).not.toContain("gpt-5.6-luna");
  });
});
