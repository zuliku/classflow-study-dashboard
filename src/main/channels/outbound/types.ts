/**
 * Outbound Types — Task 14 explicit QQ reply
 */

import type { ChannelType } from "../types";

export interface QQReplyContext {
  replyContextId: string;
  channel: "qq-bot";
  sourceAccountId: string;
  conversationId: string;
  conversationType: "direct" | "group";
  inboundMessageId: string;
  createdAt: number;
  expiresAt: number;
}

export interface EmailReplyContext {
  replyContextId: string;
  channel: "gmail" | "qq-mail";
  sourceAccountId: string;
  providerMessageId: string;
  rfcMessageId: string;
  threadId?: string;
  subject: string;
  replyToAddress: string;
  references: string[];
  createdAt: number;
  expiresAt: number;
  // For generic handling, also expose conversation fields
  conversationId: string;
  conversationType: "direct";
  inboundMessageId: string;
}

export type ChannelReplyContext = QQReplyContext | EmailReplyContext;

export interface ChannelSendApproval {
  approvalId: string;
  replyContextId: string;
  text: string;
  textHash: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

export interface ChannelOutboundAudit {
  outboundId: string;
  channel: ChannelType;
  sourceAccountId: string;
  replyContextId: string;
  textHash: string;
  textLength: number;
  attemptedAt: number;
  status: "sent" | "failed" | "uncertain";
  platformMessageId?: string;
  errorCode?: string;
}
