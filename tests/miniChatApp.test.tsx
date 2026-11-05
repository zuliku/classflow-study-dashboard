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
import {
  MINI_MODE_ANIMATION_MS,
  type MiniChatSnapshot,
} from "@/lib/ai/miniChat/protocol";

const sendRemote = vi.fn(async () => ({ ok: true }));
const stopRemote = vi.fn();
const hide = vi.fn();
const setAlwaysOnTop = vi.fn();
const setMode = vi.fn();
const newChat = vi.fn();
const switchConversation = vi.fn();
const focusMain = vi.fn();
const resolveApproval = vi.fn();
let windowMode: "expanded" | "capsule" = "expanded";
let stateListener: ((s: unknown) => void) | null = null;

const SNAP: MiniChatSnapshot = {
  version: 2,
  conversationId: "c1",
  title: "测试对话",
  messages: [
    { id: "m1", role: "user", text: "你好" },
    { id: "m2", role: "assistant", text: "在的" },
  ],
  busy: false,
  streaming: false,
  phase: "idle",
  status: null,
  plan: null,
  activity: null,
  sources: [],
  approval: null,
  suggestions: ["今天要做什么", "这周还有什么 DDL", "总结当前对话"],
  conversations: [{ id: "c1", title: "测试对话", updatedAt: "2026-11-05T10:00:00.000Z" }],
  transitioning: false,
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
      setMode,
      getWindowState: async () => ({ mode: windowMode, onTop: true }),
      sendRemote,
      stopRemote,
      newChat,
      switchConversation,
      focusMain,
      resolveApproval,
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
      onRemoteNewChat: vi.fn(() => () => {}),
      onRemoteSwitchConversation: vi.fn(() => () => {}),
      onRemoteFocusConversation: vi.fn(() => () => {}),
      onRemoteApproval: vi.fn(() => () => {}),
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
  windowMode = "expanded";
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
    expect(container!.textContent).toContain("迷你窗仅在桌面端可用");
  });

  it("有消息时不再显示快捷 Prompt", async () => {
    await renderApp();
    expect(q('[data-testid="kiro-mini-suggestions"]')).toBeNull();
  });

  it("快捷 Prompt 点击直接发送（空会话）", async () => {
    await renderApp();
    await act(async () => {
      stateListener?.({ ...SNAP, messages: [] });
    });
    const chip = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent === "今天要做什么"
    );
    expect(chip).toBeTruthy();
    await act(async () => {
      chip!.click();
    });
    expect(sendRemote).toHaveBeenCalledTimes(1);
    const payload = sendRemote.mock.calls[0][0] as { text: string };
    expect(payload.text).toBe("今天要做什么");
  });

  it("低风险审批：允许一次直接走 resolveApproval；高风险只保留主窗口入口", async () => {
    await renderApp();
    await act(async () => {
      stateListener?.({
        ...SNAP,
        approval: {
          pending: true,
          id: "approval-1",
          title: "Kiro 准备修改",
          primary: "report.docx",
          highRisk: false,
          canApproveInMini: true,
        },
      });
    });
    const allow = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent === "允许一次"
    );
    expect(allow).toBeTruthy();
    await act(async () => {
      allow!.click();
    });
    expect(resolveApproval).toHaveBeenCalledWith("approval-1", "allow-once");

    await act(async () => {
      stateListener?.({
        ...SNAP,
        approval: {
          pending: true,
          id: "approval-2",
          title: "Kiro 准备删除",
          primary: "report.docx",
          highRisk: true,
          canApproveInMini: false,
        },
      });
    });
    const buttons = Array.from(container!.querySelectorAll("button")).map((b) => b.textContent);
    expect(buttons).not.toContain("允许一次");
    expect(buttons).toContain("主窗口处理");
  });

  it("错误状态显示错误卡并可回主窗口", async () => {
    await renderApp();
    await act(async () => {
      stateListener?.({ ...SNAP, phase: "error", status: { label: "出错了" }, busy: false });
    });
    const error = q('[data-testid="kiro-mini-error"]');
    expect(error).toBeTruthy();
    expect(error!.textContent).toContain("本轮回答失败");
    const viewMain = Array.from(error!.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("主窗口查看")
    );
    expect(viewMain).toBeTruthy();
    await act(async () => {
      viewMain!.click();
    });
    expect(focusMain).toHaveBeenCalledWith("c1");
  });

  it("审批卡显示剩余时间", async () => {
    await renderApp();
    await act(async () => {
      stateListener?.({
        ...SNAP,
        phase: "waiting-approval",
        busy: true,
        approval: {
          pending: true,
          id: "approval-deadline",
          title: "Kiro 准备修改",
          primary: "report.docx",
          canApproveInMini: true,
          deadlineAt: Date.now() + 90_000,
        },
      });
    });
    const countdown = q('[data-testid="kiro-mini-approval-countdown"]');
    expect(countdown).toBeTruthy();
    expect(countdown!.textContent).toContain("剩余");
  });

  it("会话菜单：打开聚焦首项，方向键移动，Esc 关闭并回到触发按钮", async () => {
    await renderApp();
    const trigger = q('[aria-label="切换对话"]') as HTMLButtonElement;
    await act(async () => {
      trigger.click();
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(document.activeElement?.textContent).toContain("主窗口");
    await act(async () => {
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
      );
    });
    expect(document.activeElement?.textContent).toContain("新对话");
    await act(async () => {
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(q('[data-testid="kiro-mini-conversation-menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("胶囊模式：展开先进入轻量 morph 层，动画后再挂载聊天界面", async () => {
    windowMode = "capsule";
    await renderApp();
    expect(q('[data-testid="kiro-mini-capsule"]')).toBeTruthy();
    const expand = q('[aria-label="展开 Kiro Mini"]') as HTMLButtonElement;
    await act(async () => {
      expand.click();
    });
    expect(setMode).toHaveBeenCalledWith("expanded", false);
    // 窗口 resize 期间只有轻量 morph 层，不重排完整聊天界面
    expect(q('[data-testid="kiro-mini-morph"]')).toBeTruthy();
    expect(q('[data-testid="kiro-mini-app"]')).toBeNull();
    await act(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, MINI_MODE_ANIMATION_MS.expanded + 80)
      );
    });
    expect(q('[data-testid="kiro-mini-app"]')).toBeTruthy();
  });

  it("收起：先进入 morph 层，动画结束后落到胶囊", async () => {
    await renderApp();
    const collapse = q('[aria-label="收起迷你窗"]') as HTMLButtonElement;
    await act(async () => {
      collapse.click();
    });
    expect(setMode).toHaveBeenCalledWith("capsule", false);
    expect(q('[data-testid="kiro-mini-morph"]')).toBeTruthy();
    expect(q('[data-testid="kiro-mini-app"]')).toBeNull();
    await act(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, MINI_MODE_ANIMATION_MS.capsule + 80)
      );
    });
    expect(q('[data-testid="kiro-mini-capsule"]')).toBeTruthy();
  });
});

