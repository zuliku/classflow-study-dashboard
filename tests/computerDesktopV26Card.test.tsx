// @vitest-environment jsdom
/**
 * V2.6 组件测试：KiroComputerSessionCard 的「保存为 Skill」按钮
 * （session completed → buildSkillDraft → SkillDistillDialog 预生成草稿模式）。
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { KiroComputerSessionCard } from "@/components/kiro/computer/KiroComputerSessionCard";
import { useDesktopSessionStore } from "@/store/useDesktopSessionStore";
import {
  FakeDesktopWorld,
  installFakeDesktopBridge,
} from "@/tests/helpers/fakeDesktopRuntime";

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

async function renderCard() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<KiroComputerSessionCard />);
  });
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  delete (window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
  useDesktopSessionStore.getState().clear();
});

describe("V2.6 Sidecar — 保存为 Skill", () => {
  it("completed session 显示按钮，点击后打开预生成草稿对话框", async () => {
    const world = new FakeDesktopWorld([
      {
        windowId: "win-wechat",
        title: "微信",
        appName: "wechat",
        elements: [
          { elementId: "el-1", role: "Button", name: "发送", bounds: { x: 1, y: 1, width: 10, height: 10 } },
        ],
      },
    ]);
    installFakeDesktopBridge(world);
    world.trajectory.push(
      { index: 0, action: "click", targetLabel: "Button「发送」", risk: "normal", verificationPassed: true, at: 1 },
      { index: 1, action: "type", targetLabel: "Edit「输入」", risk: "normal", verificationPassed: true, at: 2 },
      { index: 2, action: "click", targetLabel: "Button「发送」", risk: "external", verificationPassed: true, at: 3 }
    );

    useDesktopSessionStore.getState().applyEvent({
      type: "session",
      sessionId: SESSION,
      state: "completed",
      appName: "wechat",
      windowTitle: "微信",
      actionLabel: "click el-1",
      actions: 3,
      observations: 2,
      updatedAt: 10,
      goal: "发送报告",
      plan: [],
      stepIndex: 0,
      reflectionRequired: false,
      appProfile: { id: "im", label: "即时通讯", blocked: false },
    });

    await renderCard();
    // 等待 buildSkillDraft 异步返回
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const button = document.querySelector('[data-testid="computer-session-save-skill"]');
    expect(button).toBeTruthy();

    await act(async () => {
      (button as HTMLButtonElement).click();
    });

    const nameInput = document.querySelector('[data-testid="skill-distill-name"]') as HTMLInputElement | null;
    expect(nameInput?.value.startsWith("desktop-")).toBe(true);
    expect(world.buildSkillDraft).toHaveBeenCalledWith({ sessionId: SESSION });
  });

  it("轨迹不足（buildSkillDraft 拒绝）→ 不显示按钮", async () => {
    const world = new FakeDesktopWorld([
      {
        windowId: "win-wechat",
        title: "微信",
        appName: "wechat",
        elements: [
          { elementId: "el-1", role: "Button", name: "发送", bounds: { x: 1, y: 1, width: 10, height: 10 } },
        ],
      },
    ]);
    installFakeDesktopBridge(world);
    useDesktopSessionStore.getState().applyEvent({
      type: "session",
      sessionId: SESSION,
      state: "completed",
      appName: "wechat",
      windowTitle: "微信",
      actionLabel: null,
      actions: 1,
      observations: 1,
      updatedAt: 10,
      goal: null,
      plan: [],
      stepIndex: 0,
      reflectionRequired: false,
      appProfile: null,
    });

    await renderCard();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.querySelector('[data-testid="computer-session-save-skill"]')).toBeNull();
  });
});
