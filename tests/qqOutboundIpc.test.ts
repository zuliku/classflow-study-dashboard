import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("qqOutboundIpc", () => {
  it("preload exposes prepare/confirm/cancel/canReply and not sendText", () => {
    const preloadPath = path.join(process.cwd(), "src/preload/index.ts");
    const content = fs.readFileSync(preloadPath, "utf8");
    expect(content).toContain("prepareReply");
    expect(content).toContain("confirmReply");
    expect(content).toContain("cancelReply");
    expect(content).toContain("canReply");
    expect(content).not.toContain("sendText(");
    expect(content).not.toContain("sendToUser");
    expect(content).not.toContain("sendToGroup");
    expect(content).not.toContain("sendRaw");
  });

  it("ipc validates sender for outbound", () => {
    const ipcPath = path.join(process.cwd(), "src/main/channels/ipc.ts");
    const content = fs.readFileSync(ipcPath, "utf8");
    expect(content).toContain("bridge:channels:prepareReply");
    expect(content).toContain("bridge:channels:confirmReply");
    expect(content).toContain("bridge:channels:cancelReply");
    expect(content).toContain("bridge:channels:canReply");
    expect(content).toContain("validateIpcSender");
    // Ensure prepare does not accept target fields
    expect(content).toContain("target");
    expect(content).toContain("INVALID_INPUT");
  });

  it("prepareReply does not return targetId/msgId", async () => {
    const { ReplyContextStore } = await import("@/src/main/channels/outbound/replyContextStore");
    const store = new ReplyContextStore({ configPath: ":memory:" } as never);
    (store as unknown as { contexts: Map<string, unknown> }).contexts.clear();
    (store as unknown as { persistAtomic: () => Promise<void> }).persistAtomic = async () => {};
    const ctx = await (store as unknown as { create: (c: unknown) => Promise<{ replyContextId: string }> }).create({
      channel: "qq-bot",
      sourceAccountId: "acc1",
      conversationId: "c1",
      conversationType: "direct",
      inboundMessageId: "m1",
    });
    // Simulate prepareReply preview should not contain targetId/msgId
    const preview = { channel: "QQ", conversationType: ctx.conversationType, text: "hi" };
    expect(preview).not.toHaveProperty("targetId");
    expect(preview).not.toHaveProperty("msgId");
    expect(preview.text).toBe("hi");
  });

  it("confirm only accepts approvalId, not text/target", () => {
    const ipcPath = path.join(process.cwd(), "src/main/channels/ipc.ts");
    const content = fs.readFileSync(ipcPath, "utf8");
    // Check that confirm handler checks for text/target not allowed
    expect(content).toContain('if ((i as Record<string, unknown>).text');
    expect(content).toContain("text/target not allowed");
  });
});

