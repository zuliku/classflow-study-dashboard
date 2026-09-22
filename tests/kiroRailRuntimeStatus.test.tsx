// @vitest-environment jsdom
/**
 * Kiro Rail Runtime Status V1 — Thread Rail DOM 契约测试。
 *
 * 验证：
 * - Rail Plate 输出 data-kiro-status（唯一 Motion 来源）
 * - expanded/current 只通过 data-emphasized 表达（Navigation emphasis 与 Runtime 状态解耦）
 * - collapsed 不因展开状态改变 Runtime status；expanded header 显示低权重状态小字
 * - Logo button title / aria-label 跟随状态（idle → 不显示额外文案）
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { KiroThreadRail } from "@/components/kiro/KiroThreadRail";
import { KiroSessionMetaContext, KiroSessionActionsContext } from "@/components/kiro/kiroSessionContext";
import type {
  KiroSessionActionsValue,
  KiroSessionMetaValue,
} from "@/components/kiro/KiroSessionProvider";
import type { KiroRuntimeStatus } from "@/lib/ai/ui/kiroRuntimeStatus";

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
  } as unknown as typeof ResizeObserver;
}

function metaValue(status: KiroRuntimeStatus): KiroSessionMetaValue {
  return {
    currentConversationId: null,
    conversationTitle: null,
    conversationCreatedAt: null,
    conversationSummary: null,
    historyVersion: 0,
    sidecarOpen: false,
    sidecarMode: "closed",
    kiroBusy: status !== "idle",
    kiroRuntimeStatus: status,
    suggestionsKind: null,
    suggestionsGen: 0,
    lastUserTurnGen: 0,
    hasMessages: false,
    conversationTransitioning: false,
    conversationTransition: {
      target: null,
      phase: "idle",
      pending: false,
    } as unknown as KiroSessionMetaValue["conversationTransition"],
    conversationProjectId: null,
    projectsVersion: 0,
    emptyIntroGeneration: 0,
  };
}

const actionsStub: KiroSessionActionsValue = {
  newChat: () => {},
  newChatInProject: () => {},
  loadConversation: () => {},
  deleteConversation: () => {},
  renameConversation: () => {},
  clearHistory: () => {},
  refreshHistory: () => {},
  openSidecar: () => {},
  closeSidecar: () => {},
  expandSidecar: () => {},
  minimizeSidecar: () => {},
  restoreSidecar: () => {},
  openForAssignment: () => {},
  openForCourse: () => {},
  openForGroupProject: () => {},
  openForWeek: () => {},
  handoffPrompt: () => {},
  handoffAssignmentPrompt: () => {},
  handoffVisualPendingContinuation: async () => true,
  copyCurrentTranscript: async () => {},
  exportCurrentTranscript: () => {},
  getCurrentMessages: () => [],
  createProject: async () => null,
  updateProject: async () => null,
  deleteProject: async () => {},
  refreshProjects: () => {},
  assignConversationToProject: async () => true,
  claimEmptyIntro: () => false,
};

function renderRail(status: KiroRuntimeStatus) {
  return render(
    <KiroSessionMetaContext.Provider value={metaValue(status)}>
      <KiroSessionActionsContext.Provider value={actionsStub}>
        <KiroThreadRail />
      </KiroSessionActionsContext.Provider>
    </KiroSessionMetaContext.Provider>
  );
}

describe("Kiro Rail Runtime Status V1 — DOM 契约", () => {
  beforeEach(() => cleanup());
  afterEach(() => cleanup());

  it.each([
    ["idle"],
    ["thinking"],
    ["computer-active"],
    ["waiting-approval"],
  ] as const)("collapsed Rail 输出 data-kiro-status=%s", (status) => {
    const { container } = renderRail(status);
    const plates = container.querySelectorAll("[data-kiro-status]");
    expect(plates.length).toBeGreaterThan(0);
    for (const plate of Array.from(plates)) {
      expect(plate.getAttribute("data-kiro-status")).toBe(status);
    }
    // 旧 flow 语义不得再出现在 Rail
    expect(container.querySelector("[data-kiro-flow]")).toBeNull();
  });

  it("expanded/current 只通过 data-emphasized 表达（不改变 Runtime status）", () => {
    const { container, getByTestId } = renderRail("idle");
    // collapsed：logo button 展开 → expanded header 出现 emphasized plate
    const logoButton = container.querySelector('button[aria-label="展开对话"]') as HTMLButtonElement;
    expect(logoButton).toBeTruthy();
    fireEvent.click(logoButton);
    const shell = getByTestId("kiro-thread-rail-shell");
    expect(shell.getAttribute("data-state")).toBe("expanded");
    const emphasized = shell.querySelectorAll("[data-emphasized]");
    expect(emphasized.length).toBeGreaterThan(0);
    for (const plate of Array.from(emphasized)) {
      expect(plate.getAttribute("data-kiro-status")).toBe("idle");
    }
  });

  it("展开状态不改变 Runtime status（同一 meta 下 collapsed / expanded 一致）", () => {
    const { container, getByTestId } = renderRail("computer-active");
    const collapsedPlate = container.querySelector("[data-kiro-status]");
    expect(collapsedPlate?.getAttribute("data-kiro-status")).toBe("computer-active");
    fireEvent.click(container.querySelector('button[aria-label*="正在操作电脑"]') as HTMLButtonElement);
    const shell = getByTestId("kiro-thread-rail-shell");
    expect(shell.getAttribute("data-state")).toBe("expanded");
    const statuses = new Set(
      Array.from(shell.querySelectorAll("[data-kiro-status]")).map((el) =>
        el.getAttribute("data-kiro-status")
      )
    );
    expect(statuses).toEqual(new Set(["computer-active"]));
  });

  it("idle：Logo button title=Kiro 且不显示状态小字", () => {
    const { container } = renderRail("idle");
    const button = container.querySelector("button.group\\/plate") as HTMLButtonElement;
    expect(button.getAttribute("title")).toBe("Kiro");
    expect(button.getAttribute("aria-label")).toBe("展开对话");
    expect(container.querySelector('[data-testid="kiro-rail-runtime-status-text"]')).toBeNull();
  });

  it("thinking：title / aria 显示「正在思考」，展开后出现低权重状态小字", () => {
    const { container, getByTestId } = renderRail("thinking");
    const button = container.querySelector("button.group\\/plate") as HTMLButtonElement;
    expect(button.getAttribute("title")).toBe("Kiro · 正在思考");
    expect(button.getAttribute("aria-label")).toContain("正在思考");
    fireEvent.click(button);
    expect(getByTestId("kiro-rail-runtime-status-text").textContent).toBe("正在思考");
  });

  it("computer-active：title / aria 显示「正在操作电脑」，小字为「正在操作电脑」", () => {
    const { container, getByTestId } = renderRail("computer-active");
    const button = container.querySelector("button.group\\/plate") as HTMLButtonElement;
    expect(button.getAttribute("title")).toBe("Kiro · 正在操作电脑");
    fireEvent.click(button);
    expect(getByTestId("kiro-rail-runtime-status-text").textContent).toBe("正在操作电脑");
  });

  it("waiting-approval：title / aria 显示「等待你的确认」，小字为「等待确认」", () => {
    const { container, getByTestId } = renderRail("waiting-approval");
    const button = container.querySelector("button.group\\/plate") as HTMLButtonElement;
    expect(button.getAttribute("title")).toBe("Kiro · 等待你的确认");
    fireEvent.click(button);
    expect(getByTestId("kiro-rail-runtime-status-text").textContent).toBe("等待确认");
  });

  it("不新增动态圆点 / spinner badge（状态只用 perimeter + 文字表达）", () => {
    const { container } = renderRail("computer-active");
    expect(container.querySelector('[data-testid*="dot"]')).toBeNull();
    expect(container.querySelector('[data-testid*="badge"]')).toBeNull();
    expect(container.querySelector(".animate-spin")).toBeNull();
  });
});
