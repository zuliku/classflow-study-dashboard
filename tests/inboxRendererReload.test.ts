import { describe, it, expect, beforeEach, vi } from "vitest";
import { publishInboxRaw, setInboxPublisher, setRendererReady, ackInboxDelivery, __clearInboxPublisherForTest } from "@/src/main/channels/inboxPublisher";
import { getInboxDeliveryQueue, __resetInboxDeliveryQueueForTest } from "@/src/main/channels/inboxDeliveryQueue";
import { createTestInboxStore } from "@/store/useInboxStore";

describe("inboxRendererReload", () => {
  beforeEach(() => {
    __clearInboxPublisherForTest();
    __resetInboxDeliveryQueueForTest();
  });

  it("renderer reload resends unacked pending, dedupe prevents duplicate in store", async () => {
    const sent: Array<{ deliveryId: string; payload: { text: string } }> = [];
    setInboxPublisher((envelope) => sent.push(envelope as never));
    setRendererReady(false);

    const payload = { source: "qq-bot" as const, externalMessageId: "m1", conversationId: "c1", text: "hello", receivedAt: Date.now(), sourceAccountId: "acc1" };
    publishInboxRaw(payload as never);
    expect(sent.length).toBe(0); // not ready, queued
    expect(getInboxDeliveryQueue().size()).toBe(1);

    // Renderer becomes ready
    setRendererReady(true);
    expect(sent.length).toBe(1);
    expect(sent[0].payload.text).toBe("hello");
    const deliveryId = sent[0].deliveryId;

    // Simulate renderer handler: addItem and ack
    const store = createTestInboxStore();
    store.getState().addItem(payload as never);
    expect(store.getState().items.length).toBe(1);
    // Ack
    expect(ackInboxDelivery(deliveryId)).toBe(true);
    expect(getInboxDeliveryQueue().size()).toBe(0);

    // Simulate reload: ready false then true, should not resend acked
    sent.length = 0;
    setRendererReady(false);
    setRendererReady(true);
    expect(sent.length).toBe(0);

    // New message not acked, then reload should resend
    const payload2 = { source: "qq-bot" as const, externalMessageId: "m2", conversationId: "c1", text: "world", receivedAt: Date.now(), sourceAccountId: "acc1" };
    setRendererReady(false);
    publishInboxRaw(payload2 as never);
    expect(getInboxDeliveryQueue().size()).toBe(1);
    setRendererReady(true);
    expect(sent.length).toBe(1);
    expect(sent[0].payload.text).toBe("world");
    // Renderer receives but store already has same dedupe? Actually m2 is new, so store should add
    store.getState().addItem(payload2 as never);
    expect(store.getState().items.length).toBe(2);
    // Not acked yet, reload should resend same deliveryId
    const pendingId = sent[0].deliveryId;
    sent.length = 0;
    setRendererReady(false);
    setRendererReady(true);
    expect(sent.length).toBe(1);
    expect(sent[0].deliveryId).toBe(pendingId);
    // Store dedupe prevents duplicate if we add again
    store.getState().addItem(payload2 as never);
    expect(store.getState().items.length).toBe(2);
    // Now ack
    ackInboxDelivery(pendingId);
    expect(getInboxDeliveryQueue().size()).toBe(0);
  });

  it("not using inboxPublisherSet as ready flag", () => {
    // Ensure that just setting publisher does not imply ready
    const sent: unknown[] = [];
    setInboxPublisher((e) => sent.push(e));
    // Not yet ready
    publishInboxRaw({ source: "qq-bot", externalMessageId: "m1", conversationId: "c1", text: "hi", receivedAt: Date.now() } as never);
    expect(sent.length).toBe(0);
    expect(getInboxDeliveryQueue().size()).toBe(1);
    setRendererReady(true);
    expect(sent.length).toBe(1);
  });
});
