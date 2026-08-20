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
import * as fs from "node:fs";

vi.mock("electron", () => ({
  app: { getPath: (name: string) => require("node:path").join(require("node:os").tmpdir(), `classflow-test-${name}`) },
}));

vi.mock("@tencent-connect/qqbot-nodejs/protocol", () => ({
  TokenManager: class { async getAccessToken() { return "token"; } clearCache() {} },
}));

describe("qqReplyTarget", () => {
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

  it("group reply target scope group", async () => {
    const { credentialRef } = vault.createCredential({ provider: "qq-bot", label: "bot", secret: "s" });
    const cfg = await manager.addQQChannel({ displayName: "Bot", appId: "123", credentialRef });
    const fakeTransport = new FakeQQTransport({ onMessage: async () => {}, onStateChange: () => {} });
    await fakeTransport.start();
    const adapter = new QQChannelAdapter({ config: { id: cfg.id, enabled: true, displayName: "Bot", appId: "123", credentialRef, requireMentionInGroup: true, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true }, appSecret: "s", inboxSink: new ChannelInboxSink() });
    (adapter as unknown as { transport: unknown }).transport = fakeTransport as never;
    (adapter as unknown as { state: string }).state = "connected";
    (manager as unknown as { adapters: Map<string, unknown> }).adapters.set(cfg.id, adapter);
    const ctx = await getReplyContextStore().create({ channel: "qq-bot", sourceAccountId: cfg.id, conversationId: "group_1", conversationType: "group", inboundMessageId: "msg_123" });
    const prep = await prepareReply({ replyContextId: ctx.replyContextId, text: "hello" });
    await confirmReply({ approvalId: prep.approvalId });
    expect(fakeTransport.sendReplyCalls[0].target.scope).toBe("group");
    expect(fakeTransport.sendReplyCalls[0].target.targetId).toBe("group_1");
    expect(fakeTransport.sendReplyCalls[0].target.msgId).toBe("msg_123");
    expect(fakeTransport.sendReplyCalls[0].text).toBe("hello");
  });

  it("C2C reply target scope c2c", async () => {
    const { credentialRef } = vault.createCredential({ provider: "qq-bot", label: "bot", secret: "s" });
    const cfg = await manager.addQQChannel({ displayName: "Bot", appId: "123", credentialRef });
    const fakeTransport = new FakeQQTransport({ onMessage: async () => {}, onStateChange: () => {} });
    await fakeTransport.start();
    const adapter = new QQChannelAdapter({ config: { id: cfg.id, enabled: true, displayName: "Bot", appId: "123", credentialRef, requireMentionInGroup: true, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true }, appSecret: "s", inboxSink: new ChannelInboxSink() });
    (adapter as unknown as { transport: unknown }).transport = fakeTransport as never;
    (adapter as unknown as { state: string }).state = "connected";
    (manager as unknown as { adapters: Map<string, unknown> }).adapters.set(cfg.id, adapter);
    const ctx = await getReplyContextStore().create({ channel: "qq-bot", sourceAccountId: cfg.id, conversationId: "user_openid", conversationType: "direct", inboundMessageId: "msg_c2c" });
    const prep = await prepareReply({ replyContextId: ctx.replyContextId, text: "hi" });
    await confirmReply({ approvalId: prep.approvalId });
    expect(fakeTransport.sendReplyCalls[0].target.scope).toBe("c2c");
    expect(fakeTransport.sendReplyCalls[0].target.targetId).toBe("user_openid");
  });

  it("proactive deny when inboundMessageId empty", async () => {
    const { credentialRef } = vault.createCredential({ provider: "qq-bot", label: "bot", secret: "s" });
    const cfg = await manager.addQQChannel({ displayName: "Bot", appId: "123", credentialRef });
    const fakeTransport = new FakeQQTransport({ onMessage: async () => {}, onStateChange: () => {} });
    await fakeTransport.start();
    const adapter = new QQChannelAdapter({ config: { id: cfg.id, enabled: true, displayName: "Bot", appId: "123", credentialRef, requireMentionInGroup: true, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true }, appSecret: "s", inboxSink: new ChannelInboxSink() });
    (adapter as unknown as { transport: unknown }).transport = fakeTransport as never;
    (adapter as unknown as { state: string }).state = "connected";
    (manager as unknown as { adapters: Map<string, unknown> }).adapters.set(cfg.id, adapter);
    const store = getReplyContextStore();
    const ctx = await store.create({ channel: "qq-bot", sourceAccountId: cfg.id, conversationId: "c1", conversationType: "direct", inboundMessageId: "m1" });
    (store as unknown as { contexts: Map<string, { inboundMessageId: string }> }).contexts.get(ctx.replyContextId)!.inboundMessageId = "";
    const prep = await prepareReply({ replyContextId: ctx.replyContextId, text: "hi" }).catch(() => null);
    expect(prep).toBeNull();
    const { getApprovalStore } = await import("@/src/main/channels/outbound/approvalStore");
    const approvalStore = getApprovalStore();
    const approval = approvalStore.create(ctx.replyContextId, "hi");
    await expect(confirmReply({ approvalId: approval.approvalId })).rejects.toMatchObject({ code: "QQ_REPLY_CONTEXT_INVALID" });
    expect(fakeTransport.sendReplyCalls.length).toBe(0);
  });
});


