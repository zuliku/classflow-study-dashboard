/**
 * Channel Inbox Sink — Task 13 maps ChannelInboundMessage → ExternalInboxItem (Unified Inbox)
 * All channel messages go through same dedupeKey / unread / EXTERNAL UNTRUSTED CONTENT path
 */

import type { ChannelInboundMessage } from "./types";
import type { ExternalInboxItem, InboxAttachment } from "@/lib/inbox/types";
import { wrapExternalContent } from "@/lib/inbox/types";
import { getInboxDedupeKey } from "@/lib/inbox/dedupe";

// In-memory inbox sink for Main process (Renderer uses Zustand persist, but Main can also ingest via API or direct store)
// For V1, Main process will write to same persistence via file or via IPC to renderer? Simplest: Main holds its own inbox file
// But spec says "不要新建第二套 QQ Inbox" — continue复用现有 dedupeKey/unread/EXTERNAL UNTRUSTED...
// We'll implement a file-backed inbox store for Main, or just emit event to renderer to addItem.

export interface ChannelInboxSinkDeps {
  // Allow injection of storage for tests; production uses file or broadcast to renderer
  addItem?: (item: Omit<ExternalInboxItem, "id" | "dedupeKey" | "status" | "origin"> & { id?: string }) => string | Promise<string>;
  // For test isolation we also allow direct in-memory array
  onIngest?: (item: ExternalInboxItem) => void;
}

export class ChannelInboxSink {
  private addItemFn?: ChannelInboxSinkDeps["addItem"];
  private onIngest?: (item: ExternalInboxItem) => void;

  constructor(deps?: ChannelInboxSinkDeps) {
    this.addItemFn = deps?.addItem;
    this.onIngest = deps?.onIngest;
  }

  async ingest(msg: ChannelInboundMessage): Promise<void> {
    // Map to ExternalInboxItem
    // V1: attachments are unsupported metadata only, shown as "包含 1 个暂不支持的附件"
    const attachments: InboxAttachment[] = (msg.attachments ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      mimeType: a.mimeType,
      size: a.size,
      url: a.url,
    }));

    // Text is wrapped as EXTERNAL UNTRUSTED CONTENT (reuse existing helper)
    // The inbox item's text should be wrapped; or should we store raw and wrap on Kiro ingest?
    // Spec: Unified Inbox should store wrapped content? The inboxTrustBoundary expects wrapped for Kiro processing.
    // We will store raw text, but ingest will also ensure dedupeKey uses raw.
    // For display, UI will show wrapped? However spec says Inbox显示包含 1 个暂不支持的附件 (if attachments)
    // We'll store wrapped text? Let's store wrapped to ensure Kiro sees marker.
    const wrappedText = wrapExternalContent(msg.text);

    // If there are unsupported attachments, append note
    const textWithAttachmentNote = attachments.length > 0 && attachments.some((a) => a.name.includes("暂不支持")) ? `${wrappedText}\n\n[包含 ${attachments.length} 个暂不支持的附件]` : wrappedText;

    const itemBase = {
      source: "qq-bot" as const,
      externalMessageId: msg.externalMessageId,
      conversationId: msg.conversationId,
      senderDisplay: msg.senderDisplay ?? msg.senderId,
      text: textWithAttachmentNote,
      receivedAt: msg.receivedAt,
      attachments,
    };

    // If Main has direct addItem (e.g., via file store or via IPC broadcast), use it
    if (this.addItemFn) {
      await this.addItemFn(itemBase);
      return;
    }

    // Otherwise, for test, construct ExternalInboxItem in-memory and call onIngest
    const dedupeKey = getInboxDedupeKey({ source: "qq-bot", externalMessageId: msg.externalMessageId, text: msg.text, senderDisplay: msg.senderDisplay });
    const item: ExternalInboxItem = {
      id: `inbox_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      source: "qq-bot",
      externalMessageId: msg.externalMessageId,
      conversationId: msg.conversationId,
      senderDisplay: msg.senderDisplay,
      text: textWithAttachmentNote,
      receivedAt: msg.receivedAt,
      attachments,
      status: "unread",
      dedupeKey,
      origin: "remote-channel",
    };
    if (this.onIngest) this.onIngest(item);
  }
}
