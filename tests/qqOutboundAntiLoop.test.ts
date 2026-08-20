import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ChannelManager, __resetChannelManagerForTest, __setChannelManagerForTest } from "@/src/main/channels/manager";
import { ChannelInboxSink } from "@/src/main/channels/inboxSink";
import { SecretVault } from "@/lib/secrets/secretVault";
import { InMemorySecretStore } from "@/lib/secrets/secretStore";
import { MockSafeStorage } from "@/lib/secrets/safeStorage";
import * as secretRuntime from "@/src/main/secrets/secretRuntime";
import { getReplyContextStore, __resetReplyContextStoreForTest } from "@/src/main/channels/outbound/replyContextStore";
import { getApprovalStore, __resetApprovalStoreForTest } from "@/src/main/channels/outbound/approvalStore";
import { prepareReply, confirmReply } from "@/src/main/channels/outbound/outboundManager";
import { FakeQQTransport } from "@/src/main/channels/qq/transport";
import { QQChannelAdapter } from "@/src/main/channels/qq/adapter";
import { createTestInboxStore } from "@/store/useInboxStore";
import * as fs from "node:fs";

vi.mock("electron", () => ({
  app: { getPath: (name: string) => require("node:path").join(require("node:os").tmpdir(), `classflow-test-${name}`) },
}));

vi.mock("@tencent-connect/qqbot-nodejs/protocol", () => ({
  TokenManager: class { async getAccessToken() { return "token"; } clearCache() {} },
}));

describe("qqOutboundAntiLoop", () => {
  let manager: ChannelManager;
  let vault: SecretVault;

  beforeEach(async () => {
    try {
      const { app } = await import("electron");
      const p = require("node:path").join(app.getPath("userData"), "channels", "channels.json");
      if (require("node:fs").existsSync(p)) require("node:fs").unlinkSync(p);
    } catch {}
    vault = new SecretVault({ store: new InMemorySecretStore(), safeStorage: new MockSafeStorage(true) });
    vi.spyOn(secretRuntime, "getRuntimeSecretVault").mockReturnValue(vault as never);
    __resetReplyContextStoreForTest();
    __resetApprovalStoreForTest();
    __resetChannelManagerForTest();
    vi.spyOn(fs.promises, "open").mockImplementation(async () => ({ sync: async () => {}, close: async () => {} } as never));
    vi.spyOn(fs.promises, "writeFile").mockResolvedValue(undefined as never);
    vi.spyOn(fs.promises, "rename").mockResolvedValue(undefined as never);
    manager = new ChannelManager(new ChannelInboxSink(), ":memory:");
    __setChannelManagerForTest(manager);
  });

  afterEach(() => { vi.clearAllMocks(); });

  it("send reply then fake self echo does not create new inbox item", async () => {
    const { credentialRef } = vault.createCredential({ provider: "qq-bot", label: "bot", secret: "s" });
    const cfg = await manager.addQQChannel({ displayName: "Bot", appId: "123", credentialRef });
    const fakeTransport = new FakeQQTransport({ onMessage: async () => {}, onStateChange: () => {} });
    await fakeTransport.start();
    const adapter = new QQChannelAdapter({ config: { id: cfg.id, enabled: true, displayName: "Bot", appId: "123", credentialRef, requireMentionInGroup: true, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true }, appSecret: "s", inboxSink: new ChannelInboxSink() });
    (adapter as unknown as { transport: unknown }).transport = fakeTransport as never;
    (adapter as unknown as { state: string }).state = "connected";
    (manager as unknown as { adapters: Map<string, unknown> }).adapters.set(cfg.id, adapter);

    const store = createTestInboxStore();
    const sink = new ChannelInboxSink({ addItem: async (item) => store.getState().addItem(item as never) } as never);
    const testAdapter = new QQChannelAdapter({
      config: { id: cfg.id, enabled: true, displayName: "Bot", appId: "123", credentialRef, requireMentionInGroup: false, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true },
      appSecret: "s",
      inboxSink: sink,
    });
    (testAdapter as unknown as { transport: unknown }).transport = fakeTransport as never;
    (testAdapter as unknown as { state: string }).state = "connected";

    const ctx = await getReplyContextStore().create({ channel: "qq-bot", sourceAccountId: cfg.id, conversationId: "c1", conversationType: "direct", inboundMessageId: "msg1" });
    const prep = await prepareReply({ replyContextId: ctx.replyContextId, text: "reply hello" });
    await confirmReply({ approvalId: prep.approvalId });
    expect(fakeTransport.sendReplyCalls.length).toBe(1);

    const selfMsg = { channel: "qq-bot" as const, accountId: cfg.id, externalMessageId: "echo1", conversationId: "c1", conversationType: "direct" as const, senderId: "botSelf", text: "reply hello", receivedAt: Date.now(), isSelf: true };
    const beforeCount = store.getState().items.length;
    await (testAdapter as unknown as { handleInbound: (m: unknown) => Promise<void> }).handleInbound(selfMsg);
    expect(store.getState().items.length).toBe(beforeCount);
  });
});


