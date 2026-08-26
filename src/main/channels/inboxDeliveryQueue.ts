/**
 * Inbox Delivery Queue — Task 13C transient delivery buffer (not second Inbox DB)
 * Pure logic, max 500, TTL 30min, drop oldest, no content in logs, ACK driven.
 */

import { randomUUID } from "node:crypto";
import type { InboxRawPayload } from "./inboxPublisher";

export interface InboxDeliveryEnvelope {
  deliveryId: string;
  payload: InboxRawPayload;
  createdAt: number;
}

export class InboxDeliveryQueue {
  private pending = new Map<string, InboxDeliveryEnvelope>();
  private order: string[] = []; // insertion order for drop oldest
  private rendererReady = false;
  private max = 500;
  // BUG-057：30min TTL 会在 renderer 长时间忙碌（长流式回复）时把「已投递未 ACK」的
  // 信封在重发前清扫掉。放宽到 24h —— 内存上限 500 条仍是主要边界。
  private ttlMs = 24 * 60 * 60 * 1000;

  constructor(opts?: { max?: number; ttlMs?: number }) {
    if (opts?.max) this.max = opts.max;
    if (opts?.ttlMs) this.ttlMs = opts.ttlMs;
  }

  setRendererReady(ready: boolean): void {
    this.rendererReady = ready;
  }

  isRendererReady(): boolean {
    return this.rendererReady;
  }

  enqueue(payload: InboxRawPayload): string {
    this.expire();
    const deliveryId = `dlv_${randomUUID().slice(0, 8)}_${Date.now().toString(36)}`;
    const envelope: InboxDeliveryEnvelope = { deliveryId, payload, createdAt: Date.now() };
    // Drop oldest if over max
    if (this.pending.size >= this.max) {
      const oldest = this.order.shift();
      if (oldest) {
        this.pending.delete(oldest);
        console.info(`[inboxQueue] drop oldest deliveryId=${oldest}`);
      }
    }
    this.pending.set(deliveryId, envelope);
    this.order.push(deliveryId);
    // Log without content
    console.info(`[inboxQueue] enqueue deliveryId=${deliveryId} source=${payload.source} account=${(payload as unknown as { sourceAccountId?: string }).sourceAccountId ?? "unknown"}`);
    return deliveryId;
  }

  listPending(): InboxDeliveryEnvelope[] {
    this.expire();
    return Array.from(this.pending.values());
  }

  ack(deliveryId: string): boolean {
    // 与 listPending 同语义：先过期再判定（否则同一逻辑状态两种结果）
    this.expire();
    const existed = this.pending.has(deliveryId);
    if (existed) {
      this.pending.delete(deliveryId);
      this.order = this.order.filter((id) => id !== deliveryId);
      console.info(`[inboxQueue] ack deliveryId=${deliveryId}`);
    }
    return existed;
  }

  expire(): void {
    const now = Date.now();
    for (const [id, env] of this.pending) {
      if (now - env.createdAt > this.ttlMs) {
        this.pending.delete(id);
        this.order = this.order.filter((x) => x !== id);
        console.info(`[inboxQueue] expire deliveryId=${id}`);
      }
    }
  }

  size(): number {
    this.expire();
    return this.pending.size;
  }

  clear(): void {
    this.pending.clear();
    this.order = [];
  }

  // For tests: get pending ids
  getPendingIds(): string[] {
    return [...this.order];
  }
}

// Singleton for production
let queue: InboxDeliveryQueue | null = null;

export function getInboxDeliveryQueue(): InboxDeliveryQueue {
  if (!queue) queue = new InboxDeliveryQueue();
  return queue;
}

export function __resetInboxDeliveryQueueForTest(): void {
  queue = null;
}
