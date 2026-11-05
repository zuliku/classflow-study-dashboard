import { describe, expect, it, vi } from "vitest";
import { consumeKiroSubagentStream } from "@/lib/ai/agent/subagentStream";

function sse(events: unknown[]): Response {
  const body = events
    .map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}`)
    .join("\n\n") + "\n\n";
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("consumeKiroSubagentStream", () => {
  it("解析 text-delta 与 tool 步骤（start → input → output）", async () => {
    const onText = vi.fn();
    const steps: unknown[] = [];
    const onError = vi.fn();
    const ok = await consumeKiroSubagentStream(
      sse([
        { type: "start" },
        { type: "tool-input-start", toolCallId: "t1", toolName: "web_search" },
        {
          type: "tool-input-available",
          toolCallId: "t1",
          toolName: "web_search",
          input: { query: "AI agent frameworks" },
        },
        {
          type: "tool-output-available",
          toolCallId: "t1",
          output: { ok: true, data: { results: [{ sourceId: "web-1" }, { sourceId: "web-2" }] } },
        },
        { type: "text-delta", delta: "结论：" },
        { type: "text-delta", delta: "框架 A 更适合。" },
        { type: "finish" },
        "[DONE]",
      ]),
      { onText, onStep: (step) => steps.push(step), onError }
    );
    expect(ok).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(onText.mock.calls.map((c) => c[0]).join("")).toBe("结论：框架 A 更适合。");
    expect(steps.length).toBeGreaterThanOrEqual(3);
    const last = steps[steps.length - 1] as { status: string; detail?: string };
    expect(last.status).toBe("done");
    expect(last.detail).toBe("2 个来源");
  });

  it("流内 error → onError + false", async () => {
    const onError = vi.fn();
    const ok = await consumeKiroSubagentStream(
      sse([{ type: "text-delta", delta: "partial" }, { type: "error", errorText: "provider failed" }]),
      { onText: vi.fn(), onStep: vi.fn(), onError }
    );
    expect(ok).toBe(false);
    expect(onError).toHaveBeenCalledWith("provider failed");
  });

  it("HTTP 非 2xx → 读取安全 message", async () => {
    const onError = vi.fn();
    const response = new Response(JSON.stringify({ message: "子代理仅支持本地用户。" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
    const ok = await consumeKiroSubagentStream(response, {
      onText: vi.fn(),
      onStep: vi.fn(),
      onError,
    });
    expect(ok).toBe(false);
    expect(onError).toHaveBeenCalledWith("子代理仅支持本地用户。");
  });
});
