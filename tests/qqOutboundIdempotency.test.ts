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

vi.mock("electron", () => ({
  app: { getPath: (name: string) => require("node:path").join(require("node:os").tmpdir(), `classflow-test-${name}`) },
}));

vi.mock("@tencent-connect/qqbot-nodejs/protocol", () => ({
  TokenManager: class { async getAccessToken() { return "token"; } clearCache() {} },
}));

describe("qqOutboundIdempotency", () => {
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
    const fs = await import("node:fs");
    vi.spyOn(fs.promises, "open").mockImplementation(async () => ({ sync: async () => {}, close: async () => {} } as never));
    vi.spyOn(fs.promises, "writeFile").mockResolvedValue(undefined as never);
    vi.spyOn(fs.promises, "rename").mockResolvedValue(undefined as never);
    manager = new ChannelManager(new ChannelInboxSink(), ":memory:");
    __setChannelManagerForTest(manager);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  async function setupChannel(): Promise<{ cfg: { id: string }; fakeTransport: FakeQQTransport }> {
    const { credentialRef } = vault.createCredential({ provider: "qq-bot", label: "bot", secret: "s" });
    const cfg = await manager.addQQChannel({ displayName: "Bot", appId: "123", credentialRef });
    const fakeTransport = new FakeQQTransport({ onMessage: async () => {}, onStateChange: () => {} });
    await fakeTransport.start();
    const adapter = new QQChannelAdapter({ config: { id: cfg.id, enabled: true, displayName: "Bot", appId: "123", credentialRef, requireMentionInGroup: true, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true }, appSecret: "s", inboxSink: new ChannelInboxSink() });
    (adapter as unknown as { transport: unknown }).transport = fakeTransport as never;
    (adapter as unknown as { state: string }).state = "connected";
    (manager as unknown as { adapters: Map<string, unknown> }).adapters.set(cfg.id, adapter);
    return { cfg, fakeTransport };
  }

  it("one approval -> one send, second confirm fails with USED", async () => {
    const { cfg, fakeTransport } = await setupChannel();
    const ctx = await getReplyContextStore().create({ channel: "qq-bot", sourceAccountId: cfg.id, conversationId: "c1", conversationType: "direct", inboundMessageId: "m1" });
    const prep = await prepareReply({ replyContextId: ctx.replyContextId, text: "hello" });
    const first = await confirmReply({ approvalId: prep.approvalId });
    expect(first.ok).toBe(true);
    expect(fakeTransport.sendReplyCalls.length).toBe(1);
    await expect(confirmReply({ approvalId: prep.approvalId })).rejects.toMatchObject({ code: "CHANNEL_SEND_APPROVAL_USED" });
    expect(fakeTransport.sendReplyCalls.length).toBe(1);
  });

  it("immutable text: confirm with different text still sends original", async () => {
    const { cfg, fakeTransport } = await setupChannel();
    const ctx = await getReplyContextStore().create({ channel: "qq-bot", sourceAccountId: cfg.id, conversationId: "c1", conversationType: "direct", inboundMessageId: "m1" });
    const prep = await prepareReply({ replyContextId: ctx.replyContextId, text: "A" });
    await confirmReply({ approvalId: prep.approvalId });
    expect(fakeTransport.sendReplyCalls[0].text).toBe("A");
    expect(fakeTransport.sendReplyCalls[0].text).not.toBe("B");
  });

  it("correct account: context belongs to qq_a, only qq_a sends", async () => {
    const { credentialRef: credA } = vault.createCredential({ provider: "qq-bot", label: "botA", secret: "sA" });
    const { credentialRef: credB } = vault.createCredential({ provider: "qq-bot", label: "botB", secret: "sB" });
    const cfgA = await manager.addQQChannel({ displayName: "BotA", appId: "111", credentialRef: credA });
    const cfgB = await manager.addQQChannel({ displayName: "BotB", appId: "222", credentialRef: credB });
    const fakeA = new FakeQQTransport({ onMessage: async () => {}, onStateChange: () => {} });
    const fakeB = new FakeQQTransport({ onMessage: async () => {}, onStateChange: () => {} });
    await fakeA.start(); await fakeB.start();
    const adapterA = new QQChannelAdapter({ config: { id: cfgA.id, enabled: true, displayName: "BotA", appId: "111", credentialRef: credA, requireMentionInGroup: true, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true }, appSecret: "sA", inboxSink: new ChannelInboxSink() });
    const adapterB = new QQChannelAdapter({ config: { id: cfgB.id, enabled: true, displayName: "BotB", appId: "222", credentialRef: credB, requireMentionInGroup: true, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true }, appSecret: "sB", inboxSink: new ChannelInboxSink() });
    (adapterA as unknown as { transport: unknown }).transport = fakeA as never;
    (adapterB as unknown as { transport: unknown }).transport = fakeB as never;
    (adapterA as unknown as { state: string }).state = "connected";
    (adapterB as unknown as { state: string }).state = "connected";
    (manager as unknown as { adapters: Map<string, unknown> }).adapters.set(cfgA.id, adapterA);
    (manager as unknown as { adapters: Map<string, unknown> }).adapters.set(cfgB.id, adapterB);

    const ctx = await getReplyContextStore().create({ channel: "qq-bot", sourceAccountId: cfgA.id, conversationId: "c1", conversationType: "direct", inboundMessageId: "m1" });
    const prep = await prepareReply({ replyContextId: ctx.replyContextId, text: "hi" });
    await confirmReply({ approvalId: prep.approvalId });
    expect(fakeA.sendReplyCalls.length).toBe(1);
    expect(fakeB.sendReplyCalls.length).toBe(0);
  });
});


