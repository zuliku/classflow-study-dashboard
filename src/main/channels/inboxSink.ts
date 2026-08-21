/**
 * Channel Inbox Sink — Task 13B maps ChannelInboundMessage → Raw Inbox Input (Main → Renderer)
 * Task 13B: Sink only publishes raw payload, Renderer store generates status/origin/dedupeKey/id.
 * Never wrapExternalContent here; Kiro processing wraps once.
 */

import type { ChannelInboundMessage } from "./types";
import type { ExternalInboxItem } from "@/lib/inbox/types";
import { publishInboxRaw, type InboxRawPayload } from "./inboxPublisher";

export interface ChannelInboxSinkDeps {
  // Test injection: direct addItem (simulates Renderer store)
  addItem?: (item: Omit<ExternalInboxItem, "id" | "dedupeKey" | "status" | "origin"> & { id?: string }) => string | Promise<string>;
  onIngest?: (item: ExternalInboxItem) => void; // legacy, for backward compat tests (will receive raw-converted)
  // For publisher tests
  publishRaw?: (payload: InboxRawPayload) => void;
}

export class ChannelInboxSink {
  private addItemFn?: ChannelInboxSinkDeps["addItem"];
  private onIngest?: (item: ExternalInboxItem) => void;
  private publishRawFn?: (payload: InboxRawPayload) => void;

  constructor(deps?: ChannelInboxSinkDeps) {
    this.addItemFn = deps?.addItem;
    this.onIngest = deps?.onIngest;
    this.publishRawFn = deps?.publishRaw;
  }

  async ingest(msg: ChannelInboundMessage): Promise<void> {
    const rawPayload: InboxRawPayload = {
      source: msg.channel,
      externalMessageId: msg.externalMessageId,
      conversationId: msg.conversationId,
      senderDisplay: msg.senderDisplay ?? msg.senderId,
      subject: msg.subject,
      text: msg.text, // raw, no wrap
      receivedAt: msg.receivedAt,
      attachments: (msg.attachments ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        mimeType: a.mimeType,
        size: a.size,
        url: a.url,
      })),
      sourceAccountId: msg.accountId,
      replyContextId: (msg as unknown as { replyContextId?: string }).replyContextId,
    };

    // Test direct addItem path (simulates Renderer store)
    if (this.addItemFn) {
      await this.addItemFn(rawPayload as Omit<ExternalInboxItem, "id" | "dedupeKey" | "status" | "origin">);
      return;
    }

    // Test publishRaw injection
    if (this.publishRawFn) {
      this.publishRawFn(rawPayload);
      return;
    }

    // Production: publish via global publisher (Main → Renderer IPC)
    // If publisher is set (via setInboxPublisher), use it
    publishInboxRaw(rawPayload);

    // Fallback for legacy tests using onIngest: construct minimal ExternalInboxItem for compat but without wrap
    if (this.onIngest) {
      const { getInboxDedupeKey } = await import("@/lib/inbox/dedupe");
      const dedupeKey = getInboxDedupeKey({ source: msg.channel, externalMessageId: msg.externalMessageId, text: msg.text, senderDisplay: msg.senderDisplay, sourceAccountId: msg.accountId });
      const item: ExternalInboxItem = {
        id: `inbox_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        source: msg.channel,
        externalMessageId: msg.externalMessageId,
        conversationId: msg.conversationId,
        senderDisplay: msg.senderDisplay,
        subject: msg.subject,
        text: msg.text,
        receivedAt: msg.receivedAt,
        attachments: rawPayload.attachments ?? [],
        status: "unread",
        dedupeKey,
        origin: "remote-channel",
        sourceAccountId: msg.accountId,
        replyContextId: (msg as unknown as { replyContextId?: string }).replyContextId,
      };
      this.onIngest(item);
    }
  }
}
