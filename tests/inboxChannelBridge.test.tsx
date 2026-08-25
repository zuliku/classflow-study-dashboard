// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, cleanup, act } from "@testing-library/react";
import { useInboxChannelBridge } from "@/hooks/useInboxChannelBridge";
import { useInboxStore } from "@/store/useInboxStore";

/**
 * Inbox Channel Bridge contract (Task 14B reliable queue):
 * - Main publishes ALL channel sources (qq-bot / gmail / qq-mail)
 * - Renderer bridge MUST ingest every valid source into useInboxStore, then ACK
 * - addItem throw → NO ack (redelivery on next rendererReady)
 * - duplicate delivery → store dedupe + still ACK (consumed)
 * - unknown source → explicit bounded handling (poison-ack), no crash
 *
 * BUG regression: historical bridge ACKed-and-dropped every non-"qq-bot"
 * payload → Gmail / QQ Mail messages silently lost.
 */

interface FakeBridge {
  handler: ((envelope: unknown) => void) | null;
  acks: string[];
  readyCalls: number;
}

let fake: FakeBridge;

function installFakeBridge() {
  fake = { handler: null, acks: [], readyCalls: 0 };
  (window as unknown as Record<string, unknown>).classflowDesktop = {
    inbox: {
      subscribeExternalItem: (cb: (envelope: unknown) => void) => {
        fake.handler = cb;
        return () => {
          fake.handler = null;
        };
      },
      rendererReady: () => {
        fake.readyCalls += 1;
        return Promise.resolve();
      },
      ack: (id: string) => {
        fake.acks.push(id);
        return Promise.resolve();
      },
    },
  };
}

function deliver(envelope: unknown) {
  act(() => {
    fake.handler?.(envelope);
  });
}

function makeEnvelope(source: string, overrides: Record<string, unknown> = {}) {
  return {
    deliveryId: `dlv-${source}`,
    payload: {
      source,
      externalMessageId: `ext-${source}`,
      conversationId: `conv-${source}`,
      senderDisplay: "发送者",
      subject: "主题",
      text: `hello from ${source}`,
      receivedAt: 1700000000000,
      attachments: [],
      sourceAccountId: "acc-1",
      ...overrides,
    },
  };
}

describe("useInboxChannelBridge — unified source contract", () => {
  beforeEach(() => {
    cleanup();
    installFakeBridge();
    act(() => {
      useInboxStore.setState({ items: [] });
    });
  });
  afterEach(() => {
    cleanup();
    delete (window as unknown as Record<string, unknown>).classflowDesktop;
  });

  function mountHook(): boolean {
    function Host() {
      useInboxChannelBridge();
      return null;
    }
    render(<Host />);
    return fake.handler !== null;
  }

  it("qq-bot delivery → addItem → ACK", () => {
    expect(mountHook()).toBe(true);
    deliver(makeEnvelope("qq-bot"));

    const items = useInboxStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("qq-bot");
    expect(items[0].text).toBe("hello from qq-bot");
    expect(items[0].origin).toBe("remote-channel");
    expect(fake.acks).toEqual(["dlv-qq-bot"]);
  });

  it("gmail delivery → addItem → ACK（历史 bug：被 ACK 且丢弃）", () => {
    expect(mountHook()).toBe(true);
    deliver(makeEnvelope("gmail"));

    const items = useInboxStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("gmail");
    expect(fake.acks).toEqual(["dlv-gmail"]);
  });

  it("qq-mail delivery → addItem → ACK（历史 bug：被 ACK 且丢弃）", () => {
    expect(mountHook()).toBe(true);
    deliver(makeEnvelope("qq-mail"));

    const items = useInboxStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("qq-mail");
    expect(fake.acks).toEqual(["dlv-qq-mail"]);
  });

  it("addItem throws → 不 ACK（下次 rendererReady 重投）", () => {
    expect(mountHook()).toBe(true);
    const realAdd = useInboxStore.getState().addItem;
    act(() => {
      useInboxStore.setState({
        addItem: () => {
          throw new Error("storage boom");
        },
      });
    });

    expect(() => deliver(makeEnvelope("gmail"))).not.toThrow();
    expect(fake.acks).toEqual([]);

    act(() => {
      useInboxStore.setState({ addItem: realAdd });
    });
  });

  it("duplicate delivery → dedupe（仍 1 条）且再次 ACK", () => {
    expect(mountHook()).toBe(true);
    deliver(makeEnvelope("gmail"));
    deliver(makeEnvelope("gmail"));

    expect(useInboxStore.getState().items).toHaveLength(1);
    expect(fake.acks).toEqual(["dlv-gmail", "dlv-gmail"]);
  });

  it("unknown source → 明确处理：不 ingest、不 crash、poison-ACK 防止队列无限重投", () => {
    expect(mountHook()).toBe(true);
    expect(() => deliver(makeEnvelope("discord"))).not.toThrow();

    expect(useInboxStore.getState().items).toHaveLength(0);
    expect(fake.acks).toEqual(["dlv-discord"]);
  });

  it("非对象 payload → 不 crash、不 ingest、poison-ACK", () => {
    expect(mountHook()).toBe(true);
    expect(() => deliver(null)).not.toThrow();
    expect(() => deliver(42)).not.toThrow();

    expect(useInboxStore.getState().items).toHaveLength(0);
  });
});
