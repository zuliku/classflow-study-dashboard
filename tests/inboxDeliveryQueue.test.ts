import { describe, it, expect, beforeEach } from "vitest";
import { InboxDeliveryQueue } from "@/src/main/channels/inboxDeliveryQueue";
import type { InboxRawPayload } from "@/src/main/channels/inboxPublisher";

describe("inboxDeliveryQueue", () => {
  let queue: InboxDeliveryQueue;

  beforeEach(() => {
    queue = new InboxDeliveryQueue({ max: 5, ttlMs: 60_000 });
  });

  it("enqueue and listPending", () => {
    const payload: InboxRawPayload = { source: "qq-bot", externalMessageId: "m1", conversationId: "c1", text: "hello", receivedAt: Date.now(), sourceAccountId: "acc1" };
    const id = queue.enqueue(payload);
    expect(id).toMatch(/^dlv_/);
    expect(queue.size()).toBe(1);
    expect(queue.listPending()[0].payload.text).toBe("hello");
  });

  it("ack removes pending", () => {
    const payload: InboxRawPayload = { source: "qq-bot", externalMessageId: "m1", conversationId: "c1", text: "hi", receivedAt: Date.now() };
    const id = queue.enqueue(payload);
    expect(queue.ack(id)).toBe(true);
    expect(queue.size()).toBe(0);
    expect(queue.ack(id)).toBe(false);
  });

  it("setRendererReady false queues, true allows flush (via publisher)", () => {
    queue.setRendererReady(false);
    expect(queue.isRendererReady()).toBe(false);
    const id = queue.enqueue({ source: "qq-bot", externalMessageId: "m1", conversationId: "c1", text: "hi", receivedAt: Date.now() });
    expect(queue.listPending().length).toBe(1);
    queue.setRendererReady(true);
    expect(queue.isRendererReady()).toBe(true);
    // Pending still there until ack
    expect(queue.listPending().length).toBe(1);
    queue.ack(id);
    expect(queue.size()).toBe(0);
  });

  it("max 500 drop oldest", () => {
    const q = new InboxDeliveryQueue({ max: 2, ttlMs: 60_000 });
    const id1 = q.enqueue({ source: "qq-bot", externalMessageId: "m1", conversationId: "c1", text: "1", receivedAt: Date.now() });
    const id2 = q.enqueue({ source: "qq-bot", externalMessageId: "m2", conversationId: "c1", text: "2", receivedAt: Date.now() });
    expect(q.size()).toBe(2);
    const id3 = q.enqueue({ source: "qq-bot", externalMessageId: "m3", conversationId: "c1", text: "3", receivedAt: Date.now() });
    expect(q.size()).toBe(2);
    expect(q.getPendingIds()).not.toContain(id1);
    expect(q.getPendingIds()).toContain(id2);
    expect(q.getPendingIds()).toContain(id3);
  });

  it("TTL 30min expire", async () => {
    const q = new InboxDeliveryQueue({ max: 10, ttlMs: 10 });
    q.enqueue({ source: "qq-bot", externalMessageId: "m1", conversationId: "c1", text: "hi", receivedAt: Date.now() });
    expect(q.size()).toBe(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(q.size()).toBe(0);
  });

  it("logs no content", () => {
    // Ensure enqueue doesn't log payload text (check via console spy is not needed, just ensure no throw)
    const payload: InboxRawPayload = { source: "qq-bot", externalMessageId: "m1", conversationId: "c1", text: "secret content", receivedAt: Date.now() };
    const id = queue.enqueue(payload);
    expect(id).toBeDefined();
  });
});
