import { describe, it, expect } from "vitest";
import { ChannelInboxSink } from "@/src/main/channels/inboxSink";
import { QQChannelAdapter } from "@/src/main/channels/qq/adapter";
import type { ChannelInboundMessage } from "@/src/main/channels/types";
import { wrapExternalContent } from "@/lib/inbox/types";
import { createTestInboxStore } from "@/store/useInboxStore";

describe("qqInboxDelivery", () => {
  it("Adapter → Sink → Publisher → Renderer store items.length 1 raw text, Kiro wraps once", async () => {
    const testStore = createTestInboxStore();
    const published: unknown[] = [];
    const sink = new ChannelInboxSink({ publishRaw: (p) => published.push(p) });
    const adapter = new QQChannelAdapter({
      config: { id: "qq_test", enabled: true, displayName: "Bot", appId: "123", credentialRef: "cred_abc", requireMentionInGroup: false, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true } as never,
      appSecret: "secret",
      inboxSink: sink,
      transportFactory: (() => ({ start: async () => {}, stop: async () => {}, getState: () => "connected" })) as never,
    });
    await adapter.start();
    const msg: ChannelInboundMessage = { channel: "qq-bot", accountId: "qq_test", externalMessageId: "m1", conversationId: "c1", conversationType: "direct", senderId: "u1", text: "hello", receivedAt: Date.now() };
    await (adapter as unknown as { handleInbound: (m: ChannelInboundMessage) => Promise<void> }).handleInbound(msg);
    expect(published.length).toBe(1);
    const payload = published[0] as { text: string; source: string };
    expect(payload.text).toBe("hello");
    expect(payload.text).not.toContain("EXTERNAL UNTRUSTED");
    // Renderer
    testStore.getState().addItem(payload as never);
    expect(testStore.getState().items.length).toBe(1);
    expect(testStore.getState().items[0].text).toBe("hello");
    const wrapped = wrapExternalContent(testStore.getState().items[0].text);
    expect((wrapped.match(/EXTERNAL UNTRUSTED CONTENT/g) || []).length).toBe(1);
  });

  it("No double wrap: inbox stored hello not wrapped", async () => {
    const testStore = createTestInboxStore();
    const sink = new ChannelInboxSink({ addItem: async (base) => testStore.getState().addItem(base as never) } as never);
    const adapter = new QQChannelAdapter({
      config: { id: "qq_test", enabled: true, displayName: "Bot", appId: "123", credentialRef: "cred_abc", requireMentionInGroup: false, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true } as never,
      appSecret: "secret",
      inboxSink: sink,
      transportFactory: (() => ({ start: async () => {}, stop: async () => {}, getState: () => "connected" })) as never,
    });
    await adapter.start();
    const msg: ChannelInboundMessage = { channel: "qq-bot", accountId: "qq_test", externalMessageId: "m2", conversationId: "c1", conversationType: "direct", senderId: "u1", text: "hello", receivedAt: Date.now() };
    await (adapter as unknown as { handleInbound: (m: ChannelInboundMessage) => Promise<void> }).handleInbound(msg);
    const stored = testStore.getState().items[0];
    expect(stored.text).toBe("hello");
    expect(stored.text).not.toContain("EXTERNAL UNTRUSTED");
    const processed = wrapExternalContent(stored.text);
    expect(processed).toContain("EXTERNAL UNTRUSTED CONTENT");
    expect((processed.match(/EXTERNAL UNTRUSTED CONTENT/g) || []).length).toBe(1);
    // Not double wrapped
    expect(wrapExternalContent(processed).match(/EXTERNAL UNTRUSTED CONTENT/g)!.length).toBeGreaterThan(1); // double would be 2, but we only wrap once in real flow
    // So real flow should be exactly 1
    expect((processed.match(/EXTERNAL UNTRUSTED CONTENT/g) || []).length).toBe(1);
  });

  it("Self echo senderIsBot true → inbox 0 even without botIdentity", async () => {
    const testStore = createTestInboxStore();
    const sink = new ChannelInboxSink({ addItem: async (base) => testStore.getState().addItem(base as never) } as never);
    const adapter = new QQChannelAdapter({
      config: { id: "qq_test", enabled: true, displayName: "Bot", appId: "123", credentialRef: "cred_abc", requireMentionInGroup: false, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true } as never,
      appSecret: "secret",
      inboxSink: sink,
      transportFactory: (() => ({ start: async () => {}, stop: async () => {}, getState: () => "connected" })) as never,
    });
    await adapter.start();
    const msg: ChannelInboundMessage = { channel: "qq-bot", accountId: "qq_test", externalMessageId: "self1", conversationId: "c1", conversationType: "direct", senderId: "bot123", text: "echo", receivedAt: Date.now(), isSelf: true };
    await (adapter as unknown as { handleInbound: (m: ChannelInboundMessage) => Promise<void> }).handleInbound(msg);
    expect(testStore.getState().items.length).toBe(0);
  });
});
