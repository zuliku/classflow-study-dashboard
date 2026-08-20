/**
 * QQ Transport — Task 13 WebSocket Gateway (Transport-independent)
 * Business logic never writes directly into WebSocket callback; it emits normalized ChannelInboundMessage via handler.
 * SDK provides heartbeat/reconnect/RESUME; we wrap with dynamic import and keep business decoupled.
 */

import type { ChannelInboundMessage } from "../types";
import type { QQChannelConfig } from "./config";

export type QQTransportState = "disconnected" | "connecting" | "connected" | "reconnecting" | "error";

export interface QQTransportEvents {
  onMessage: (msg: ChannelInboundMessage) => void | Promise<void>;
  onStateChange: (state: QQTransportState, error?: { code: string; message: string }) => void;
}

export interface QQSdkClientLike {
  start: (signal?: AbortSignal) => Promise<void>;
  stop: () => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  off?: (event: string, handler: (...args: unknown[]) => void) => void;
  // minimal send (not used V1 but reserved)
  sendText?: (target: unknown, content: string) => Promise<unknown>;
  accountId?: string;
}

/**
 * Real transport using @tencent-connect/qqbot-nodejs via dynamic import.
 * Keeps SDK types isolated to this file; Adapter only sees ChannelInboundMessage.
 */
export class QQWebSocketTransport {
  private config: QQChannelConfig;
  private events: QQTransportEvents;
  private client: QQSdkClientLike | null = null;
  private state: QQTransportState = "disconnected";
  private appSecret: string;
  private abortController: AbortController | null = null;

  constructor(config: QQChannelConfig, appSecret: string, events: QQTransportEvents) {
    this.config = config;
    this.appSecret = appSecret;
    this.events = events;
  }

  private setState(s: QQTransportState, err?: { code: string; message: string }) {
    this.state = s;
    this.events.onStateChange(s, err);
  }

  async start(): Promise<void> {
    if (this.state === "connecting" || this.state === "connected") return;
    this.setState("connecting");
    this.abortController = new AbortController();
    try {
      // Dynamic import to avoid ESM build issues with Electron
      const mod = await import("@tencent-connect/qqbot-nodejs") as unknown as { QQBot: new (opts: unknown) => QQSdkClientLike & { on: (e: string, h: (...a: unknown[]) => void) => void; use?: (...a: unknown[]) => void } };
      const QQBot = mod.QQBot;
      if (!QQBot) throw new Error("QQBot not found in SDK");

      const bot = new QQBot({
        appId: this.config.appId,
        appSecret: this.appSecret,
        accountId: this.config.id,
        transport: "websocket",
        // Use sync token prefetch to fail-fast on auth
        tokenPrefetch: "sync",
      }) as unknown as QQSdkClientLike & { use?: (...a: unknown[]) => void; on: (e: string, h: (...args: unknown[]) => void) => void };

      // Optional: middleware for mentionGate / messageFilter if SDK provides - but we keep our own policy
      // For now just rely on SDK skipSelfEcho if available via middleware; but we also self-check in adapter.

      bot.on("ready", () => this.setState("connected"));
      bot.on("resumed", () => this.setState("connected"));
      bot.on("error", (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("401") || msg.includes("auth") || msg.includes("AppSecret")) {
          this.setState("error", { code: "QQ_AUTH_FAILED", message: msg.slice(0, 200) });
        } else if (msg.includes("rate")) {
          this.setState("error", { code: "QQ_RATE_LIMITED", message: msg.slice(0, 200) });
        } else {
          this.setState("reconnecting", { code: "QQ_GATEWAY_DISCONNECTED", message: msg.slice(0, 200) });
        }
      });

      // Message handler - SDK emits "message" with (ctx, msg)
      bot.on("message", async (...args: unknown[]) => {
        // SDK signature: (ctx, msg) where msg has content, replyTarget, author, etc.
        // We do minimal mapping without trusting raw shape
        const msg = (args[1] ?? args[0]) as Record<string, unknown> | undefined;
        if (!msg) return;
        try {
          const { normalizeQQSdkMessage } = await import("./normalize");
          // detect isGroup via replyTarget.scope or groupOpenId
          const replyTarget = (msg as unknown as { replyTarget?: { scope?: string } })?.replyTarget;
          const isGroup = replyTarget?.scope === "group";
          const normalized = normalizeQQSdkMessage(
            msg as never,
            { accountId: this.config.id, isGroup }
          );
          await this.events.onMessage(normalized);
        } catch (e) {
          // sanitize log: not containing content
          console.warn(`[qq-transport] normalize failed ${String(e).slice(0, 200)}`);
        }
      });

      this.client = bot;
      await bot.start(this.abortController.signal);
      this.setState("connected");
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      if (raw.includes("401") || raw.includes("auth") || raw.includes("AppSecret") || raw.includes("credential")) {
        this.setState("error", { code: "QQ_AUTH_FAILED", message: raw.slice(0, 300) });
        throw new Error(JSON.stringify({ code: "QQ_AUTH_FAILED", message: "QQ 机器人认证失败" }));
      }
      if (raw.includes("QQ_AUTH_FAILED")) {
        this.setState("error", { code: "QQ_AUTH_FAILED", message: raw.slice(0, 300) });
        throw e;
      }
      this.setState("error", { code: "QQ_NETWORK_ERROR", message: raw.slice(0, 300) });
      throw new Error(JSON.stringify({ code: "QQ_NETWORK_ERROR", message: raw.slice(0, 300) }));
    }
  }

  async stop(): Promise<void> {
    try {
      this.abortController?.abort();
    } catch {}
    try {
      this.client?.stop();
    } catch {}
    this.client = null;
    this.setState("disconnected");
    // Explicitly clear secret ref
    (this as unknown as { appSecret: string }).appSecret = "";
  }

  getState(): QQTransportState {
    return this.state;
  }

  // Test helper: inject fake client
  __setClientForTest(client: QQSdkClientLike) {
    this.client = client;
    this.setState("connected");
  }
}

/**
 * Fake transport for tests — no network, manual emit.
 */
export class FakeQQTransport {
  private events: QQTransportEvents;
  private state: QQTransportState = "disconnected";
  public emittedMessages: ChannelInboundMessage[] = [];
  constructor(events: QQTransportEvents) {
    this.events = events;
  }
  async start(): Promise<void> {
    this.state = "connected";
    this.events.onStateChange("connected");
  }
  async stop(): Promise<void> {
    this.state = "disconnected";
    this.events.onStateChange("disconnected");
  }
  getState(): QQTransportState {
    return this.state;
  }
  emitMessage(msg: ChannelInboundMessage) {
    this.emittedMessages.push(msg);
    void this.events.onMessage(msg);
  }
  emitDisconnect() {
    this.state = "reconnecting";
    this.events.onStateChange("reconnecting", { code: "QQ_GATEWAY_DISCONNECTED", message: "fake disconnect" });
  }
  emitReconnect() {
    this.state = "connected";
    this.events.onStateChange("connected");
  }
}
