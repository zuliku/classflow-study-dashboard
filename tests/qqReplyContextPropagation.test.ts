import { describe, it, expect, beforeEach, vi } from "vitest";
import { ChannelManager, __resetChannelManagerForTest, __setChannelManagerForTest } from "@/src/main/channels/manager";
import { ChannelInboxSink } from "@/src/main/channels/inboxSink";
import { SecretVault } from "@/lib/secrets/secretVault";
import { InMemorySecretStore } from "@/lib/secrets/secretStore";
import { MockSafeStorage } from "@/lib/secrets/safeStorage";
import * as secretRuntime from "@/src/main/secrets/secretRuntime";
import { getReplyContextStore, __resetReplyContextStoreForTest } from "@/src/main/channels/outbound/replyContextStore";
import { inboxRawPayloadToInput } from "@/lib/inbox/fromRawPayload";
import { createTestInboxStore } from "@/store/useInboxStore";
import * as fs from "node:fs";

vi.mock("electron", () => ({
  app: { getPath: (name: string) => require("node:path").join(require("node:os").tmpdir(), `classflow-test-${name}`) },
}));

describe("qqReplyContextPropagation", () => {
  beforeEach(async () => {
    try {
      const { app } = await import("electron");
      const p = require("node:path").join(app.getPath("userData"), "channels", "channels.json");
      if (require("node:fs").existsSync(p)) require("node:fs").unlinkSync(p);
    } catch {}
    vi.spyOn(fs.promises, "open").mockImplementation(async () => ({ sync: async () => {}, close: async () => {} } as never));
    vi.spyOn(fs.promises, "writeFile").mockResolvedValue(undefined as never);
    vi.spyOn(fs.promises, "rename").mockResolvedValue(undefined as never);
    __resetReplyContextStoreForTest();
  });

  it("QQ inbound-like payload via mapper to store preserves replyContextId", async () => {
    const vault = new SecretVault({ store: new InMemorySecretStore(), safeStorage: new MockSafeStorage(true) });
    vi.spyOn(secretRuntime, "getRuntimeSecretVault").mockReturnValue(vault as never);
    const manager = new ChannelManager(new ChannelInboxSink(), ":memory:");
    __setChannelManagerForTest(manager);
    const { credentialRef } = vault.createCredential({ provider: "qq-bot", label: "bot", secret: "s" });
    const cfg = await manager.addQQChannel({ displayName: "Bot", appId: "123", credentialRef });

    // Simulate inbound that would have created a reply context
    const replyStore = getReplyContextStore();
    const ctx = await replyStore.create({
      channel: "qq-bot",
      sourceAccountId: cfg.id,
      conversationId: "group_1",
      conversationType: "group",
      inboundMessageId: "msg_123",
    });

    const rawPayload = {
      source: "qq-bot" as const,
      externalMessageId: "msg_123",
      conversationId: "group_1",
      senderDisplay: "Alice",
      text: "hello",
      receivedAt: Date.now(),
      sourceAccountId: "qq_a",
      replyContextId: ctx.replyContextId,
      attachments: [],
    };

    const input = inboxRawPayloadToInput(rawPayload as never);
    expect(input.sourceAccountId).toBe("qq_a");
    expect(input.replyContextId).toBe(ctx.replyContextId);
    expect(input.externalMessageId).toBe("msg_123");

    const store = createTestInboxStore();
    const id = store.getState().addItem(input as never);
    const item = store.getState().items.find((it) => it.id === id)!;
    expect(item.source).toBe("qq-bot");
    expect(item.sourceAccountId).toBe("qq_a");
    expect(item.externalMessageId).toBe("msg_123");
    expect(item.replyContextId).toBe(ctx.replyContextId);

    const foundCtx = getReplyContextStore().get(item.replyContextId!);
    expect(foundCtx).toBeDefined();
    expect(foundCtx!.sourceAccountId).toBe(cfg.id);
    expect(foundCtx!.conversationId).toBe("group_1");

    // Simulate persist/hydrate
    const persisted = store.getState().items[0];
    expect(persisted.replyContextId).toBe(ctx.replyContextId);
  });
});
