// @vitest-environment jsdom
/**
 * P4 Sidecar — Computer Session Card 作为 Control Surface 的回归测试。
 *
 * 覆盖：active → Pause / Stop；paused → Resume / Stop；Stop 走 canonical
 * `classflow:computer:stop` 事件；计划进度 / 反思保留；**不复制 Agent Timeline**
 * （DOM 中不出现 worklog / tool row / Inline Approval —— 那些属于 Conversation 的 Agent Run）。
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { KiroComputerSessionCard } from "@/components/kiro/computer/KiroComputerSessionCard";
import { useDesktopSessionStore } from "@/store/useDesktopSessionStore";
import { FakeDesktopWorld, installFakeDesktopBridge } from "@/tests/helpers/fakeDesktopRuntime";

const SESSION = "cs-11111111-2222-3333-4444-555555555555";

if (!window.matchMedia) {
  (window as unknown as { matchMedia: unknown }).matchMedia = () =>
    ({
      matches: false,
      media: "",
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  delete (window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
  useDesktopSessionStore.getState().clear();
});

function applySession(state: "acting" | "paused" | "completed", overrides: Record<string, unknown> = {}) {
  useDesktopSessionStore.getState().applyEvent({
    type: "session",
    sessionId: SESSION,
    state,
    appName: "wechat",
    windowTitle: "微信",
    actionLabel: "click el-1",
    actions: 2,
    observations: 1,
    updatedAt: 10,
    goal: "发送报告",
    plan: ["打开微信", "找到文件传输助手", "发送文件"],
    stepIndex: 1,
    reflectionRequired: false,
    appProfile: { id: "im", label: "即时通讯", blocked: false },
    ...overrides,
  } as never);
}

async function renderCard() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<KiroComputerSessionCard />);
  });
}

describe("P4 Sidecar Session Card — Control Surface", () => {
  it("active：Pause / Stop 可用；计划进度保留；不复制 Agent Timeline", async () => {
    const world = new FakeDesktopWorld([]);
    installFakeDesktopBridge(world);
    applySession("acting");
    await renderCard();

    expect(document.querySelector('[data-testid="computer-session-pause"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="computer-session-stop"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="computer-session-resume"]')).toBeNull();
    expect(document.querySelector('[data-testid="computer-session-plan"]')!.textContent).toContain("第 2/3 步");
    // Control Surface 不是第二份 Worklog
    expect(document.querySelector('[data-testid="kiro-worklog"]')).toBeNull();
    expect(document.querySelector('[data-testid="kiro-tool-row"]')).toBeNull();
    expect(document.querySelector('[data-testid="kiro-inline-approval"]')).toBeNull();
  });

  it("paused：Resume / Stop 可用（Pause 消失）", async () => {
    const world = new FakeDesktopWorld([]);
    installFakeDesktopBridge(world);
    applySession("paused");
    await renderCard();

    expect(document.querySelector('[data-testid="computer-session-resume"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="computer-session-stop"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="computer-session-pause"]')).toBeNull();
    expect(document.querySelector('[data-testid="kiro-computer-session-card"]')!.textContent).toContain("已暂停");
  });

  it("Pause 点击 → bridge.pauseSession；Resume 点击 → bridge.resumeSession", async () => {
    const world = new FakeDesktopWorld([]);
    installFakeDesktopBridge(world);
    applySession("acting");
    await renderCard();

    await act(async () => {
      (document.querySelector('[data-testid="computer-session-pause"]') as HTMLButtonElement).click();
    });
    expect(world.pauseSession).toHaveBeenCalledWith({ sessionId: SESSION });

    applySession("paused");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      (document.querySelector('[data-testid="computer-session-resume"]') as HTMLButtonElement).click();
    });
    expect(world.resumeSession).toHaveBeenCalledWith({ sessionId: SESSION });
  });

  it("Stop 派发 canonical classflow:computer:stop 事件（由 useKiroChat 统一处理）", async () => {
    const world = new FakeDesktopWorld([]);
    installFakeDesktopBridge(world);
    applySession("acting");
    await renderCard();

    const received: Event[] = [];
    const handler = (event: Event) => received.push(event);
    window.addEventListener("classflow:computer:stop", handler);
    try {
      await act(async () => {
        (document.querySelector('[data-testid="computer-session-stop"]') as HTMLButtonElement).click();
      });
    } finally {
      window.removeEventListener("classflow:computer:stop", handler);
    }
    expect(received).toHaveLength(1);
    // Session Card 不直接 cancel session（canonical path 由 useKiroChat 负责）
    expect(world.cancelActions).not.toHaveBeenCalled();
  });
});
