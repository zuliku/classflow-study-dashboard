/**
 * QQ Transport — Task 13B WebSocket Gateway (Transport-independent)
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
  private runPromise: Promise<void> | null = null;
  private startupTimeoutMs = 15_000;

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
    const signal = this.abortController.signal;

    let readyResolve: () => void = () => {};
    let readyReject: (e: unknown) => void = () => {};
    const readyPromise = new Promise<void>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });

    const onReady = () => {
      readyResolve();
      this.setState("connected");
    };
    const onResumed = () => this.setState("connected");
    const onError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      // If still waiting for ready, reject readyPromise with auth error
      // Check if readyPromise already settled by tracking?
      // We'll reject only if not yet connected
      if (this.state === "connecting") {
        if (msg.includes("401") || msg.includes("auth") || msg.includes("AppSecret") || msg.includes("QQ_AUTH_FAILED")) {
          readyReject(new Error(JSON.stringify({ code: "QQ_AUTH_FAILED", message: msg.slice(0, 300) })));
        } else {
          // For non-auth errors during startup, also reject but with network code
          // Let startup timeout handle otherwise
        }
      }
      // Runtime errors after ready
      if (this.state === "connected" || this.state === "reconnecting") {
        if (msg.includes("401") || msg.includes("auth")) {
          this.setState("error", { code: "QQ_AUTH_FAILED", message: msg.slice(0, 200) });
        } else if (msg.includes("rate")) {
          this.setState("error", { code: "QQ_RATE_LIMITED", message: msg.slice(0, 200) });
        } else {
          this.setState("reconnecting", { code: "QQ_GATEWAY_DISCONNECTED", message: msg.slice(0, 200) });
        }
      }
    };

    let bot: QQSdkClientLike & { use?: (...a: unknown[]) => void } | null = null;
    try {
      const mod = await import("@tencent-connect/qqbot-nodejs") as unknown as {
        QQBot: new (opts: unknown) => QQSdkClientLike & { on: (e: string, h: (...a: unknown[]) => void) => void; use?: (...a: unknown[]) => void };
        messageFilter?: (opts: unknown) => unknown;
      };
      const QQBot = mod.QQBot;
      if (!QQBot) throw new Error("QQBot not found in SDK");

      bot = new QQBot({
        appId: this.config.appId,
        appSecret: this.appSecret,
        accountId: this.config.id,
        transport: "websocket",
        tokenPrefetch: "sync",
      }) as unknown as QQSdkClientLike & { use?: (...a: unknown[]) => void };

      // SDK middleware: skipSelfEcho (dedup handled by our dedupe)
      try {
        if (bot.use && mod.messageFilter) {
          const mf = (mod as unknown as { messageFilter: (o: unknown) => unknown }).messageFilter;
          if (typeof mf === "function") {
            bot.use(mf({ skipSelfEcho: true }));
          }
        } else if (bot.use) {
          // Fallback: try dynamic import of middleware
          try {
            const mid = await import("@tencent-connect/qqbot-nodejs") as unknown as { messageFilter?: (o: unknown) => unknown };
            if (mid.messageFilter && typeof bot.use === "function") {
              bot.use(mid.messageFilter({ skipSelfEcho: true }));
            }
          } catch {}
        }
      } catch {}

      bot.on("ready", onReady);
      bot.on("resumed", onResumed);
      bot.on("error", onError);

      bot.on("message", async (...args: unknown[]) => {
        const msg = (args[1] ?? args[0]) as Record<string, unknown> | undefined;
        if (!msg) return;
        try {
          const { normalizeQQSdkMessage } = await import("./normalize");
          // detect isGroup via replyTarget.scope or kind
          const replyTarget = (msg as unknown as { replyTarget?: { scope?: string } })?.replyTarget;
          const kind = (msg as unknown as { kind?: string })?.kind;
          const isGroup = replyTarget?.scope === "group" || kind === "group";
          const normalized = normalizeQQSdkMessage(msg as never, { accountId: this.config.id, isGroup });
          await this.events.onMessage(normalized);
        } catch (e) {
          console.warn(`[qq-transport] normalize failed ${String(e).slice(0, 200)}`);
        }
      });

      this.client = bot as QQSdkClientLike;

      // Start runPromise in background (maintains WS until stop/abort)
      this.runPromise = bot.start(signal).catch((e) => {
        const raw = e instanceof Error ? e.message : String(e);
        // If we are still connecting and ready not yet, reject ready
        if (this.state === "connecting") {
          try {
            const parsed = JSON.parse(raw) as { code?: string };
            if (parsed.code === "QQ_AUTH_FAILED") {
              readyReject(new Error(JSON.stringify({ code: "QQ_AUTH_FAILED", message: raw.slice(0, 300) })));
              return;
            }
          } catch {}
          if (raw.includes("401") || raw.includes("auth") || raw.includes("AppSecret")) {
            readyReject(new Error(JSON.stringify({ code: "QQ_AUTH_FAILED", message: raw.slice(0, 300) })));
          } else {
            readyReject(e);
          }
        } else {
          // After connected, errors are handled via onError
        }
      });

      // Wait for ready or timeout or auth error
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(JSON.stringify({ code: "QQ_GATEWAY_DISCONNECTED", message: "Gateway connect timeout" }))), this.startupTimeoutMs)
      );

      try {
        await Promise.race([readyPromise, timeoutPromise]);
      } catch (e) {
        // Cleanup on startup failure
        try {
          this.abortController?.abort();
        } catch {}
        try {
          bot.stop();
        } catch {}
        // Remove listeners
        try {
          if (bot.off) {
            bot.off("ready", onReady);
            bot.off("resumed", onResumed);
            bot.off("error", onError);
          }
        } catch {}
        this.runPromise = null;
        this.client = null;
        const raw = e instanceof Error ? e.message : String(e);
        let code = "QQ_GATEWAY_DISCONNECTED";
        let msg = raw.slice(0, 300);
        try {
          const parsed = JSON.parse(raw) as { code?: string; message?: string };
          if (parsed.code) {
            code = parsed.code;
            msg = parsed.message ?? msg;
          }
        } catch {
          if (raw.includes("QQ_AUTH_FAILED") || raw.includes("401") || raw.includes("auth")) code = "QQ_AUTH_FAILED";
          else if (raw.includes("rate")) code = "QQ_RATE_LIMITED";
          else if (raw.includes("timeout") || raw.includes("GATEWAY")) code = "QQ_GATEWAY_DISCONNECTED";
          else code = "QQ_NETWORK_ERROR";
        }
        this.setState("error", { code, message: msg });
        throw new Error(JSON.stringify({ code, message: msg }));
      }

      // Ready succeeded, state already connected via onReady
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      // If already set error state, just throw
      if (this.state === "error") throw e;
      let code = "QQ_NETWORK_ERROR";
      let msg = raw.slice(0, 300);
      try {
        const parsed = JSON.parse(raw) as { code?: string; message?: string };
        if (parsed.code) {
          code = parsed.code;
          msg = parsed.message ?? msg;
        }
      } catch {
        if (raw.includes("QQ_AUTH_FAILED") || raw.includes("401") || raw.includes("auth")) code = "QQ_AUTH_FAILED";
        else if (raw.includes("rate")) code = "QQ_RATE_LIMITED";
        else if (raw.includes("GATEWAY")) code = "QQ_GATEWAY_DISCONNECTED";
      }
      this.setState("error", { code, message: msg });
      throw new Error(JSON.stringify({ code, message: msg }));
    }
  }

  async stop(): Promise<void> {
    // Idempotent
    if (this.state === "disconnected" && !this.client && !this.runPromise) return;
    try {
      this.abortController?.abort();
    } catch {}
    try {
      this.client?.stop();
    } catch {}
    // Bounded await runPromise settle (2s)
    if (this.runPromise) {
      try {
        await Promise.race([
          this.runPromise.catch(() => {}),
          new Promise((res) => setTimeout(res, 2000)),
        ]);
      } catch {}
    }
    // Remove listeners if possible
    try {
      if (this.client && typeof (this.client as unknown as { off?: unknown }).off === "function") {
        // we don't have exact refs stored globally, but we can try to remove all
        // For now just clear client
      }
    } catch {}
    this.client = null;
    this.runPromise = null;
    this.abortController = null;
    this.setState("disconnected");
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
 * Fake transport for tests — simulates real lifecycle: start() does not resolve until stop/abort.
 * Emits ready after short delay, runPromise stays pending.
 */
export class FakeQQTransport {
  private events: QQTransportEvents;
  private state: QQTransportState = "disconnected";
  public emittedMessages: ChannelInboundMessage[] = [];
  private runPromise: Promise<void> | null = null;
  private runResolve: (() => void) | null = null;
  private abortController: AbortController | null = null;
  constructor(events: QQTransportEvents) {
    this.events = events;
  }
  async start(): Promise<void> {
    if (this.state === "connecting" || this.state === "connected") return;
    this.state = "connecting";
    this.events.onStateChange("connecting");
    this.abortController = new AbortController();
    // Simulate real SDK: start() stays pending until stop, ready emitted async
    let readyResolve: () => void;
    const readyPromise = new Promise<void>((res) => (readyResolve = res));
    this.runPromise = new Promise<void>((res) => (this.runResolve = res));
    // Emit ready after next tick
    setTimeout(() => {
      this.state = "connected";
      this.events.onStateChange("connected");
      readyResolve!();
    }, 10);
    // Wait for ready or abort
    await Promise.race([
      readyPromise,
      new Promise<void>((_, rej) => {
        if (this.abortController?.signal.aborted) rej(new Error("aborted"));
        this.abortController?.signal.addEventListener("abort", () => rej(new Error("aborted")));
      }),
    ]).catch(() => {});
    if (this.abortController?.signal.aborted) {
      this.state = "disconnected";
      throw new Error(JSON.stringify({ code: "QQ_GATEWAY_DISCONNECTED", message: "aborted" }));
    }
  }
  async stop(): Promise<void> {
    try {
      this.abortController?.abort();
    } catch {}
    if (this.runResolve) {
      this.runResolve();
      this.runResolve = null;
    }
    this.runPromise = null;
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
  // For auth failure test: start that rejects before ready
  static createAuthFailingTransport(events: QQTransportEvents): FakeQQTransport {
    const t = new FakeQQTransport(events);
    (t as unknown as { start: () => Promise<void> }).start = async () => {
      t["state"] = "connecting";
      events.onStateChange("connecting");
      await new Promise((_, rej) => setTimeout(() => rej(new Error(JSON.stringify({ code: "QQ_AUTH_FAILED", message: "auth failed" }))), 10));
    };
    return t;
  }
}
