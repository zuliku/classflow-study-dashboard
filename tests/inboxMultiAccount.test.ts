import { describe, it, expect } from "vitest";
import { createTestInboxStore } from "@/store/useInboxStore";
import { getInboxDedupeKey } from "@/lib/inbox/dedupe";

describe("inboxMultiAccount", () => {
  it("same externalMessageId different sourceAccountId => 2 items", () => {
    const store = createTestInboxStore();
    const payloadA = { source: "qq-bot" as const, externalMessageId: "msg1", conversationId: "c1", text: "hello", receivedAt: Date.now(), sourceAccountId: "qq_a" };
    const payloadB = { source: "qq-bot" as const, externalMessageId: "msg1", conversationId: "c1", text: "hello", receivedAt: Date.now(), sourceAccountId: "qq_b" };
    store.getState().addItem(payloadA as never);
    store.getState().addItem(payloadB as never);
    expect(store.getState().items.length).toBe(2);
    expect(getInboxDedupeKey({ source: "qq-bot", externalMessageId: "msg1", text: "hello", sourceAccountId: "qq_a" })).not.toBe(
      getInboxDedupeKey({ source: "qq-bot", externalMessageId: "msg1", text: "hello", sourceAccountId: "qq_b" })
    );
  });

  it("same account same message re-delivery stays 2 items", () => {
    const store = createTestInboxStore();
    const payloadA1 = { source: "qq-bot" as const, externalMessageId: "msg1", conversationId: "c1", text: "hello", receivedAt: Date.now(), sourceAccountId: "qq_a" };
    const payloadB = { source: "qq-bot" as const, externalMessageId: "msg1", conversationId: "c1", text: "hello", receivedAt: Date.now(), sourceAccountId: "qq_b" };
    const payloadA2 = { source: "qq-bot" as const, externalMessageId: "msg1", conversationId: "c1", text: "hello", receivedAt: Date.now(), sourceAccountId: "qq_a" };
    store.getState().addItem(payloadA1 as never);
    store.getState().addItem(payloadB as never);
    expect(store.getState().items.length).toBe(2);
    store.getState().addItem(payloadA2 as never);
    expect(store.getState().items.length).toBe(2);
  });

  it("fallback hash includes sourceAccountId", () => {
    const k1 = getInboxDedupeKey({ source: "qq-bot", text: "hello", senderDisplay: "Alice", sourceAccountId: "acc1" });
    const k2 = getInboxDedupeKey({ source: "qq-bot", text: "hello", senderDisplay: "Alice", sourceAccountId: "acc2" });
    expect(k1).not.toBe(k2);
  });

  it("old data without sourceAccountId compatible", () => {
    const store = createTestInboxStore();
    // Simulate old persisted item without sourceAccountId
    const oldPayload = { source: "qq-bot" as const, externalMessageId: "old1", conversationId: "c1", text: "old", receivedAt: Date.now() };
    store.getState().addItem(oldPayload as never);
    expect(store.getState().items.length).toBe(1);
    expect(store.getState().items[0].sourceAccountId).toBeUndefined();
    // New with same id but without account should dedupe with old
    store.getState().addItem(oldPayload as never);
    expect(store.getState().items.length).toBe(1);
  });
});
