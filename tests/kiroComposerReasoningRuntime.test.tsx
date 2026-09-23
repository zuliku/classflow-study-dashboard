// @vitest-environment jsdom
/**
 * Kiro Composer P3.1 — Reasoning 选择（真实 KiroChatSurface + 真实 store + 真实指针序列）。
 *
 * 回归目标（用户报告）：
 * - 点击档位必须完成选择（pointerdown 即生效，不依赖 click 落地）
 * - 点击后弹窗保持打开（菜单内部 pointer 事件不触发 Composer outside-close）
 * - 触发按钮 label 随 store 更新
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { KiroChatSurface } from "@/components/kiro/KiroChatSurface";
import { useAISettingsStore } from "@/store/useAISettingsStore";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";
import { useAppStore } from "@/store/useAppStore";
import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";

vi.mock("@/components/kiro/KiroSessionProvider", () => ({
  useKiroRuntime: () => ({
    chat: {
      messages: [],
      status: "ready",
      streaming: false,
      turnInFlight: false,
      preparingVision: false,
      preparingSend: false,
      turnIntentFrozen: false,
      visionEnabled: true,
      configured: true,
      sources: [],
      send: async () => true,
      stop: () => {},
      retry: () => {},
      consumeUndo: () => {},
      editAndResend: async () => false,
      undoTask: async () => {},
      resolveApproval: async () => {},
    },
    attachments: {
      views: [],
      hasProcessing: false,
      addFiles: () => {},
      remove: () => {},
      retry: () => {},
      saveToCourse: () => {},
      addMaterial: () => {},
    },
    activeRefs: [],
    removeContext: () => {},
    addManualContext: () => {},
  }),
  useKiroSessionMeta: () => ({
    suggestionsKind: null,
    suggestionsGen: 0,
    lastUserTurnGen: 0,
    emptyIntroGeneration: 0,
  }),
  useKiroSessionActions: () => ({ claimEmptyIntro: () => false }),
}));

if (typeof window !== "undefined" && !window.matchMedia) {
  (window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** 真实指针序列（pointerdown → pointerup → click） */
async function pointerClick(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    el.dispatchEvent(new Event("pointerup", { bubbles: true }));
    el.click();
  });
  await flush();
}

function reasoningTrigger(): HTMLButtonElement {
  return container!.querySelector('[data-testid="kiro-composer-reasoning"]') as HTMLButtonElement;
}

function reasoningMenu(): HTMLElement | null {
  return container!.querySelector('[data-testid="kiro-composer-reasoning-menu"]');
}

function reasoningRadios(): HTMLButtonElement[] {
  return Array.from(
    container!.querySelectorAll('[data-testid="kiro-composer-reasoning-track"] [role="radio"]')
  ) as HTMLButtonElement[];
}

beforeEach(() => {
  useAppStore.setState({ courses: [] as never, assignments: [] as never, groupProjects: [] as never });
  useKiroPreferencesStore.setState({ webSearchEnabled: false });
  useAISettingsStore.setState({
    provider: "opencode-go",
    model: "muse-spark-1.3-contributor",
    reasoningEffort: "low",
  });
  useKiroComputerStore.setState({
    computerEnabled: true,
    activeWorkspaceId: "ws-1",
    agentMode: "guided",
    workspaces: [
      {
        id: "ws-1",
        name: "Kiro 内置工作区",
        roots: [{ id: "root-1", label: "内置", access: "read-write", adapterRef: "sandbox-default" }],
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("Reasoning 选择（真实 Surface / 真实 store）", () => {
  it("点击 / pointerdown 档位：选择生效且弹窗保持打开", async () => {
    await act(async () => {
      root!.render(<KiroChatSurface variant="workspace" />);
    });
    await flush();

    expect(reasoningTrigger().textContent).toContain("低");
    await pointerClick(reasoningTrigger());
    expect(reasoningMenu()).toBeTruthy();
    expect(reasoningRadios().length).toBe(6);

    // pointerdown 即生效（不依赖 click 落地）
    const medium = reasoningRadios().find((r) => r.getAttribute("aria-label") === "思考程度：中")!;
    await act(async () => {
      medium.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    await flush();
    expect(useAISettingsStore.getState().reasoningEffort).toBe("medium");
    expect(reasoningMenu()).toBeTruthy();

    // click 同样生效；弹窗保持打开；trigger 更新
    const high = reasoningRadios().find((r) => r.getAttribute("aria-label") === "思考程度：高")!;
    await pointerClick(high);
    expect(useAISettingsStore.getState().reasoningEffort).toBe("high");
    expect(reasoningMenu()).toBeTruthy();
    expect(reasoningTrigger().textContent).toContain("高");
  });

  it("点击弹窗外部关闭", async () => {
    vi.useFakeTimers();
    try {
      await act(async () => {
        root!.render(<KiroChatSurface variant="workspace" />);
      });
      await flush();
      await pointerClick(reasoningTrigger());
      expect(reasoningTrigger().getAttribute("aria-expanded")).toBe("true");

      await act(async () => {
        document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      });
      await flush();
      expect(reasoningTrigger().getAttribute("aria-expanded")).toBe("false");

      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      await flush();
      expect(reasoningMenu()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});