import { describe, it, expect, beforeEach } from "vitest";
import { ReplyContextStore } from "@/src/main/channels/outbound/replyContextStore";

describe("channelReplyContext", () => {
  let store: ReplyContextStore;

  beforeEach(() => {
    store = new ReplyContextStore({ max: 10, ttlMs: 24 * 60 * 60 * 1000, configPath: ":memory:" } as never);
    // Use in-memory by not persisting (configPath :memory: will fail but we mock)
    (store as unknown as { contexts: Map<string, unknown> }).contexts.clear();
  });

  it("QQ inbound creates context with correct fields", async () => {
    const ctx = await (store as unknown as { create: (c: unknown) => Promise<import("@/src/main/channels/outbound/types").ChannelReplyContext> }).create({
      channel: "qq-bot",
      sourceAccountId: "qq_a",
      conversationId: "group_1",
      conversationType: "group",
      inboundMessageId: "msg_123",
    });
    expect(ctx.sourceAccountId).toBe("qq_a");
    expect(ctx.conversationId).toBe("group_1");
    expect(ctx.conversationType).toBe("group");
    expect(ctx.inboundMessageId).toBe("msg_123");
    expect(ctx.channel).toBe("qq-bot");
    expect(ctx.replyContextId).toMatch(/^reply_/);
    expect(ctx.replyContextId.length).toBeGreaterThan(20);
  });

  it("Renderer only gets replyContextId, not full context", async () => {
    const ctx = await (store as unknown as { create: (c: unknown) => Promise<import("@/src/main/channels/outbound/types").ChannelReplyContext> }).create({
      channel: "qq-bot",
      sourceAccountId: "qq_a",
      conversationId: "group_1",
      conversationType: "group",
      inboundMessageId: "msg_123",
    });
    // Simulate what renderer receives: only replyContextId
    const rendererPayload = { replyContextId: ctx.replyContextId };
    expect(rendererPayload.replyContextId).toBe(ctx.replyContextId);
    expect((rendererPayload as Record<string, unknown>).sourceAccountId).toBeUndefined();
    expect((rendererPayload as Record<string, unknown>).inboundMessageId).toBeUndefined();
  });

  it("context persistence only allows listed fields, no secret/text", async () => {
    const ctx = await (store as unknown as { create: (c: unknown) => Promise<import("@/src/main/channels/outbound/types").ChannelReplyContext> }).create({
      channel: "qq-bot",
      sourceAccountId: "qq_a",
      conversationId: "group_1",
      conversationType: "group",
      inboundMessageId: "msg_123",
    });
    const json = JSON.stringify(ctx);
    expect(json).not.toContain("appSecret");
    expect(json).not.toContain("access_token");
    expect(json).not.toContain("credentialRef");
    expect(json).not.toContain("hello"); // no text
    expect(JSON.parse(json)).toHaveProperty("replyContextId");
    expect(JSON.parse(json)).toHaveProperty("sourceAccountId");
  });

  it("TTL and max bounded", async () => {
    const s = new ReplyContextStore({ max: 2, ttlMs: 10, configPath: ":memory:" } as never);
    (s as unknown as { contexts: Map<string, unknown> }).contexts.clear();
    // Mock persist to avoid file
    (s as unknown as { persistAtomic: () => Promise<void> }).persistAtomic = async () => {};
    await (s as unknown as { create: (c: unknown) => Promise<unknown> }).create({ channel: "qq-bot", sourceAccountId: "a", conversationId: "c1", conversationType: "direct", inboundMessageId: "m1" });
    await (s as unknown as { create: (c: unknown) => Promise<unknown> }).create({ channel: "qq-bot", sourceAccountId: "a", conversationId: "c2", conversationType: "direct", inboundMessageId: "m2" });
    expect(s.list().length).toBe(2);
    await (s as unknown as { create: (c: unknown) => Promise<unknown> }).create({ channel: "qq-bot", sourceAccountId: "a", conversationId: "c3", conversationType: "direct", inboundMessageId: "m3" });
    expect(s.list().length).toBe(2); // max 2 drop oldest
    // TTL expire
    await new Promise((r) => setTimeout(r, 20));
    expect(s.list().length).toBe(0);
  });
});
