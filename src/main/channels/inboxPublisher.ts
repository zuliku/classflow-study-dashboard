/**
 * Inbox Publisher — Main → Renderer bridge for ChannelInboundMessage raw input
 * Task 13C: reliable delivery queue with rendererReady + ACK, not fire-and-forget
 */

import { getInboxDeliveryQueue } from "./inboxDeliveryQueue";

export type InboxRawPayload = {
  source: "qq-bot";
  externalMessageId: string;
  conversationId: string;
  senderDisplay?: string;
  subject?: string;
  text: string;
  receivedAt: number;
  attachments?: Array<{ id: string; name: string; mimeType?: string; size?: number; url?: string }>;
  sourceAccountId?: string;
};

let sender: ((envelope: { deliveryId: string; payload: InboxRawPayload }) => void) | null = null;
let rendererReady = false;

export function setInboxPublisher(fn: (envelope: { deliveryId: string; payload: InboxRawPayload }) => void): void {
  sender = fn;
  // Do not automatically flush here; wait for rendererReady signal
}

export function setRendererReady(ready: boolean): void {
  rendererReady = ready;
  const queue = getInboxDeliveryQueue();
  queue.setRendererReady(ready);
  if (ready && sender) {
    const pending = queue.listPending();
    for (const env of pending) {
      try {
        sender({ deliveryId: env.deliveryId, payload: env.payload });
      } catch {}
    }
  }
}

export function publishInboxRaw(payload: InboxRawPayload): string {
  const queue = getInboxDeliveryQueue();
  const deliveryId = queue.enqueue(payload);
  if (rendererReady && sender) {
    try {
      sender({ deliveryId, payload });
    } catch (e) {
      console.warn("[inboxPublisher] send failed", (e as Error).message);
    }
  } else {
    // Queued, will be sent on rendererReady
    console.info(`[inboxPublisher] queued deliveryId=${deliveryId} rendererReady=${rendererReady}`);
  }
  return deliveryId;
}

export function ackInboxDelivery(deliveryId: string): boolean {
  const queue = getInboxDeliveryQueue();
  return queue.ack(deliveryId);
}

export function __clearInboxPublisherForTest(): void {
  sender = null;
  rendererReady = false;
  getInboxDeliveryQueue().clear();
}

export function __getInboxPublisherForTest(): ((envelope: { deliveryId: string; payload: InboxRawPayload }) => void) | null {
  return sender;
}

export function __isRendererReadyForTest(): boolean {
  return rendererReady;
}
