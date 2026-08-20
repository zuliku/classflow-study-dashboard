import { describe, it, expect } from "vitest";
import { evaluateQQPolicy, QQRateLimiter } from "@/src/main/channels/qq/policy";

describe("qqPolicy", () => {
  const basePolicy = {
    allowedUsers: [] as string[],
    allowedGroups: [] as string[],
    requireMentionInGroup: false,
    receiveDirectMessages: true,
    receiveGroupMessages: true,
  };

  it("allowed user → accept", () => {
    const policy = { ...basePolicy, allowedUsers: ["u1"] };
    expect(evaluateQQPolicy({ senderId: "u1", conversationId: "c1", conversationType: "direct", text: "hi" }, policy).allowed).toBe(true);
  });

  it("blocked user → drop", () => {
    const policy = { ...basePolicy, allowedUsers: ["u1"] };
    expect(evaluateQQPolicy({ senderId: "u2", conversationId: "c1", conversationType: "direct", text: "hi" }, policy).allowed).toBe(false);
  });

  it("allowed group → accept", () => {
    const policy = { ...basePolicy, allowedGroups: ["g1"] };
    expect(evaluateQQPolicy({ senderId: "u1", conversationId: "g1", conversationType: "group", text: "hi" }, policy).allowed).toBe(true);
  });

  it("blocked group → drop", () => {
    const policy = { ...basePolicy, allowedGroups: ["g1"] };
    expect(evaluateQQPolicy({ senderId: "u1", conversationId: "g2", conversationType: "group", text: "hi" }, policy).allowed).toBe(false);
  });

  it("requireMention=true without mention → drop, with mention → accept", () => {
    const policy = { ...basePolicy, requireMentionInGroup: true };
    expect(evaluateQQPolicy({ senderId: "u1", conversationId: "g1", conversationType: "group", text: "hello", isMentioned: false }, policy).allowed).toBe(false);
    expect(evaluateQQPolicy({ senderId: "u1", conversationId: "g1", conversationType: "group", text: "@bot hello", isMentioned: true }, policy).allowed).toBe(true);
  });

  it("self message → drop", () => {
    expect(evaluateQQPolicy({ senderId: "bot1", conversationId: "c1", conversationType: "direct", text: "hi", isSelf: true }, basePolicy).allowed).toBe(false);
  });

  it("direct disabled → drop even if allowedUsers empty", () => {
    const policy = { ...basePolicy, receiveDirectMessages: false };
    expect(evaluateQQPolicy({ senderId: "u1", conversationId: "c1", conversationType: "direct", text: "hi" }, policy).allowed).toBe(false);
  });

  it("group disabled → drop", () => {
    const policy = { ...basePolicy, receiveGroupMessages: false };
    expect(evaluateQQPolicy({ senderId: "u1", conversationId: "g1", conversationType: "group", text: "hi" }, policy).allowed).toBe(false);
  });

  it("rate limiter per sender", () => {
    const limiter = new QQRateLimiter({ windowMs: 1000, maxPerSender: 2, maxPerConversation: 10, maxGlobal: 100 });
    expect(limiter.allow({ senderId: "u1", conversationId: "c1" }).allowed).toBe(true);
    expect(limiter.allow({ senderId: "u1", conversationId: "c1" }).allowed).toBe(true);
    expect(limiter.allow({ senderId: "u1", conversationId: "c1" }).allowed).toBe(false);
    expect(limiter.allow({ senderId: "u2", conversationId: "c1" }).allowed).toBe(true);
  });
});
