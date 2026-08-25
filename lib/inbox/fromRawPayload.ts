/**
 * Inbox Raw Payload Mapper — Task 14B shared DTO to avoid drift between Main and Renderer
 * This file is safe for Renderer bundle (no Main-only imports)
 *
 * Source contract：与 Main 端 ChannelType / InboxRawPayload 共用 lib/inbox/types 的
 * InboxSource（qq-bot | gmail | qq-mail）。IPC 输入不可信 → 调用方先用 isInboxSource()
 * 校验后再进入本 mapper，禁止用 as never / as unknown as 掩盖 source 漂移。
 */

import type { ExternalInboxItem, InboxSource } from "./types";
import { isInboxSource } from "./types";

export interface InboxRawPayloadLike {
  source: InboxSource;
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
  };
}

/** IPC runtime 输入不可信：结构校验（source 合法 + text 可 ingest）→ 才允许进入 Store */
export function isInboxRawPayload(value: unknown): value is InboxRawPayloadLike {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return isInboxSource(p.source) && typeof p.text === "string";
}
