/**
 * Email Channel Types — Task 18A
 * Generic Email Core + Gmail V1 + QQ Mail (reserved)
 */

export interface GmailChannelConfig {
  id: string;
  channel: "gmail";
  enabled: boolean;
  displayName: string;
  emailAddress: string;
  credentialRef: string;
  syncIntervalSeconds: 60;
}

export interface QQMailChannelConfig {
  id: string;
  channel: "qq-mail";
  enabled: boolean;
  displayName: string;
  emailAddress: string;
  credentialRef: string;
  syncIntervalSeconds: 60;
}

export interface EmailNormalizedMessage {
  channel: "gmail" | "qq-mail";
  accountId: string;
  providerMessageId: string;
  rfcMessageId: string;
  threadId?: string;
  fromAddress: string;
  fromDisplay?: string;
  replyToAddress: string;
  subject: string;
  text: string;
  receivedAt: number;
  references: string[];
  inReplyTo?: string;
  attachments: Array<{
    name: string;
    mimeType: string;
    size: number;
    providerAttachmentId: string;
  }>;
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
}
