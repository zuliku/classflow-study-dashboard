import { describe, it, expect } from "vitest";
import { getQQDedupeKey, QQMessageDedupe } from "@/src/main/channels/qq/dedupe";

describe("qqDedupe", () => {
  it("same message id only ingest once", () => {
    const dedupe = new QQMessageDedupe({ maxSize: 10, ttlMs: 60000 });
    const input = { channel: "qq-bot", accountId: "acc1", externalMessageId: "msg1", conversationId: "c1", senderId: "u1", timestamp: Date.now(), text: "hello" };
    expect(dedupe.checkAndAdd(input)).toBe(true);
    expect(dedupe.checkAndAdd(input)).toBe(false);
    expect(dedupe.size()).toBe(1);
  });

  it("disconnect reconnect same message still one", () => {
    const dedupe = new QQMessageDedupe();
    const input = { channel: "qq-bot", accountId: "acc1", externalMessageId: "msgDup", conversationId: "c1", senderId: "u1", timestamp: 1000, text: "hi" };
    expect(dedupe.checkAndAdd(input)).toBe(true);
    // simulate disconnect/reconnect
    expect(dedupe.checkAndAdd(input)).toBe(false);
    expect(dedupe.size()).toBe(1);
  });

  it("different account same message id treated as different", () => {
    const dedupe = new QQMessageDedupe();
    const a = { channel: "qq-bot", accountId: "acc1", externalMessageId: "mid", conversationId: "c1", senderId: "u1", timestamp: 1000, text: "hi" };
    const b = { channel: "qq-bot", accountId: "acc2", externalMessageId: "mid", conversationId: "c1", senderId: "u1", timestamp: 1000, text: "hi" };
    expect(getQQDedupeKey(a)).not.toBe(getQQDedupeKey(b));
    expect(dedupe.checkAndAdd(a)).toBe(true);
    expect(dedupe.checkAndAdd(b)).toBe(true);
    expect(dedupe.size()).toBe(2);
  });

  it("fallback hash when messageId missing", () => {
    const dedupe = new QQMessageDedupe();
    const input = { channel: "qq-bot", accountId: "acc1", conversationId: "c1", senderId: "u1", timestamp: 1710000000000, text: "hello world" };
    const key1 = getQQDedupeKey(input);
    const key2 = getQQDedupeKey({ ...input, text: "hello world" });
    expect(key1).toBe(key2);
    expect(dedupe.checkAndAdd(input)).toBe(true);
    expect(dedupe.checkAndAdd(input)).toBe(false);
  });

  it("TTL expiry allows later cache release", () => {
    const dedupe = new QQMessageDedupe({ ttlMs: 10 });
    const input = { channel: "qq-bot", accountId: "acc1", externalMessageId: "ttlMsg", conversationId: "c1", senderId: "u1", timestamp: 1000, text: "hi" };
    expect(dedupe.checkAndAdd(input)).toBe(true);
    // wait for expiry
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(dedupe.has(getQQDedupeKey(input))).toBe(false);
        expect(dedupe.checkAndAdd(input)).toBe(true);
        resolve();
      }, 20);
    });
  });

  it("bounded cache LRU eviction", () => {
    const dedupe = new QQMessageDedupe({ maxSize: 2, ttlMs: 60000 });
    dedupe.checkAndAdd({ channel: "qq-bot", accountId: "a", externalMessageId: "m1", conversationId: "c", senderId: "u", timestamp: 1, text: "1" });
    dedupe.checkAndAdd({ channel: "qq-bot", accountId: "a", externalMessageId: "m2", conversationId: "c", senderId: "u", timestamp: 1, text: "2" });
    expect(dedupe.size()).toBe(2);
    dedupe.checkAndAdd({ channel: "qq-bot", accountId: "a", externalMessageId: "m3", conversationId: "c", senderId: "u", timestamp: 1, text: "3" });
    expect(dedupe.size()).toBe(2);
    // m1 should have been evicted
    expect(dedupe.has(getQQDedupeKey({ channel: "qq-bot", accountId: "a", externalMessageId: "m1", conversationId: "c", senderId: "u", timestamp: 1, text: "1" }))).toBe(false);
  });
});
