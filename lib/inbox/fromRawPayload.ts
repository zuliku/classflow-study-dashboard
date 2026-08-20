/**
 * Inbox Raw Payload Mapper — Task 14B shared DTO to avoid drift between Main and Renderer
 * This file is safe for Renderer bundle (no Main-only imports)
 */

import type { ExternalInboxItem } from "./types";

export interface InboxRawPayloadLike {
  source: "qq-bot";
  externalMessageId?: string;
  conversationId?: string;
  senderDisplay?: string;
  subject?: string;
  text: string;
  receivedAt: number;
  attachments?: Array<{ id: string; name: string; mimeType?: string; size?: number; url?: string }>;
  sourceAccountId?: string;
  replyContextId?: string;
}

export type InboxAddInput = Omit<ExternalInboxItem, "id" | "dedupeKey" | "status" | "origin"> & { id?: string };

export function inboxRawPayloadToInput(payload: InboxRawPayloadLike): InboxAddInput {
  return {
    source: payload.source,
    externalMessageId: payload.externalMessageId,
    conversationId: payload.conversationId,
    senderDisplay: payload.senderDisplay,
    subject: payload.subject,
    text: payload.text,
    receivedAt: payload.receivedAt,
    attachments: payload.attachments ?? [],
    sourceAccountId: payload.sourceAccountId,
    replyContextId: payload.replyContextId,
  } as unknown as InboxAddInput;
}
