// @vitest-environment jsdom
/**
 * Kiro Mini App（瘦客户端 UI）：
 * - 快照订阅渲染消息；文本发送经 sendRemote；文件拖入/选择进入待发送 tray；
 * - busy 时发送禁用 + Stop 可见；无 bridge 时 fallback。
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MiniChatApp } from "@/components/kiro/mini/MiniChatApp";
import type { MiniChatSnapshot } from "@/lib/ai/miniChat/protocol";

const sendRemote = vi.fn(async () => ({ ok: true }));
const stopRemote = vi.fn();
const hide = vi.fn();
const setAlwaysOnTop = vi.fn();
let stateListener: ((s: unknown) => void) | null = null;

const SNAP: MiniChatSnapshot = {
  version: 1,
  conversationId: "c1",
  messages: [
    { id: "m1", role: "user", text: "你好" },
    { id: "m2", role: "assistant", text: "在的" },
  ],
  busy: false,
  streaming: false,
  attachments: [],
  configured: true,
  updatedAt: 1,
};

function installBridge(snapshot: MiniChatSnapshot | null = SNAP) {
  (window as unknown as { classflowDesktop?: unknown }).classflowDesktop = {
    version: 1,
    platform: "windows",
    filesystem: {
      pickDirectory: vi.fn(),
      getGrantStatus: vi.fn(),
      forgetGrant: vi.fn(),
      list: vi.fn(),
      stat: vi.fn(),
      readText: vi.fn(),
      readBytes: vi.fn(),
      readTextPrefix: vi.fn(),
      createDirectory: vi.fn(),
      writeText: vi.fn(),
      writeBytes: vi.fn(),
      remove: vi.fn(),
      move: vi.fn(),
    },
    mini: {
      show: vi.fn(),
      hide,
      toggle: vi.fn(),
      setAlwaysOnTop,
      isAlwaysOnTop: async () => ({ onTop: true }),
      sendRemote,
      stopRemote,
      publishState: vi.fn(),
      getState: async () => snapshot,
      onState: (cb: (s: unknown) => void) => {
        stateListener = cb;
        return () => {
          stateListener = null;
        };
      },
      onRemoteSend: vi.fn(() => () => {}),
      completeRemoteSend: vi.fn(),
      onRemoteStop: vi.fn(() => () => {}),
    },
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderApp() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<MiniChatApp />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function q(sel: string): HTMLElement | null {
  return container!.querySelector(sel);
}

beforeEach(() => {
  vi.clearAllMocks();
  stateListener = null;
  installBridge();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  delete (window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
});

describe("MiniChatApp", () => {
  it("渲染快照消息 + 头部拖动区", async () => {
    await renderApp();
    expect(q('[data-testid="kiro-mini-app"]')).toBeTruthy();
    expect(q('[data-testid="kiro-mini-header"]')?.className).toContain("mini-drag-region");
    expect(container!.textContent).toContain("你好");
    expect(container!.textContent).toContain("在的");
  });

  it("文本发送经 sendRemote；成功后清空输入", async () => {
    await renderApp();
    const ta = q('[aria-label="迷你窗输入"]') as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(ta, "帮我看看");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (q('[aria-label="发送"]') as HTMLButtonElement).click();
    });
    expect(sendRemote).toHaveBeenCalledTimes(1);
    const payload = sendRemote.mock.calls[0][0] as { text: string; files: unknown[]; requestId: string };
    expect(payload.text).toBe("帮我看看");
    expect(payload.files).toEqual([]);
    expect(typeof payload.requestId).toBe("string");
    await act(async () => {
      await Promise.resolve();
    });
    expect((q('[aria-label="迷你窗输入"]') as HTMLTextAreaElement).value).toBe("");
  });

  it("busy 时发送禁用、Stop 可见；快照推送更新消息", async () => {
    await renderApp();
    await act(async () => {
      stateListener?.({ ...SNAP, busy: true, streaming: true, updatedAt: 2 });
    });
    expect((q('[aria-label="发送"]') as HTMLButtonElement | null)).toBeNull();
    expect(q('[aria-label="停止"]')).toBeTruthy();
    await act(async () => {
      (q('[aria-label="停止"]') as HTMLButtonElement).click();
    });
    expect(stopRemote).toHaveBeenCalledTimes(1);
    await act(async () => {
      stateListener?.({
        ...SNAP,
        messages: [...SNAP.messages, { id: "m3", role: "assistant" as const, text: "新回复" }],
        busy: false,
        updatedAt: 3,
      });
    });
    expect(container!.textContent).toContain("新回复");
  });

  it("文件拖入进入待发送 tray", async () => {
    await renderApp();
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    await act(async () => {
      const drop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", { value: { files: [file] } });
      q('[data-testid="kiro-mini-app"]')!.dispatchEvent(drop);
    });
    expect(q('[data-testid="kiro-mini-files"]')?.textContent).toContain("notes.txt");
  });

  it("无 bridge 时 fallback（不白屏）", async () => {
    delete (window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
    await renderApp();
    expect(container!.textContent).toContain("仅在 ClassFlow 桌面端可用");
  });
});
