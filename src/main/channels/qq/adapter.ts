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
    await this.stop();
    // appSecret was cleared on stop, need to re-resolve from SecretVault? But adapter holds secret only for lifecycle.
    // For V1, restart requires caller to provide new adapter with fresh secret. If still have secret, reconnect.
    // If secret cleared, we throw invalid config.
    if (!this.appSecret) {
      throw new ChannelError("QQ_INVALID_CONFIG", "Missing appSecret for restart");
    }
    await this.start();
  }

  // For testing: inject message directly without transport
  async handleInbound(rawMsg: ChannelInboundMessage): Promise<void> {
    // Self protection (double layer: SDK skipSelfEcho + here)
    if (this.botIdentity && rawMsg.senderId === this.botIdentity) {
      // drop self echo
      return;
    }
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

    // Policy
    const isMentioned = rawMsg.text.includes(`@${this.config.appId}`) || rawMsg.text.includes("@bot") || (rawMsg.rawEventType?.includes("AT") ?? false);
    // Heuristic: group @ detection via text containing @
    const policyDecision = evaluateQQPolicy(
      {
        senderId: rawMsg.senderId,
        conversationId: rawMsg.conversationId,
        conversationType: rawMsg.conversationType,
        text: rawMsg.text,
        isMentioned,
        isSelf: this.botIdentity ? rawMsg.senderId === this.botIdentity : false,
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

    // Forward to inbox (V1: only create inbox, not auto AI)
    await this.inboxSink.ingest(rawMsg);
    this.messageCount += 1;
  }

  // Optional sendText (receive-only V1 but API reserved for explicit user action)
  async sendText(target: { conversationId: string; conversationType: "direct" | "group" }, text: string): Promise<void> {
    if (!this.transport) throw new ChannelError("QQ_GATEWAY_DISCONNECTED", "Not connected");
    // For V1, we do not auto-reply; this is explicit manual operation path for future task
    // If transport supports sendText, delegate (Fake will no-op)
    const t = this.transport as unknown as { sendText?: (target: unknown, text: string) => Promise<void> };
    if (typeof t.sendText === "function") {
      await t.sendText({ scope: target.conversationType === "group" ? "group" : "c2c", targetId: target.conversationId }, text);
    }
  }

  // For tests: expose dedupe size
  __getDedupeSizeForTest(): number {
    return this.dedupe.size();
  }
}
