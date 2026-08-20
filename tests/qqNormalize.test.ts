import { describe, it, expect } from "vitest";
import { normalizeQQMessage } from "@/src/main/channels/qq/normalize";

describe("qqNormalize", () => {
  it("C2C text → direct", () => {
    const raw = { id: "msg1", content: "hello", userId: "user123", userOpenId: "openid123", isGroup: false, timestamp: 1710000000000 };
    const msg = normalizeQQMessage(raw as never, { accountId: "acc1" });
    expect(msg.channel).toBe("qq-bot");
    expect(msg.conversationType).toBe("direct");
    expect(msg.externalMessageId).toBe("msg1");
    expect(msg.conversationId).toBe("openid123");
    expect(msg.senderId).toBe("user123");
    expect(msg.text).toBe("hello");
    expect(msg.accountId).toBe("acc1");
    expect(msg.receivedAt).toBe(1710000000000);
    expect(msg.rawEventType).toBe("C2C_MESSAGE_CREATE");
  });

  it("Group @ text → group", () => {
    const raw = { id: "g1", content: "@bot hello", groupId: "group123", senderId: "user456", isGroup: true, isMentioned: true };
    const msg = normalizeQQMessage(raw as never, { accountId: "acc1" });
    expect(msg.conversationType).toBe("group");
    expect(msg.conversationId).toBe("group123");
    expect(msg.senderId).toBe("user456");
    expect(msg.text).toBe("@bot hello");
    expect(msg.rawEventType).toBe("GROUP_AT_MESSAGE_CREATE");
  });

  it("sender/conversation/message id and timestamp correctly mapped", () => {
    const raw = { msgId: "mid99", conversationId: "conv1", senderId: "sender1", content: "test", receivedAt: 1234567890 };
    const msg = normalizeQQMessage(raw as never, { accountId: "acc2" });
    expect(msg.externalMessageId).toBe("mid99");
    expect(msg.conversationId).toBe("conv1");
    expect(msg.senderId).toBe("sender1");
    expect(msg.text).toBe("test");
    expect(msg.receivedAt).toBe(1234567890);
  });

  it("unsupported attachment → safe metadata, no download", () => {
    const raw = { id: "msg2", content: "hello", attachments: [{ name: "file.mp4", mimeType: "video/mp4", size: 12345, url: "https://example.com/file" }] };
    const msg = normalizeQQMessage(raw as never, { accountId: "acc1" });
    expect(msg.attachments).toBeDefined();
    expect(msg.attachments!.length).toBe(1);
    expect(msg.attachments![0].kind).toBe("unsupported");
    expect(msg.attachments![0].name).toBe("file.mp4");
    // should not auto download, only metadata
    expect(msg.attachments![0].url).toBe("https://example.com/file");
  });

  it("does not expose raw SDK object", () => {
    const raw = { id: "m1", content: "hi", extraRaw: { secret: "should-not-leak" } } as unknown as never;
    const msg = normalizeQQMessage(raw, { accountId: "acc1" });
    expect((msg as Record<string, unknown>).extraRaw).toBeUndefined();
    expect((msg as Record<string, unknown>).secret).toBeUndefined();
  });
});
