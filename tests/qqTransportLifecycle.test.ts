import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeQQTransport } from "@/src/main/channels/qq/transport";
import type { ChannelInboundMessage } from "@/src/main/channels/types";

const mockState = vi.hoisted(() => ({
  lastBot: null as unknown as MockQQBot | null,
  filterOpts: null as unknown,
  bots: [] as MockQQBot[],
}));

class MockQQBot {
  handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  startSignal: AbortSignal | null = null;
  startPromise: Promise<void> | null = null;
  startResolve: (() => void) | null = null;
  stopCalled = 0;
  offCalled: Array<{ event: string; handler: unknown }> = [];
  constructor(_opts: unknown) {
    mockState.lastBot = this as unknown as MockQQBot;
    mockState.bots.push(this as unknown as MockQQBot);
  }
  on(event: string, handler: (...args: unknown[]) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event)!.push(handler);
  }
  off(event: string, handler: (...args: unknown[]) => void) {
    this.offCalled.push({ event, handler });
    const arr = this.handlers.get(event);
    if (arr) {
      const idx = arr.indexOf(handler);
      if (idx >= 0) arr.splice(idx, 1);
    }
  }
  use(middleware: unknown) {
    mockState.filterOpts = middleware;
  }
  async start(signal?: AbortSignal): Promise<void> {
    this.startSignal = signal ?? null;
    this.startPromise = new Promise<void>((resolve, reject) => {
      this.startResolve = resolve;
      if (signal) {
        signal.addEventListener("abort", () => resolve());
      }
    });
    return this.startPromise;
  }
  stop() {
    this.stopCalled++;
    if (this.startResolve) {
      this.startResolve();
      this.startResolve = null;
    }
  }
  emit(event: string, ...args: unknown[]) {
    const arr = this.handlers.get(event);
    if (arr) {
      for (const h of [...arr]) h(...args);
    }
  }
}

vi.mock("@tencent-connect/qqbot-nodejs", () => {
  return {
    QQBot: MockQQBot as unknown as new (opts: unknown) => unknown,
    messageFilter: (opts: unknown) => {
      mockState.filterOpts = opts;
      return opts;
    },
  };
});

// Need to import after mock
import { QQWebSocketTransport } from "@/src/main/channels/qq/transport";

describe("qqTransportLifecycle", () => {
  beforeEach(() => {
    mockState.lastBot = null;
    mockState.filterOpts = null;
    mockState.bots = [];
    vi.useRealTimers();
  });

  it("Fake start simulates real SDK: start() stays pending until stop, ready resolves", async () => {
    const events: string[] = [];
    const transport = new FakeQQTransport({
      onMessage: async () => {},
      onStateChange: (s) => events.push(s),
    });
    const startPromise = transport.start();
    await Promise.race([
      startPromise,
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 500)),
    ]);
    expect(events).toContain("connecting");
    expect(events).toContain("connected");
    expect(transport.getState()).toBe("connected");
    await transport.stop();
    expect(transport.getState()).toBe("disconnected");
  });

  it("stop settles runPromise bounded", async () => {
    const transport = new FakeQQTransport({ onMessage: async () => {}, onStateChange: () => {} });
    await transport.start();
    const stopStart = Date.now();
    await transport.stop();
    expect(Date.now() - stopStart).toBeLessThan(500);
    expect(transport.getState()).toBe("disconnected");
  });

  it("auth failure before ready rejects with QQ_AUTH_FAILED", async () => {
    const events: Array<{ state: string; err?: unknown }> = [];
    const transport = FakeQQTransport.createAuthFailingTransport({
      onMessage: async () => {},
      onStateChange: (s, err) => events.push({ state: s, err }),
    });
    await expect(transport.start()).rejects.toThrow(/QQ_AUTH_FAILED/);
  });

  it("Real transport: start waits for ready, not SDK lifecycle", async () => {
    const config = { id: "qq_test", appId: "123", credentialRef: "cred_1", enabled: true, displayName: "Bot", requireMentionInGroup: true, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true } as never;
    const transport = new QQWebSocketTransport(config, "secret", {
      onMessage: async () => {},
      onStateChange: () => {},
    });
    const startPromise = transport.start();
    // Wait a tick for bot to be created
    await new Promise((r) => setTimeout(r, 10));
    const bot = mockState.lastBot;
    expect(bot).not.toBeNull();
    expect(bot!.startPromise).not.toBeNull();
    expect(transport.getState()).toBe("connecting");
    bot!.emit("ready");
    await expect(startPromise).resolves.toBeUndefined();
    expect(transport.getState()).toBe("connected");
    expect(bot!.startResolve).not.toBeNull(); // still pending
    await transport.stop();
    expect(transport.getState()).toBe("disconnected");
    expect(bot!.stopCalled).toBe(1);
  });

  it("Real transport stop cleans up AbortSignal, off listeners, secret", async () => {
    const config = { id: "qq_test", appId: "123", credentialRef: "cred_1", enabled: true, displayName: "Bot", requireMentionInGroup: true, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true } as never;
    const transport = new QQWebSocketTransport(config, "secret123", {
      onMessage: async () => {},
      onStateChange: () => {},
    });
    const p = transport.start();
    await new Promise((r) => setTimeout(r, 10));
    const bot = mockState.lastBot!;
    bot.emit("ready");
    await p;
    expect(transport.getState()).toBe("connected");
    const signal = bot.startSignal;
    expect(signal?.aborted).toBe(false);
    await transport.stop();
    expect(signal?.aborted).toBe(true);
    expect(bot.stopCalled).toBe(1);
    expect(bot.offCalled.length).toBeGreaterThanOrEqual(4);
    expect(bot.offCalled.map((c) => c.event)).toEqual(expect.arrayContaining(["ready", "resumed", "error", "message"]));
    expect(transport.getState()).toBe("disconnected");
    expect((transport as unknown as { appSecret: string }).appSecret).toBe("");
  });

  it("Real transport startup auth error rejects fast with QQ_AUTH_FAILED", async () => {
    const config = { id: "qq_test", appId: "123", credentialRef: "cred_1", enabled: true, displayName: "Bot", requireMentionInGroup: true, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true } as never;
    const transport = new QQWebSocketTransport(config, "secret", {
      onMessage: async () => {},
      onStateChange: () => {},
    });
    const startPromise = transport.start();
    await new Promise((r) => setTimeout(r, 10));
    const bot = mockState.lastBot!;
    bot.emit("error", new Error("HTTP 401 Unauthorized"));
    await expect(startPromise).rejects.toThrow(/QQ_AUTH_FAILED/);
    expect(transport.getState()).toBe("error");
  });

  it("Real transport startup timeout 15s -> QQ_GATEWAY_DISCONNECTED", async () => {
    vi.useFakeTimers();
    const config = { id: "qq_test", appId: "123", credentialRef: "cred_1", enabled: true, displayName: "Bot", requireMentionInGroup: true, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true } as never;
    const transport = new QQWebSocketTransport(config, "secret", {
      onMessage: async () => {},
      onStateChange: () => {},
    });
    const startPromise = transport.start();
    await vi.advanceTimersByTimeAsync(0);
    const promise = expect(startPromise).rejects.toThrow(/QQ_GATEWAY_DISCONNECTED/);
    await vi.advanceTimersByTimeAsync(15_001);
    await promise;
    expect(transport.getState()).toBe("error");
    vi.useRealTimers();
    await transport.stop().catch(() => {});
  });

  it("Timer leak: ready success clears startup timeout, advance 20s still connected", async () => {
    vi.useFakeTimers();
    const config = { id: "qq_test", appId: "123", credentialRef: "cred_1", enabled: true, displayName: "Bot", requireMentionInGroup: true, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true } as never;
    const transport = new QQWebSocketTransport(config, "secret", {
      onMessage: async () => {},
      onStateChange: () => {},
    });
    const p = transport.start();
    await vi.advanceTimersByTimeAsync(10);
    const bot = mockState.lastBot!;
    bot.emit("ready");
    await vi.advanceTimersByTimeAsync(0);
    await expect(p).resolves.toBeUndefined();
    expect(transport.getState()).toBe("connected");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(transport.getState()).toBe("connected");
    vi.useRealTimers();
    await transport.stop();
  });

  it("messageFilter contract skipSelfEcho:true dedup:false", async () => {
    const config = { id: "qq_test", appId: "123", credentialRef: "cred_1", enabled: true, displayName: "Bot", requireMentionInGroup: true, allowedUsers: [], allowedGroups: [], receiveDirectMessages: true, receiveGroupMessages: true } as never;
    const transport = new QQWebSocketTransport(config, "secret", {
      onMessage: async () => {},
      onStateChange: () => {},
    });
    const p = transport.start();
    await new Promise((r) => setTimeout(r, 10));
    const bot = mockState.lastBot!;
    bot.emit("ready");
    await p;
    expect(mockState.filterOpts).toEqual({ skipSelfEcho: true, dedup: false });
    await transport.stop();
  });
});
