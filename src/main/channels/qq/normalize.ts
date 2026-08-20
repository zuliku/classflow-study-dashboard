/**
 * QQ Raw → ChannelInboundMessage normalize — Task 13B
 * Only keep necessary fields, never store raw SDK object into Zustand/History/Skill/Model
 * Official SDK 1.0.4 fields: messageId, senderId, senderName, senderIsBot, content, timestamp, kind, groupOpenid, rawEventType, mentions, attachments, replyTarget
 */

import type { ChannelInboundMessage, ChannelAttachment } from "../types";

export interface QQRawMessageLike {
  id?: string;
  msgId?: string;
  messageId?: string;
  externalMessageId?: string;
  conversationId?: string;
  groupId?: string;
  groupOpenId?: string;
  groupOpenid?: string;
  userId?: string;
  userOpenId?: string;
  openId?: string;
  senderId?: string;
  authorId?: string;
  senderDisplay?: string;
  authorName?: string;
  senderName?: string;
  senderIsBot?: boolean;
  content?: string;
  text?: string;
  rawContent?: string;
  attachments?: unknown[];
  timestamp?: number | string;
  receivedAt?: number;
  createdAt?: number;
  chatType?: "c2c" | "group" | "direct" | "guild";
  conversationType?: "direct" | "group";
  isGroup?: boolean;
  kind?: string;
  isMentioned?: boolean;
  mentioned?: boolean;
  mentionedBot?: boolean;
  atBot?: boolean;
  isSelf?: boolean;
  eventType?: string;
  rawEventType?: string;
  mentions?: unknown[];
  replyTarget?: { scope?: string; targetId?: string; msgId?: string };
}

function mapAttachments(rawAttachments: unknown[]): ChannelAttachment[] | undefined {
  if (!Array.isArray(rawAttachments) || rawAttachments.length === 0) return undefined;
  return rawAttachments.slice(0, 3).map((att: unknown, idx: number) => {
    const a = att as Record<string, unknown>;
    const name = String(a.filename ?? a.name ?? `附件${idx + 1}`);
    const mime = typeof a.content_type === "string" ? a.content_type : typeof a.mimeType === "string" ? a.mimeType : typeof a.contentType === "string" ? a.contentType : undefined;
    return {
      id: String(a.id ?? `att_${idx}`),
      name,
      mimeType: mime,
      size: typeof a.size === "number" ? a.size : undefined,
      url: typeof a.url === "string" ? a.url : undefined,
      kind: "unsupported" as const,
    };
  });
}

export function normalizeQQMessage(
  raw: QQRawMessageLike,
  opts: { accountId: string; botId?: string }
): ChannelInboundMessage {
  const externalMessageId = String(raw.externalMessageId ?? raw.messageId ?? raw.msgId ?? raw.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const isGroup = raw.isGroup === true || raw.chatType === "group" || raw.conversationType === "group" || raw.kind === "group" || !!raw.groupId || !!raw.groupOpenId || !!raw.groupOpenid;
  const conversationType: "direct" | "group" = isGroup ? "group" : "direct";
  const conversationId = String(
    raw.conversationId ??
      raw.replyTarget?.targetId ??
      raw.groupOpenid ??
      raw.groupOpenId ??
      raw.groupId ??
      raw.userOpenId ??
      raw.userId ??
      raw.openId ??
      raw.senderId ??
      "unknown"
  );
  const senderId = String(raw.senderId ?? raw.authorId ?? raw.senderName ?? raw.userId ?? raw.userOpenId ?? raw.openId ?? "unknown");
  const senderDisplay = raw.senderDisplay ?? raw.authorName ?? raw.senderName ?? undefined;
  const text = String(raw.text ?? raw.content ?? raw.rawContent ?? "");
  const receivedAt = Number(raw.receivedAt ?? (typeof raw.timestamp === "string" ? Date.parse(raw.timestamp) : raw.timestamp) ?? raw.createdAt ?? Date.now());
  const rawEventType = raw.rawEventType ?? raw.eventType ?? (isGroup ? "GROUP_AT_MESSAGE_CREATE" : "C2C_MESSAGE_CREATE");

  let attachments = mapAttachments(raw.attachments as unknown[]);
  if (!attachments && (text.includes("[图片]") || text.includes("[语音]") || text.includes("[视频]") || text.includes("[文件]"))) {
    attachments = [{ id: `unsupported_${Date.now()}`, name: "暂不支持的附件", kind: "unsupported" as const }];
  }

  // Mention detection: GROUP_AT_MESSAGE_CREATE already means @, GROUP_MESSAGE_CREATE uses mentions
  let mentionedBot: boolean | undefined;
  if (rawEventType === "GROUP_AT_MESSAGE_CREATE") mentionedBot = true;
  else if (rawEventType === "GROUP_MESSAGE_CREATE") {
    if (Array.isArray(raw.mentions) && raw.mentions.length > 0) mentionedBot = true;
    else mentionedBot = false;
  } else if (typeof raw.mentionedBot === "boolean") mentionedBot = raw.mentionedBot;
  else if (typeof raw.isMentioned === "boolean") mentionedBot = raw.isMentioned;

  const isSelf = raw.isSelf ?? raw.senderIsBot ?? false;

  return {
    channel: "qq-bot",
    accountId: opts.accountId,
    externalMessageId,
    conversationId: conversationId === "unknown" || conversationId === "" ? `fallback_${externalMessageId}` : conversationId,
    conversationType,
    senderId,
    senderDisplay,
    subject: undefined,
    text: text.slice(0, 4000),
    receivedAt: Number.isFinite(receivedAt) ? receivedAt : Date.now(),
    attachments,
    rawEventType,
    mentionedBot,
    isSelf: isSelf ? true : undefined,
  };
}

// Official SDK 1.0.4 mapping
export function normalizeQQSdkMessage(
  sdkMsg: {
    messageId?: string;
    senderId?: string;
    senderName?: string;
    senderIsBot?: boolean;
    content?: string;
    timestamp?: string | number;
    kind?: string;
    groupOpenid?: string;
    groupOpenId?: string;
    rawEventType?: string;
    mentions?: unknown[];
    attachments?: unknown[];
    replyTarget?: { scope: "c2c" | "group"; targetId: string; msgId?: string };
    // legacy fallback fields
    id?: string;
    author?: { id?: string; username?: string };
    userOpenId?: string;
    isMentioned?: boolean;
  },
  opts: { accountId: string; isGroup?: boolean }
): ChannelInboundMessage {
  // Preserve official fields, fallback to legacy for tests
  const messageId = sdkMsg.messageId ?? sdkMsg.id;
  const senderId = sdkMsg.senderId ?? sdkMsg.author?.id;
  const senderName = sdkMsg.senderName ?? sdkMsg.author?.username;
  const senderIsBot = sdkMsg.senderIsBot;
  const content = sdkMsg.content;
  const timestamp = sdkMsg.timestamp;
  const kind = sdkMsg.kind;
  const groupOpenid = sdkMsg.groupOpenid ?? sdkMsg.groupOpenId;
  const rawEventType = sdkMsg.rawEventType;
  const mentions = sdkMsg.mentions;
  const attachments = sdkMsg.attachments;
  const replyTarget = sdkMsg.replyTarget;

  // Determine group vs direct via replyTarget.scope or kind or groupOpenid presence
  const isGroup = opts.isGroup ?? (replyTarget?.scope === "group" || kind === "group" || !!groupOpenid);

  const raw: QQRawMessageLike = {
    messageId,
    senderId,
    senderName,
    senderIsBot,
    content,
    timestamp: timestamp as never,
    kind: kind as never,
    groupOpenid,
    rawEventType,
    mentions: mentions as never,
    attachments: attachments as never,
    replyTarget: replyTarget as never,
    isGroup,
    // legacy fallbacks
    id: sdkMsg.id,
    authorId: sdkMsg.author?.id,
    authorName: sdkMsg.author?.username,
    groupOpenId: sdkMsg.groupOpenId,
    userOpenId: sdkMsg.userOpenId,
  };

  return normalizeQQMessage(raw, { accountId: opts.accountId });
}
