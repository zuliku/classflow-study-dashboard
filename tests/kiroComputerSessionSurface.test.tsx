// @vitest-environment jsdom
/**
 * P5 — Computer Session Surface（Workspace / Sidecar 共用）组件测试（§55/§56）。
 *
 * 覆盖：只在真实 session 存在时显示；状态文案 / tone；控制可用性（approval-required 无 Pause、
 * paused 仅 Resume+Stop、terminal 无控制）；canonical Pause / Resume / Stop；pending 防重复点击；
 * 失败只显示 sanitized Toast；Surface 不复制 Worklog / 不新增 Approval 按钮；terminal dismiss。
 */
import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { KiroComputerSessionSurface } from "@/components/kiro/computer/session/KiroComputerSessionSurface";
import { useDesktopSessionStore } from "@/store/useDesktopSessionStore";
import { useDesktopSessionPreviewStore } from "@/store/useDesktopSessionPreviewStore";
import { useToastStore } from "@/store/useToastStore";
import { FakeDesktopWorld, installFakeDesktopBridge } from "@/tests/helpers/fakeDesktopRuntime";
import type { DesktopControlSessionState } from "@/lib/desktop/types";

const SESSION = "cs-11111111-2222-3333-4444-555555555555";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  useDesktopSessionStore.getState().clear();
  useDesktopSessionPreviewStore.getState().clearPreview();
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  delete (window as unknown as { classflowDesktop?: unknown }).classflowDesktop;
  useDesktopSessionStore.getState().clear();
  useDesktopSessionPreviewStore.getState().clearPreview();
});

function seedSession(state: DesktopControlSessionState, overrides: Record<string, unknown> = {}) {
  useDesktopSessionStore.getState().applyEvent({
    type: "session",
    sessionId: SESSION,
    state,
    appName: "wechat",
    windowTitle: "文件传输助手",
    actionLabel: "click el-1",
    actions: 2,
    observations: 1,
    updatedAt: 10,
    goal: "发送报告",
    plan: ["打开微信", "找到文件传输助手", "发送文件", "验证"],
    stepIndex: 1,
    reflectionRequired: false,
    appProfile: { id: "im", label: "微信", blocked: false },
    ...overrides,
  } as never);
}

async function renderSurface(variant: "workspace" | "sidecar" = "workspace") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<KiroComputerSessionSurface variant={variant} />);
  });
}

function q(selector: string): HTMLElement | null {
  return container!.querySelector(selector) as HTMLElement | null;
}

describe("P5 Surface — 显示条件与文案", () => {
  it("没有 sessionId → 完全不渲染（Computer 开关 ≠ Desktop Session）", async () => {
    await renderSurface();
    expect(q('[data-testid="kiro-computer-session-surface"]')).toBeNull();
  });

  it("后台执行徽标：backgroundActive → 常驻显示；关闭/clear 后消失", async () => {
    seedSession("acting");
    useDesktopSessionStore.getState().setBackgroundActive(true);
    await renderSurface();
    expect(q('[data-testid="computer-session-background"]')).toBeTruthy();
    expect(q('[data-testid="computer-session-background"]')!.textContent).toContain("后台执行中");
    useDesktopSessionStore.getState().setBackgroundActive(false);
    await renderSurface();
    expect(q('[data-testid="computer-session-background"]')).toBeNull();
    useDesktopSessionStore.getState().clear();
    expect(useDesktopSessionStore.getState().backgroundActive).toBe(false);
  });

  it("Workspace / Sidecar 两个 variant 渲染同一个 Surface（不重复 mount 两份 UI）", async () => {
    seedSession("observing");
    await renderSurface("workspace");
    expect(q('[data-testid="kiro-computer-session-surface"]')).toBeTruthy();
    await renderSurface("sidecar");
    expect(container!.querySelectorAll('[data-testid="kiro-computer-session-surface"]').length).toBe(1);
  });

  it("observing / acting / approval-required / paused / completed 文案正确", async () => {
    seedSession("observing");
    await renderSurface();
    expect(q('[data-testid="kiro-computer-session-header"]')!.textContent).toContain("正在查看 微信");
    expect(q('[data-testid="kiro-computer-session-header"]')!.getAttribute("data-tone")).toBe("active");

    seedSession("acting");
    await renderSurface();
    expect(q('[data-testid="kiro-computer-session-header"]')!.textContent).toContain("正在点击 · 微信");

    seedSession("approval-required");
    await renderSurface();
    expect(q('[data-testid="kiro-computer-session-header"]')!.textContent).toContain("等待你的确认");
    expect(q('[data-testid="kiro-computer-session-header"]')!.getAttribute("data-tone")).toBe("warning");

    seedSession("paused");
    await renderSurface();
    expect(q('[data-testid="kiro-computer-session-header"]')!.textContent).toContain("已暂停");
    expect(q('[data-testid="kiro-computer-session-header"]')!.getAttribute("data-tone")).toBe("muted");

    seedSession("completed");
    await renderSurface();
    expect(q('[data-testid="kiro-computer-session-header"]')!.textContent).toContain("电脑操作已完成");
    expect(q('[data-testid="kiro-computer-session-header"]')!.getAttribute("data-tone")).toBe("success");
  });

  it("failed → danger tone + sanitized failureReason；cancelled → neutral（不是错误）", async () => {
    seedSession("failed", { failureReason: "已达到本会话操作次数上限" });
    await renderSurface();
    const header = q('[data-testid="kiro-computer-session-header"]')!;
    expect(header.textContent).toContain("电脑操作已停止");
    expect(header.getAttribute("data-tone")).toBe("danger");
    expect(q('[data-testid="computer-session-failure"]')!.textContent).toBe("已达到本会话操作次数上限");

    seedSession("cancelled");
    await renderSurface();
    expect(q('[data-testid="kiro-computer-session-header"]')!.textContent).toContain("已停止");
    expect(q('[data-testid="kiro-computer-session-header"]')!.getAttribute("data-tone")).toBe("neutral");
  });

  it("受保护应用 → 受保护应用 badge（danger）", async () => {
    seedSession("observing", { appProfile: { id: "bank", label: "银行", blocked: true } });
    await renderSurface();
    expect(q('[data-testid="computer-session-profile-blocked"]')!.textContent).toBe("受保护应用");
  });

  it("reflection → 正在调整策略（warning；不显示内部计数）", async () => {
    seedSession("acting", { reflectionRequired: true });
    await renderSurface();
    const reflection = q('[data-testid="computer-session-reflection"]')!;
    expect(reflection.textContent).toBe("正在调整策略");
    expect(container!.textContent).not.toContain("失败");
    expect(container!.textContent).not.toContain("no-progress");
  });

  it("进度：第 N/M 步 + 当前步骤（不展开完整 Plan）", async () => {
    seedSession("acting");
    await renderSurface();
    const progress = q('[data-testid="computer-session-plan"]')!;
    expect(progress.textContent).toContain("第 2/4 步");
    expect(progress.textContent).toContain("找到文件传输助手");
    expect(container!.textContent).not.toContain("验证");
  });

  it("Surface 不复制 Agent Timeline / Changes（无 worklog / tool row / result）", async () => {
    seedSession("acting");
    await renderSurface();
    expect(q('[data-testid="kiro-worklog"]')).toBeNull();
    expect(q('[data-testid="kiro-tool-row"]')).toBeNull();
    expect(q('[data-testid="kiro-agent-run-result"]')).toBeNull();
    expect(q('[data-testid="kiro-inline-approval"]')).toBeNull();
    expect(q('[data-testid="kiro-approval-dialog"]')).toBeNull();
  });

  it("approval-required 不重复显示 Approval 决策按钮", async () => {
    seedSession("approval-required");
    await renderSurface();
    expect(container!.querySelectorAll('[data-testid^="approval-"]').length).toBe(0);
  });
});

describe("P5 Surface — Controls（canonical path）", () => {
  it("Pause → bridge.pauseSession；Resume → bridge.resumeSession", async () => {
    const world = new FakeDesktopWorld([]);
    installFakeDesktopBridge(world);
    seedSession("acting");
    await renderSurface();

    await act(async () => {
      q('[data-testid="computer-session-pause"]')!.click();
    });
    expect(world.pauseSession).toHaveBeenCalledWith({ sessionId: SESSION });

    seedSession("paused");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      q('[data-testid="computer-session-resume"]')!.click();
    });
    expect(world.resumeSession).toHaveBeenCalledWith({ sessionId: SESSION });
  });

  it("Stop → canonical classflow:computer:stop 事件（不自行取消 session）", async () => {
    const world = new FakeDesktopWorld([]);
    installFakeDesktopBridge(world);
    seedSession("acting");
    await renderSurface();

    const received: Event[] = [];
    const handler = (event: Event) => received.push(event);
    window.addEventListener("classflow:computer:stop", handler);
    try {
      await act(async () => {
        q('[data-testid="computer-session-stop"]')!.click();
      });
    } finally {
      window.removeEventListener("classflow:computer:stop", handler);
    }
    expect(received).toHaveLength(1);
    expect(world.cancelActions).not.toHaveBeenCalled();
  });

  it("action pending 防重复点击（Pause in-flight 时按钮 disabled，第二次点击不触发）", async () => {
    const world = new FakeDesktopWorld([]);
    let release: (() => void) | null = null;
    world.pauseSession = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              sessionId: SESSION,
              state: "paused",
              createdAt: 0,
              updatedAt: 0,
              elapsedMs: 0,
              actions: 0,
              observations: 0,
              remainingActions: 30,
              appName: null,
              windowTitle: null,
              actionLabel: null,
              failureReason: null,
              goal: null,
              plan: [],
              stepIndex: 0,
              reflectionRequired: false,
              appProfile: null,
            });
        })
    ) as unknown as FakeDesktopWorld["pauseSession"];
    installFakeDesktopBridge(world);
    seedSession("acting");
    await renderSurface();

    await act(async () => {
      q('[data-testid="computer-session-pause"]')!.click();
    });
    const pauseButton = q('[data-testid="computer-session-pause"]') as HTMLButtonElement;
    expect(pauseButton.disabled).toBe(true);
    await act(async () => {
      pauseButton.click();
    });
    expect(world.pauseSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("Pause 失败 → 只显示 sanitized Toast（不回显 raw bridge error）", async () => {
    const world = new FakeDesktopWorld([]);
    world.pauseSession = vi.fn(async () => {
      throw new Error("EPERM: \\\\.\\pipe\\classflow-xyz native failure");
    }) as unknown as FakeDesktopWorld["pauseSession"];
    installFakeDesktopBridge(world);
    seedSession("acting");
    await renderSurface();

    await act(async () => {
      q('[data-testid="computer-session-pause"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const toasts = useToastStore.getState().toasts;
    expect(toasts.some((t) => t.message === "暂停电脑操作失败")).toBe(true);
    expect(toasts.some((t) => t.message.includes("EPERM"))).toBe(false);
  });

  it("approval-required：无 Pause、保留 Stop；paused：只有 Resume + Stop；terminal：无控制", async () => {
    seedSession("approval-required");
    await renderSurface();
    expect(q('[data-testid="computer-session-pause"]')).toBeNull();
    expect(q('[data-testid="computer-session-resume"]')).toBeNull();
    expect(q('[data-testid="computer-session-stop"]')).toBeTruthy();

    seedSession("paused");
    await renderSurface();
    expect(q('[data-testid="computer-session-pause"]')).toBeNull();
    expect(q('[data-testid="computer-session-resume"]')).toBeTruthy();
    expect(q('[data-testid="computer-session-stop"]')).toBeTruthy();

    seedSession("completed");
    await renderSurface();
    expect(q('[data-testid="computer-session-pause"]')).toBeNull();
    expect(q('[data-testid="computer-session-resume"]')).toBeNull();
    expect(q('[data-testid="computer-session-stop"]')).toBeNull();
  });

  it("terminal dismiss（×）→ UI-only 收起；active session 没有 ×", async () => {
    seedSession("completed");
    await renderSurface();
    expect(q('[data-testid="kiro-computer-session-surface"]')).toBeTruthy();
    await act(async () => {
      q('[data-testid="computer-session-dismiss"]')!.click();
    });
    expect(q('[data-testid="kiro-computer-session-surface"]')).toBeNull();

    seedSession("acting");
    await renderSurface();
    expect(q('[data-testid="computer-session-dismiss"]')).toBeNull();
    expect(q('[data-testid="kiro-computer-session-surface"]')).toBeTruthy();
  });

  it("新 session 到达 → dismiss 不继承（新 session 必须可见）", async () => {
    seedSession("completed");
    await renderSurface();
    await act(async () => {
      q('[data-testid="computer-session-dismiss"]')!.click();
    });
    expect(q('[data-testid="kiro-computer-session-surface"]')).toBeNull();

    await act(async () => {
      useDesktopSessionStore.getState().applyEvent({
        type: "session",
        sessionId: "cs-99999999-8888-7777-6666-555555555555",
        state: "observing",
        appName: "wechat",
        windowTitle: "微信",
        actionLabel: null,
        actions: 0,
        observations: 1,
        updatedAt: 30,
        goal: null,
        plan: [],
        stepIndex: 0,
        reflectionRequired: false,
        appProfile: null,
      });
    });
    expect(q('[data-testid="kiro-computer-session-surface"]')).toBeTruthy();
  });
});
