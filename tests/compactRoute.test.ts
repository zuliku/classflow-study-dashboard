import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const generateTextMock = vi.fn(async (opts: Record<string, unknown>) => ({
  text: "用户希望分析本周任务；已讨论统计学作业的 DDL（历史事件）；尚未解决剩余任务优先级。",
}));

vi.mock("ai", () => ({
  generateText: (opts: Record<string, unknown>) => generateTextMock(opts),
}));

import { POST } from "@/app/api/ai/compact/route";

function req(body: unknown): NextRequest {
  return new Request("http://localhost/api/ai/compact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  generateTextMock.mockClear();
});

describe("compact route", () => {
  it("无 tools 传给模型；返回安全 summary；增量整合旧摘要", async () => {
    const res = await POST(req({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      apiKey: "sk-test",
      oldSummary: { version: 1, text: "旧摘要。", throughMessageId: "u5", updatedAt: "2026-08-01T00:00:00Z" },
      messages: [
        { id: "u6", role: "user", content: "继续分析任务" },
        { id: "a6", role: "assistant", content: "好的。" },
      ],
    }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { summary: { text: string; throughMessageId: string; version: number } };
    expect(data.summary.text).toContain("历史事件");
    expect(data.summary.throughMessageId).toBe("a6");
    expect(data.summary.version).toBe(1);

    // 关键：generateText 调用没有 tools（Compact API 绝不携带工具）
    const options = generateTextMock.mock.calls[0]?.[0] ?? {};
    expect(options).not.toHaveProperty("tools");
    // 增量：prompt 包含旧摘要与新增对话
    const prompt = String(options.prompt ?? "");
    expect(prompt).toContain("旧摘要");
    expect(prompt).toContain("继续分析任务");
  });

  it("空消息且无旧摘要 → 400", async () => {
    const res = await POST(req({ provider: "deepseek", model: "m", apiKey: "k", messages: [] }));
    expect(res.status).toBe(400);
  });

  it("摘要不包含 secret（输入中含 API Key 字样时输出仍安全）", async () => {
    generateTextMock.mockResolvedValueOnce({ text: "sk-12345 不应出现在摘要中，只总结目标。" });
    const res = await POST(req({
      provider: "deepseek",
      model: "m",
      apiKey: "sk-test",
      messages: [{ id: "u1", role: "user", content: "sk-12345 是我的 key，帮我规划" }],
    }));
    const data = (await res.json()) as { summary: { text: string } };
    expect(data.summary.text).not.toContain("sk-12345");
  });
});
