/**
 * Outbound Types — Task 14 explicit QQ reply
 */

export interface ChannelReplyContext {
  replyContextId: string;
  channel: "qq-bot";
  sourceAccountId: string;
  conversationId: string;
  conversationType: "direct" | "group";
  inboundMessageId: string;
  createdAt: number;
  expiresAt: number;
}

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
  channel: "qq-bot";
  sourceAccountId: string;
  replyContextId: string;
  textHash: string;
  textLength: number;
  attemptedAt: number;
  status: "sent" | "failed" | "uncertain";
  platformMessageId?: string;
  errorCode?: string;
}
