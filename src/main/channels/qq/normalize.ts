/**
 * QQ Raw → ChannelInboundMessage normalize — Task 13
 * Only keep necessary fields, never store raw SDK object into Zustand/History/Skill/Model
 */

import type { ChannelInboundMessage, ChannelAttachment } from "../types";

export interface QQRawMessageLike {
  id?: string;
  msgId?: string;
  messageId?: string;
  externalMessageId?: string;
  // conversation
  conversationId?: string;
  groupId?: string;
  groupOpenId?: string;
  userId?: string;
  userOpenId?: string;
  openId?: string;
  // sender
  senderId?: string;
  authorId?: string;
  senderDisplay?: string;
  authorName?: string;
  // content
  content?: string;
  text?: string;
  rawContent?: string;
  // attachments/media
  attachments?: unknown[];
  // meta
  timestamp?: number;
  receivedAt?: number;
  createdAt?: number;
  // type
  chatType?: "c2c" | "group" | "direct" | "guild";
  conversationType?: "direct" | "group";
  isGroup?: boolean;
  // mention
  isMentioned?: boolean;
  mentioned?: boolean;
  atBot?: boolean;
  // self
  isSelf?: boolean;
  // rawEventType
  eventType?: string;
  rawEventType?: string;
}

export function normalizeQQMessage(
  raw: QQRawMessageLike,
  opts: { accountId: string; botId?: string }
): ChannelInboundMessage {
  const externalMessageId = String(raw.externalMessageId ?? raw.messageId ?? raw.msgId ?? raw.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const isGroup = raw.isGroup === true || raw.chatType === "group" || raw.conversationType === "group" || !!raw.groupId || !!raw.groupOpenId;
  const conversationType: "direct" | "group" = isGroup ? "group" : "direct";
  const conversationId = String(raw.conversationId ?? raw.groupOpenId ?? raw.groupId ?? raw.userOpenId ?? raw.userId ?? raw.openId ?? raw.senderId ?? "unknown");
  const senderId = String(raw.senderId ?? raw.authorId ?? raw.userId ?? raw.userOpenId ?? raw.openId ?? "unknown");
  const senderDisplay = raw.senderDisplay ?? raw.authorName ?? undefined;
  const text = String(raw.text ?? raw.content ?? raw.rawContent ?? "");
  const receivedAt = Number(raw.receivedAt ?? raw.timestamp ?? raw.createdAt ?? Date.now());
  const rawEventType = raw.rawEventType ?? raw.eventType ?? (isGroup ? "GROUP_AT_MESSAGE_CREATE" : "C2C_MESSAGE_CREATE");

  // Normalize attachments: V1 only metadata, no auto download
  let attachments: ChannelAttachment[] | undefined;
  if (Array.isArray(raw.attachments) && raw.attachments.length > 0) {
    attachments = raw.attachments.slice(0, 3).map((att: unknown, idx: number) => {
      const a = att as Record<string, unknown>;
      const name = String(a.name ?? a.filename ?? `附件${idx + 1}`);
      const mime = typeof a.mimeType === "string" ? a.mimeType : typeof a.contentType === "string" ? a.contentType : undefined;
      return {
        id: String(a.id ?? `att_${idx}`),
        name,
        mimeType: mime,
        size: typeof a.size === "number" ? a.size : undefined,
        url: typeof a.url === "string" ? a.url : undefined,
        kind: "unsupported" as const,
      };
    });
  } else if (text.includes("[图片]") || text.includes("[语音]") || text.includes("[视频]") || text.includes("[文件]")) {
    // heuristic for unsupported media marker
    attachments = [{ id: `unsupported_${Date.now()}`, name: "暂不支持的附件", kind: "unsupported" as const }];
  }

  return {
    channel: "qq-bot",
    accountId: opts.accountId,
    externalMessageId,
    conversationId,
    conversationType,
    senderId,
    senderDisplay,
    subject: undefined,
    text: text.slice(0, 4000),
    receivedAt,
    attachments,
    rawEventType,
  };
}

// SDK InboundMessage (from @tencent-connect/qqbot-nodejs) minimal mapping helper
// We keep this as a separate function to isolate SDK type dependency to adapter only
export function normalizeQQSdkMessage(
  sdkMsg: {
    id?: string;
    content?: string;
    timestamp?: string | number;
    author?: { id?: string; username?: string };
    groupOpenId?: string;
    userOpenId?: string;
    // replyTarget like
    replyTarget?: { scope: "c2c" | "group"; targetId: string; msgId?: string };
    // raw attachments if any
    attachments?: unknown[];
    // mention flag if SDK provides
    isMentioned?: boolean;
  },
  opts: { accountId: string; isGroup?: boolean }
): ChannelInboundMessage {
  const isGroup = opts.isGroup ?? !!sdkMsg.groupOpenId;
  const raw: QQRawMessageLike = {
    id: sdkMsg.id,
    content: sdkMsg.content,
    senderId: sdkMsg.author?.id,
    senderDisplay: sdkMsg.author?.username,
    conversationId: isGroup ? sdkMsg.groupOpenId : sdkMsg.userOpenId,
    timestamp: typeof sdkMsg.timestamp === "string" ? Date.parse(sdkMsg.timestamp) : sdkMsg.timestamp,
    attachments: sdkMsg.attachments,
    isGroup,
    eventType: isGroup ? "GROUP_AT_MESSAGE_CREATE" : "C2C_MESSAGE_CREATE",
  };
  return normalizeQQMessage(raw, { accountId: opts.accountId });
}
