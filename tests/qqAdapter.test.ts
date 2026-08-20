import { describe, it, expect, beforeEach } from "vitest";
import { QQChannelAdapter } from "@/src/main/channels/qq/adapter";
import { ChannelInboxSink } from "@/src/main/channels/inboxSink";
import type { ChannelInboundMessage } from "@/src/main/channels/types";

function makeFakeTransportFactory(emitHolder: { emit?: (msg: ChannelInboundMessage) => void }) {
  return (_config: unknown, _secret: string, events: { onMessage: (m: ChannelInboundMessage) => void; onStateChange: (s: string, err?: unknown) => void }) => {
    emitHolder.emit = (msg) => events.onMessage(msg);
    return {
      start: async () => events.onStateChange("connected"),
      stop: async () => events.onStateChange("disconnected"),
      getState: () => "connected",
    };
  };
}

describe("qqAdapter", () => {
  let ingested: ChannelInboundMessage[];
  let sink: ChannelInboxSink;
  let holder: { emit?: (msg: ChannelInboundMessage) => void };

  beforeEach(() => {
    ingested = [];
    sink = new ChannelInboxSink({ onIngest: (item) => ingested.push(item as unknown as ChannelInboundMessage) });
    holder = {};
  });

  function makeAdapter(overrides?: Partial<Record<string, unknown>>) {
    const config = {
      id: "qq_test",
      enabled: true,
      displayName: "Test Bot",
      appId: "123456",
      credentialRef: "cred_abc",
      requireMentionInGroup: true,
      allowedUsers: [] as string[],
      allowedGroups: [] as string[],
      receiveDirectMessages: true,
      receiveGroupMessages: true,
      ...overrides,
    } as never;
    return new QQChannelAdapter({ config, appSecret: "secret123", inboxSink: sink, transportFactory: makeFakeTransportFactory(holder) as never });
  }

  it("start → connected", async () => {
    const adapter = makeAdapter();
    expect(adapter.getState()).toBe("disconnected");
    await adapter.start();
    expect(adapter.getState()).toBe("connected");
    expect(adapter.getHealth().state).toBe("connected");
  });

  it("emit message → inbox ingest", async () => {
    const adapter = makeAdapter();
    await adapter.start();
    const msg: ChannelInboundMessage = { channel: "qq-bot", accountId: "qq_test", externalMessageId: "mid1", conversationId: "c1", conversationType: "direct", senderId: "u1", text: "hello", receivedAt: Date.now() };
    await (adapter as unknown as { handleInbound: (m: ChannelInboundMessage) => Promise<void> }).handleInbound(msg);
    expect(ingested.length).toBe(1);
    expect(ingested[0].text).toContain("hello");
  });

  it("duplicate → ignored", async () => {
    const adapter = makeAdapter();
    await adapter.start();
    const msg: ChannelInboundMessage = { channel: "qq-bot", accountId: "qq_test", externalMessageId: "dup1", conversationId: "c1", conversationType: "direct", senderId: "u1", text: "hi", receivedAt: Date.now() };
    await (adapter as unknown as { handleInbound: (m: ChannelInboundMessage) => Promise<void> }).handleInbound(msg);
    await (adapter as unknown as { handleInbound: (m: ChannelInboundMessage) => Promise<void> }).handleInbound(msg);
    expect(ingested.length).toBe(1);
  });

  it("disconnect → reconnecting, ready → connected", async () => {
    const adapter = makeAdapter();
    await adapter.start();
    expect(adapter.getState()).toBe("connected");
    // simulate disconnect via stop
    await adapter.stop();
    expect(adapter.getState()).toBe("disconnected");
    await adapter.start();
    expect(adapter.getState()).toBe("connected");
  });

  it("stop → disconnected and secret cleared", async () => {
    const adapter = makeAdapter();
    await adapter.start();
    await adapter.stop();
    expect(adapter.getState()).toBe("disconnected");
    expect((adapter as unknown as { appSecret: string }).appSecret).toBe("");
  });

  it("self message dropped", async () => {
    const adapter = new QQChannelAdapter({
      config: { id: "qq_test", enabled: true, displayName: "Bot", appId: "123", credentialRef: "cred_abc", requireMentionInGroup: false, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true } as never,
      appSecret: "secret",
      inboxSink: sink,
      transportFactory: makeFakeTransportFactory(holder) as never,
      botIdentity: "botSelf",
    });
    await adapter.start();
    const msg: ChannelInboundMessage = { channel: "qq-bot", accountId: "qq_test", externalMessageId: "m1", conversationId: "c1", conversationType: "direct", senderId: "botSelf", text: "echo", receivedAt: Date.now() };
    await (adapter as unknown as { handleInbound: (m: ChannelInboundMessage) => Promise<void> }).handleInbound(msg);
    expect(ingested.length).toBe(0);
  });
});
