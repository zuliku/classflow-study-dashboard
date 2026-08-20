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
import { QQChannelAdapter } from "@/src/main/channels/qq/adapter";
import * as fs from "node:fs";

vi.mock("electron", () => ({
  app: { getPath: (name: string) => require("node:path").join(require("node:os").tmpdir(), `classflow-test-${name}`) },
}));

vi.mock("@tencent-connect/qqbot-nodejs/protocol", () => ({
  TokenManager: class { async getAccessToken() { return "token"; } clearCache() {} },
}));

describe("qqExplicitReply", () => {
  let vault: SecretVault;
  let manager: ChannelManager;

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
    const { credentialRef } = vault.createCredential({ provider: "qq-bot", label: "bot", secret: "s" });
    const cfg = await manager.addQQChannel({ displayName: "Bot", appId: "123", credentialRef });
    const adapter = new QQChannelAdapter({
      config: { id: cfg.id, enabled: true, displayName: "Bot", appId: "123", credentialRef, requireMentionInGroup: true, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true },
      appSecret: "s",
      inboxSink: new ChannelInboxSink(),
    });
    (adapter as unknown as { transport: unknown }).transport = {
      start: async () => {},
      stop: async () => {},
      getState: () => "connected",
      sendReply: async () => ({ messageId: "platform_123" }),
    } as never;
    (adapter as unknown as { state: string }).state = "connected";
    (manager as unknown as { adapters: Map<string, unknown> }).adapters.set(cfg.id, adapter);
  });

  afterEach(() => { vi.clearAllMocks(); });

  it("prepareReply creates approval, confirm sends once", async () => {
    const ctxStore = getReplyContextStore();
    const ctx = await ctxStore.create({ channel: "qq-bot", sourceAccountId: (manager.listConfigs())[0].id, conversationId: "group_1", conversationType: "group", inboundMessageId: "msg_123" });
    const prep = await prepareReply({ replyContextId: ctx.replyContextId, text: "hello" });
    expect(prep.approvalId).toMatch(/^send_/);
    expect(prep.preview.text).toBe("hello");
    const confirm = await confirmReply({ approvalId: prep.approvalId });
    expect(confirm.ok).toBe(true);
    expect(confirm.platformMessageId).toBe("platform_123");
  });

  it("second confirm with same approvalId fails idempotent", async () => {
    const ctxStore = getReplyContextStore();
    const ctx = await ctxStore.create({ channel: "qq-bot", sourceAccountId: (manager.listConfigs())[0].id, conversationId: "c1", conversationType: "direct", inboundMessageId: "m1" });
    const prep = await prepareReply({ replyContextId: ctx.replyContextId, text: "hi" });
    await confirmReply({ approvalId: prep.approvalId });
    await expect(confirmReply({ approvalId: prep.approvalId })).rejects.toMatchObject({ code: "CHANNEL_SEND_APPROVAL_USED" });
  });

  it("prepare with empty text rejects", async () => {
    const ctxStore = getReplyContextStore();
    const ctx = await ctxStore.create({ channel: "qq-bot", sourceAccountId: (manager.listConfigs())[0].id, conversationId: "c1", conversationType: "direct", inboundMessageId: "m1" });
    await expect(prepareReply({ replyContextId: ctx.replyContextId, text: "   " })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});


