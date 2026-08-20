import { describe, it, expect } from "vitest";
import { normalizeQQSdkMessage } from "@/src/main/channels/qq/normalize";

describe("qqSdkContract", () => {
  it("official 1.0.4 fixture maps correctly", () => {
    const sdkMsg = {
      messageId: "msg-1",
      senderId: "user-openid",
      senderName: "Test User",
      senderIsBot: false,
      content: "hello",
      timestamp: "2024-01-01T00:00:00.000Z",
      kind: "group" as const,
      groupOpenid: "group-openid",
      rawEventType: "GROUP_AT_MESSAGE_CREATE",
      mentions: [{ id: "bot" }],
      replyTarget: { scope: "group" as const, targetId: "group-openid", msgId: "msg-1" },
      attachments: [{ content_type: "image/jpeg", filename: "a.jpg", url: "https://example.com/a.jpg", size: 123 }],
    };
    const normalized = normalizeQQSdkMessage(sdkMsg as never, { accountId: "acc1" });
    expect(normalized.externalMessageId).toBe("msg-1");
    expect(normalized.senderId).toBe("user-openid");
    expect(normalized.senderDisplay).toBe("Test User");
    expect(normalized.conversationId).toBe("group-openid");
    expect(normalized.conversationType).toBe("group");
    expect(normalized.mentionedBot).toBe(true);
    expect(normalized.isSelf).toBeUndefined(); // senderIsBot false
    expect(normalized.rawEventType).toBe("GROUP_AT_MESSAGE_CREATE");
    expect(normalized.text).toBe("hello");
    expect(normalized.attachments?.[0].mimeType).toBe("image/jpeg");
    expect(normalized.attachments?.[0].name).toBe("a.jpg");
    expect(normalized.accountId).toBe("acc1");
    expect(normalized.conversationId).not.toBe("unknown");
    expect(normalized.externalMessageId).not.toMatch(/^\d+-\w{4}$/); // not random fallback
  });

  it("direct C2C maps to direct", () => {
    const sdkMsg = {
      messageId: "c2c-1",
      senderId: "user2",
      senderName: "Alice",
      senderIsBot: false,
      content: "hi",
      timestamp: 1710000000000,
      kind: "c2c",
      rawEventType: "C2C_MESSAGE_CREATE",
      replyTarget: { scope: "c2c" as const, targetId: "user-openid-2", msgId: "c2c-1" },
    };
    const normalized = normalizeQQSdkMessage(sdkMsg as never, { accountId: "acc1" });
    expect(normalized.conversationType).toBe("direct");
    expect(normalized.conversationId).toBe("user-openid-2");
    expect(normalized.externalMessageId).toBe("c2c-1");
  });

  it("never returns unknown for valid event", () => {
    const sdkMsg = {
      messageId: "msg-unknown-test",
      senderId: "u1",
      senderName: "Bob",
      senderIsBot: false,
      content: "test",
      timestamp: Date.now(),
      kind: "group",
      groupOpenid: "group123",
      rawEventType: "GROUP_MESSAGE_CREATE",
      replyTarget: { scope: "group" as const, targetId: "group123", msgId: "msg-unknown-test" },
    };
    const n = normalizeQQSdkMessage(sdkMsg as never, { accountId: "acc" });
    expect(n.conversationId).not.toBe("unknown");
    expect(n.externalMessageId).not.toBe("unknown");
    expect(n.senderId).not.toBe("unknown");
  });
});
