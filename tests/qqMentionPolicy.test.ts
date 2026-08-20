import { describe, it, expect } from "vitest";
import { normalizeQQMessage, normalizeQQSdkMessage } from "@/src/main/channels/qq/normalize";

describe("qqMentionPolicy", () => {
  it("GROUP_AT_MESSAGE_CREATE => mentionedBot true", () => {
    const raw = { rawEventType: "GROUP_AT_MESSAGE_CREATE", content: "hello", groupOpenid: "g1", senderId: "u1" };
    const msg = normalizeQQMessage(raw as never, { accountId: "acc1", botAppId: "123" });
    expect(msg.mentionedBot).toBe(true);
  });

  it("mentions with is_you true => mentionedBot true", () => {
    const raw = { rawEventType: "GROUP_MESSAGE_CREATE", content: "hello", mentions: [{ is_you: true }], groupOpenid: "g1" };
    const msg = normalizeQQMessage(raw as never, { accountId: "acc1", botAppId: "123" });
    expect(msg.mentionedBot).toBe(true);
  });

  it("mentions without is_you => not mentioned", () => {
    const raw = { rawEventType: "GROUP_MESSAGE_CREATE", content: "hello", mentions: [{ is_you: false }], groupOpenid: "g1" };
    const msg = normalizeQQMessage(raw as never, { accountId: "acc1", botAppId: "123" });
    expect(msg.mentionedBot).toBe(false);
  });

  it("content contains <@APP_ID> => mentionedBot true", () => {
    const raw = { rawEventType: "GROUP_MESSAGE_CREATE", content: "hi <@123> hello", groupOpenid: "g1" };
    const msg = normalizeQQMessage(raw as never, { accountId: "acc1", botAppId: "123" });
    expect(msg.mentionedBot).toBe(true);
  });

  it("content contains <@!APP_ID> => mentionedBot true", () => {
    const raw = { rawEventType: "GROUP_MESSAGE_CREATE", content: "hi <@!123> hello", groupOpenid: "g1" };
    const msg = normalizeQQMessage(raw as never, { accountId: "acc1", botAppId: "123" });
    expect(msg.mentionedBot).toBe(true);
  });

  it("GROUP_MESSAGE_CREATE with no mention and no content tag => false", () => {
    const raw = { rawEventType: "GROUP_MESSAGE_CREATE", content: "hello", mentions: [], groupOpenid: "g1" };
    const msg = normalizeQQMessage(raw as never, { accountId: "acc1", botAppId: "123" });
    expect(msg.mentionedBot).toBe(false);
  });

  it("normalizeQQSdkMessage passes botAppId correctly", () => {
    const sdkMsg = {
      messageId: "m1",
      senderId: "u1",
      senderName: "Alice",
      content: "hi <@123>",
      kind: "group",
      groupOpenid: "g1",
      rawEventType: "GROUP_MESSAGE_CREATE",
      mentions: [],
      replyTarget: { scope: "group" as const, targetId: "g1", msgId: "m1" },
    };
    const msg = normalizeQQSdkMessage(sdkMsg as never, { accountId: "acc1", botAppId: "123" });
    expect(msg.mentionedBot).toBe(true);
    expect(msg.accountId).toBe("acc1");
  });

  it("not mixing accountId with AppID", () => {
    const sdkMsg = {
      messageId: "m2",
      senderId: "u1",
      content: "hello",
      kind: "group",
      groupOpenid: "g1",
      rawEventType: "GROUP_AT_MESSAGE_CREATE",
      replyTarget: { scope: "group" as const, targetId: "g1", msgId: "m2" },
    };
    const msg = normalizeQQSdkMessage(sdkMsg as never, { accountId: "channel_qq_1", botAppId: "999" });
    expect(msg.accountId).toBe("channel_qq_1");
    expect(msg.conversationId).toBe("g1");
  });
});
