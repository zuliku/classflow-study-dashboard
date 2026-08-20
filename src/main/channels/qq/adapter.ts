/**
 * QQ Channel Adapter — Task 13 main adapter
 * Implements ChannelAdapter, isolates SDK, handles dedupe, policy, self-protection, rate limit, and forwards to inboxSink.
 * V1: receive-only (sendText reserved but not auto-used).
 */

import type { ChannelState, ChannelHealth, ChannelInboundMessage, ChannelAdapter } from "../types";
import type { QQChannelConfig } from "./config";
import { QQMessageDedupe, getQQDedupeKey } from "./dedupe";
import { evaluateQQPolicy, QQRateLimiter } from "./policy";
import type { QQTransportEvents } from "./transport";
import { ChannelError } from "../errors";
import { getReplyContextStore } from "../outbound/replyContextStore";

export type QQSdkClientFactory = (config: QQChannelConfig, appSecret: string, events: QQTransportEvents) => {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getState: () => string;
  __setClientForTest?: (c: unknown) => void;
};

export interface QQAdapterDeps {
  config: QQChannelConfig;
  appSecret: string;
  inboxSink: { ingest: (msg: ChannelInboundMessage) => Promise<void> };
  transportFactory?: QQSdkClientFactory;
  botIdentity?: string; // self id to filter echo
}

export class QQChannelAdapter implements ChannelAdapter {
  readonly channel = "qq-bot" as const;
  readonly id: string;
  private config: QQChannelConfig;
  private appSecret: string;
  private inboxSink: { ingest: (msg: ChannelInboundMessage) => Promise<void> };
  private transport: { start: () => Promise<void>; stop: () => Promise<void>; getState: () => string } | null = null;
  private transportFactory: QQSdkClientFactory | undefined;
  private state: ChannelState = "disconnected";
  private lastError?: { code: string; message: string };
  private lastConnectedAt?: number;
  private messageCount = 0;
  private dedupe: QQMessageDedupe;
  private rateLimiter: QQRateLimiter;
  private botIdentity?: string;

  constructor(deps: QQAdapterDeps) {
    this.id = deps.config.id;
    this.config = deps.config;
    this.appSecret = deps.appSecret;
    this.inboxSink = deps.inboxSink;
    this.transportFactory = deps.transportFactory;
    this.botIdentity = deps.botIdentity;
    this.dedupe = new QQMessageDedupe({ maxSize: 500, ttlMs: 10 * 60 * 1000 });
    this.rateLimiter = new QQRateLimiter();
  }

  getState(): ChannelState {
    return this.state;
  }

  getHealth(): ChannelHealth {
    return {
      channel: "qq-bot",
      id: this.id,
      state: this.state,
      accountId: this.config.appId,
      lastConnectedAt: this.lastConnectedAt,
      lastError: this.lastError,
      messageCount: this.messageCount,
    };
  }

  private setState(s: ChannelState, err?: { code: string; message: string }) {
    this.state = s;
    if (err) this.lastError = err;
    if (s === "connected") {
      this.lastConnectedAt = Date.now();
      this.lastError = undefined;
    }
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.setState("disabled");
      return;
    }
    if (this.state === "connecting" || this.state === "connected") return;
    this.setState("connecting");
    try {
      // Resolve transport
      if (this.transportFactory) {
        // Test / injected factory
        const events: QQTransportEvents = {
          onMessage: (msg) => this.handleInbound(msg),
          onStateChange: (st, err) => {
            if (st === "connected") this.setState("connected");
            else if (st === "reconnecting") this.setState("reconnecting", err);
            else if (st === "error") this.setState("error", err);
            else if (st === "disconnected") this.setState("disconnected");
          },
        };
        this.transport = this.transportFactory(this.config, this.appSecret, events);
      } else {
        const { QQWebSocketTransport } = await import("./transport");
        const events: QQTransportEvents = {
          onMessage: (msg) => this.handleInbound(msg),
          onStateChange: (st, err) => {
            if (st === "connected") this.setState("connected");
            else if (st === "reconnecting") this.setState("reconnecting", err);
            else if (st === "error") this.setState("error", err);
            else if (st === "disconnected") this.setState("disconnected");
          },
        };
        this.transport = new QQWebSocketTransport(this.config, this.appSecret, events);
      }
      await this.transport.start();
      this.setState("connected");
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      let code = "QQ_SDK_ERROR";
      let msg = raw.slice(0, 300);
      try {
        const parsed = JSON.parse(raw) as { code?: string; message?: string };
        if (parsed.code) {
          code = parsed.code;
          msg = parsed.message ?? msg;
        }
      } catch {}
      // Map to known codes
      if (raw.includes("QQ_AUTH_FAILED") || code === "QQ_AUTH_FAILED") code = "QQ_AUTH_FAILED";
      else if (code !== "QQ_AUTH_FAILED" && code !== "QQ_NETWORK_ERROR" && code !== "QQ_RATE_LIMITED") {
        // try infer
        if (msg.includes("auth") || msg.includes("401")) code = "QQ_AUTH_FAILED";
        else if (msg.includes("network") || msg.includes("ECONN")) code = "QQ_NETWORK_ERROR";
      }
      this.setState("error", { code, message: msg });
      // Clear secret ref on auth fail for safety (keep config credentialRef but release memory)
      if (code === "QQ_AUTH_FAILED") {
        // do not clear appSecret entirely - keep for retry but log only code
      }
      throw new ChannelError(code as never, msg);
    }
  }

  async stop(): Promise<void> {
    try {
      await this.transport?.stop();
    } catch {}
    this.transport = null;
    this.setState("disconnected");
    // Release secret memory
    (this as unknown as { appSecret: string }).appSecret = "";
    this.rateLimiter.reset();
  }

  async restart(): Promise<void> {
    // Deprecated: Manager should do disconnect + SecretVault.resolve + connect to avoid secret retention.
    // Kept for compat but will fail if secret cleared.
    await this.stop();
    if (!this.appSecret) {
      throw new ChannelError("QQ_INVALID_CONFIG", "Missing appSecret for restart — use Manager reconnect");
    }
    await this.start();
  }

  // For testing: inject message directly without transport
  async handleInbound(rawMsg: ChannelInboundMessage): Promise<void> {
    // Self protection double layer: SDK skipSelfEcho + here via senderIsBot
    if (rawMsg.isSelf) return;
    if (this.botIdentity && rawMsg.senderId === this.botIdentity) return;
    // Dedupe
    const dedupeKey = getQQDedupeKey({
      channel: rawMsg.channel,
      accountId: rawMsg.accountId,
      externalMessageId: rawMsg.externalMessageId,
      conversationId: rawMsg.conversationId,
      senderId: rawMsg.senderId,
      timestamp: rawMsg.receivedAt,
      text: rawMsg.text,
    });
    if (this.dedupe.has(dedupeKey)) return;
    this.dedupe.add(dedupeKey);

    // Policy: use SDK protocol facts, not text heuristic
    const isMentioned = rawMsg.mentionedBot ?? (rawMsg.rawEventType === "GROUP_AT_MESSAGE_CREATE" ? true : rawMsg.rawEventType === "GROUP_MESSAGE_CREATE" ? false : undefined);
    // Fallback: if mentionedBot undefined, treat group AT event as mentioned
    const effectiveMentioned = typeof isMentioned === "boolean" ? isMentioned : rawMsg.rawEventType?.includes("AT") ?? false;
    const policyDecision = evaluateQQPolicy(
      {
        senderId: rawMsg.senderId,
        conversationId: rawMsg.conversationId,
        conversationType: rawMsg.conversationType,
        text: rawMsg.text,
        isMentioned: effectiveMentioned,
        isSelf: !!rawMsg.isSelf,
      },
      {
        allowedUsers: this.config.allowedUsers,
        allowedGroups: this.config.allowedGroups,
        requireMentionInGroup: this.config.requireMentionInGroup,
        receiveDirectMessages: this.config.receiveDirectMessages,
        receiveGroupMessages: this.config.receiveGroupMessages,
      }
    );
    if (!policyDecision.allowed) {
      // log only filtered reason, not content
      console.info(`[qq-adapter] filtered reason=${policyDecision.reason} type=${rawMsg.conversationType}`);
      return;
    }

    // Rate limit
    const rateDecision = this.rateLimiter.allow({ senderId: rawMsg.senderId, conversationId: rawMsg.conversationId });
    if (!rateDecision.allowed) {
      console.info(`[qq-adapter] rate limited ${rateDecision.reason}`);
      return;
    }

    // Create reply context (for explicit user reply, not auto)
    let replyContextId: string | undefined;
    try {
      const store = getReplyContextStore();
      const ctx = await store.create({
        channel: "qq-bot",
        sourceAccountId: rawMsg.accountId,
        conversationId: rawMsg.conversationId,
        conversationType: rawMsg.conversationType,
        inboundMessageId: rawMsg.externalMessageId,
      });
      replyContextId = ctx.replyContextId;
    } catch (e) {
      console.warn(`[qq-adapter] reply context create failed ${(e as Error).message.slice(0,100)}`);
    }

    // Forward to inbox with replyContextId
    const msgWithContext: ChannelInboundMessage = replyContextId ? { ...rawMsg, replyContextId } as ChannelInboundMessage & { replyContextId?: string } : rawMsg;
    // Pass replyContextId via inboxSink (which will publish to renderer)
    // We need to extend ingested message to carry replyContextId
    await this.inboxSink.ingest(msgWithContext as ChannelInboundMessage);
    this.messageCount += 1;
  }

  async sendReply(target: { conversationId: string; conversationType: "direct" | "group"; inboundMessageId: string }, text: string): Promise<{ messageId?: string; timestamp?: string }> {
    if (!target.inboundMessageId) throw new ChannelError("QQ_REPLY_CONTEXT_INVALID" as never, "Missing inboundMessageId, cannot send as passive reply");
    if (!this.transport) throw new ChannelError("QQ_GATEWAY_DISCONNECTED", "Not connected");
    const t = this.transport as unknown as { sendReply: (target: unknown, text: string) => Promise<unknown> };
    if (typeof t.sendReply !== "function") throw new ChannelError("QQ_GATEWAY_DISCONNECTED", "Transport sendReply not available");
    return await t.sendReply(target, text) as { messageId?: string; timestamp?: string };
  }

  // For tests: expose dedupe size
  __getDedupeSizeForTest(): number {
    return this.dedupe.size();
  }
}
