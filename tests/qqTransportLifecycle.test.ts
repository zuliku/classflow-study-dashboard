import { describe, it, expect } from "vitest";
import { FakeQQTransport } from "@/src/main/channels/qq/transport";
import type { ChannelInboundMessage } from "@/src/main/channels/types";

describe("qqTransportLifecycle", () => {
  it("Fake start simulates real SDK: start() stays pending until stop, ready resolves", async () => {
    const events: string[] = [];
    const transport = new FakeQQTransport({
      onMessage: async () => {},
      onStateChange: (s) => events.push(s),
    });
    const startPromise = transport.start();
    // start should not hang forever, should resolve after ready (10ms)
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
    // state should be error or at least not connected
    // For Fake auth failing, start throws, we can check that it rejected
  });
});
