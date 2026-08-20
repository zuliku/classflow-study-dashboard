/**
 * Inbox Publisher — Main → Renderer bridge for ChannelInboundMessage raw input
 * Task 13B: Main never imports Zustand, only publishes raw payload.
 */

export type InboxRawPayload = {
  source: "qq-bot";
  externalMessageId: string;
  conversationId: string;
  senderDisplay?: string;
  subject?: string;
  text: string;
  receivedAt: number;
  attachments?: Array<{ id: string; name: string; mimeType?: string; size?: number; url?: string }>;
};

let sender: ((payload: InboxRawPayload) => void) | null = null;
let pending: InboxRawPayload[] = [];

export function setInboxPublisher(fn: (payload: InboxRawPayload) => void): void {
  sender = fn;
  // Flush pending
  if (pending.length > 0) {
    const toSend = [...pending];
    pending = [];
    for (const p of toSend) {
      try {
        sender(p);
      } catch {}
    }
  }
}

export function publishInboxRaw(payload: InboxRawPayload): void {
  if (sender) {
    try {
      sender(payload);
    } catch (e) {
      console.warn("[inboxPublisher] send failed", (e as Error).message);
    }
  } else {
    // Queue until renderer subscribes (max 100)
    if (pending.length < 100) pending.push(payload);
  }
}

export function __clearInboxPublisherForTest(): void {
  sender = null;
}

export function __getInboxPublisherForTest(): ((payload: InboxRawPayload) => void) | null {
  return sender;
}
