import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

vi.mock("electron", () => ({
  app: { getPath: (name: string) => require("node:path").join(require("node:os").tmpdir(), `classflow-test-${name}`) },
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    generateText: vi.fn().mockResolvedValue({ text: "mocked draft" }),
  };
});

vi.mock("@/lib/ai/providers/resolver", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    resolveLanguageModel: vi.fn().mockResolvedValue({ model: {} }),
  };
});

describe("qqReplyDraft", () => {
  beforeEach(async () => {
    try {
      const { app } = await import("electron");
      const p = require("node:path").join(app.getPath("userData"), "channels", "channels.json");
      if (require("node:fs").existsSync(p)) require("node:fs").unlinkSync(p);
    } catch {}
    vi.spyOn(fs.promises, "open").mockImplementation(async () => ({ sync: async () => {}, close: async () => {} } as never));
    vi.spyOn(fs.promises, "writeFile").mockResolvedValue(undefined as never);
    vi.spyOn(fs.promises, "rename").mockResolvedValue(undefined as never);
  });

  it("tool-free: generateText called without tools", async () => {
    const routePath = path.join(process.cwd(), "app/api/ai/reply-draft/route.ts");
    const content = fs.readFileSync(routePath, "utf8");
    expect(content).toContain("generateText");
    expect(content).not.toContain("KIRO_TOOLS");
    expect(content).not.toContain("assembleKiroToolsForRequest");
    expect(content).not.toContain("getKiroToolsForRequest");
    // Check that generateText is called without tools
    expect(content).toMatch(/generateText\(\{[^}]*model[^}]*\}\)/s);
    // Ensure no tools in options
    const hasTools = content.includes("tools:") && content.includes("generateText");
    // More precise: check that the generateText call doesn't have tools
    const generateTextSection = content.slice(content.indexOf("generateText({"), content.indexOf("generateText({") + 500);
    expect(generateTextSection).not.toContain("tools");
    expect(generateTextSection).not.toContain("toolChoice");
  });

  it("outbound import scan: reply-draft does not import outbound", async () => {
    const routePath = path.join(process.cwd(), "app/api/ai/reply-draft/route.ts");
    const hookPath = path.join(process.cwd(), "hooks/useKiroReplyDraft.ts");
    const routeContent = fs.readFileSync(routePath, "utf8");
    const hookContent = fs.readFileSync(hookPath, "utf8");
    for (const content of [routeContent, hookContent]) {
      expect(content).not.toContain("outboundManager");
      expect(content).not.toContain("approvalStore");
      expect(content).not.toContain("ChannelManager.sendQQReply");
      expect(content).not.toContain("QQChannelAdapter");
      expect(content).not.toContain("QQWebSocketTransport");
    }
  });

  it("invocation mismatch: missing/invalid/local-user/gmail -> REPLY_DRAFT_INVOCATION_MISMATCH", async () => {
    const { handleReplyDraft } = await import("@/app/api/ai/reply-draft/route");
    const { beginInvocation, __clearAllInvocationsForTest } = await import("@/src/main/security/invocationTrust");
    __clearAllInvocationsForTest();

    const baseBody = {
      provider: "opencode-go",
      model: "test-model",
      apiKey: "test-key",
      inboxItemId: "item123",
      source: "qq-bot",
      message: "hello",
      tone: "natural",
    };

    // Missing invocation
    let res = await handleReplyDraft(new Request("http://127.0.0.1/api/ai/reply-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...baseBody }) }));
    expect(res.status).toBe(400);
    let json = await res.json() as { code?: string };
    expect(json.code).toBe("INVOCATION_REQUIRED");

    // Invalid invocation
    res = await handleReplyDraft(new Request("http://127.0.0.1/api/ai/reply-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...baseBody, invocationId: "inv_invalid" }) }));
    expect(res.status).toBe(403);
    json = await res.json() as { code?: string };
    expect(json.code).toBe("INVALID_INVOCATION");

    // Local-user invocation
    const localId = beginInvocation("local-user");
    res = await handleReplyDraft(new Request("http://127.0.0.1/api/ai/reply-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...baseBody, invocationId: localId }) }));
    expect(res.status).toBe(403);
    json = await res.json() as { code?: string };
    expect(json.code).toBe("REPLY_DRAFT_INVOCATION_MISMATCH");

    // Remote gmail
    const gmailId = beginInvocation("remote-channel", { source: "gmail", inboxItemId: "item123" });
    res = await handleReplyDraft(new Request("http://127.0.0.1/api/ai/reply-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...baseBody, invocationId: gmailId }) }));
    expect(res.status).toBe(403);
    json = await res.json() as { code?: string };
    expect(json.code).toBe("REPLY_DRAFT_INVOCATION_MISMATCH");

    // Mismatch inboxItemId
    const qqId = beginInvocation("remote-channel", { source: "qq-bot", inboxItemId: "item123" });
    res = await handleReplyDraft(new Request("http://127.0.0.1/api/ai/reply-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...baseBody, invocationId: qqId, inboxItemId: "different" }) }));
    expect(res.status).toBe(403);
    json = await res.json() as { code?: string };
    expect(json.code).toBe("REPLY_DRAFT_INVOCATION_MISMATCH");
  });

  it("valid remote qq invocation generates draft (mocked)", async () => {
    const { handleReplyDraft } = await import("@/app/api/ai/reply-draft/route");
    const { beginInvocation, __clearAllInvocationsForTest } = await import("@/src/main/security/invocationTrust");
    __clearAllInvocationsForTest();

    const { generateText } = await import("ai");
    vi.mocked(generateText).mockResolvedValueOnce({ text: "好的，我了解了。" } as never);
    const qqId = beginInvocation("remote-channel", { source: "qq-bot", inboxItemId: "item123" });
    const body = {
      provider: "opencode-go",
      model: "test-model",
      apiKey: "test-key",
      invocationId: qqId,
      inboxItemId: "item123",
      source: "qq-bot",
      message: "hello",
      senderDisplay: "Alice",
      tone: "natural",
    };
    const res = await handleReplyDraft(new Request("http://127.0.0.1/api/ai/reply-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    expect(res.status).toBe(200);
    const json = await res.json() as { draft?: string };
    expect(json.draft).toBe("好的，我了解了。");
    expect(vi.mocked(generateText)).toHaveBeenCalledWith(expect.objectContaining({ model: expect.anything() }));
    const callArgs = vi.mocked(generateText).mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.tools).toBeUndefined();
  });

  it("prompt injection: system prompt contains UNTRUSTED, no tools", async () => {
    const routePath = path.join(process.cwd(), "app/api/ai/reply-draft/route.ts");
    const content = fs.readFileSync(routePath, "utf8");
    expect(content).toContain("UNTRUSTED CONTENT");
    expect(content).toContain("只能输出候选回复文本");
    expect(content).not.toContain("KIRO_TOOLS");
  });
});
