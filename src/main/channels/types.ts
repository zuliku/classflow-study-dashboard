/**
 * Channel Runtime Types — Task 13
 * Unified Channel Interface (Transport-independent)
 * All downstream code only consumes ChannelInboundMessage, never raw SDK object.
 */
import type { QQChannelConfig } from "./qq/config";

export type ChannelType = "qq-bot";

export type ChannelState = "disabled" | "disconnected" | "connecting" | "connected" | "reconnecting" | "error";

export interface ChannelAttachment {
  id: string;
  name: string;
  mimeType?: string;
  size?: number;
  url?: string;
  /** V1: unsupported attachment metadata (no auto download) */
  kind?: "unsupported" | "image" | "file";
}

export interface ChannelInboundMessage {
  channel: "qq-bot";
  accountId: string;
  externalMessageId: string;
  conversationId: string;
  conversationType: "direct" | "group";
  senderId: string;
  senderDisplay?: string;
  subject?: string;
  text: string;
  receivedAt: number;
  attachments?: ChannelAttachment[];
  rawEventType?: string;
  /** SDK protocol facts, not trust origin */
  mentionedBot?: boolean;
  isSelf?: boolean;
}

export interface ChannelHealth {
  channel: ChannelType;
  id: string;
  state: ChannelState;
  accountId?: string;
  lastConnectedAt?: number;
  lastError?: { code: string; message: string };
  messageCount?: number;
}

export interface ChannelAdapter {
  readonly id: string;
  readonly channel: ChannelType;
  getState(): ChannelState;
  getHealth(): ChannelHealth;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** @deprecated Use ChannelManager.disconnect+connect (re-resolve secret). Kept for compat but should not be used. */
  restart?(): Promise<void>;
  /** Optional: explicit send (V1 receive-only, but API reserved) */
  sendText?(target: { conversationId: string; conversationType: "direct" | "group" }, text: string): Promise<void>;
  dispose?(): Promise<void>;
}

export type ChannelFactory = (config: QQChannelConfig) => ChannelAdapter;

export type { QQChannelConfig };
