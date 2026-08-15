// @vitest-environment jsdom
/**
 * Kiro Sidecar Shell（UX V2）UI 测试：
 * open/close presence、非模态（无全屏遮罩）、Esc 关闭、resize handle、拖拽 clamp、尺寸持久化。
 * 使用 jsdom + react-dom/client + act；不写 brittle snapshot。
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { KiroSidecarShell } from "@/components/kiro/sidecar/KiroSidecarShell";
import { SIDECAR_DEFAULT_SIZE, SIDECAR_MIN_WIDTH, SIDECAR_MIN_HEIGHT } from "@/lib/ai/ui/sidecarSize";
import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";

const mocks = vi.hoisted(() => ({
  closeSidecar: vi.fn(),
  expandSidecar: vi.fn(),
  sessionActions: {},
}));

vi.mock("@/components/kiro/KiroSessionProvider", () => ({
  useKiroSession: () => ({
    closeSidecar: mocks.closeSidecar,
    expandSidecar: mocks.expandSidecar,
  }),
  useKiroSessionMeta: () => ({
    currentConversationId: null,
    conversationTitle: null,
    conversationCreatedAt: null,
    conversationSummary: null,
    historyVersion: 0,
    sidecarOpen: true,
    suggestionsKind: null,
    suggestionsGen: 0,
    lastUserTurnGen: 0,
    hasMessages: false,
    conversationTransitioning: false,
    conversationTransition: { phase: "idle" },
    conversationProjectId: null,
    projectsVersion: 0,
  }),
  useKiroSessionActions: () => mocks.sessionActions,
}));

if (!window.matchMedia) {
  (window as unknown as { matchMedia: unknown }).matchMedia = () =>
    ({
      matches: false,
      media: "",
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }) as unknown as MediaQueryList;
}
// jsdom 无 setPointerCapture
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}

function setup(open: boolean) {
  // 固定 viewport（jsdom 默认 768 高会把 clamp 上限压到 720，干扰 resize 断言）
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <KiroSidecarShell open={open}>
        <div data-testid="sidecar-body-stub">messages</div>
      </KiroSidecarShell>
    );
  });
  const panel = () => container.querySelector('[data-testid="kiro-sidecar"]') as HTMLElement | null;
  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };
  const cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return { container, panel, flush, cleanup };
}

function pointerDrag(handle: Element, moves: { x: number; y: number }[]) {
  const h = handle as HTMLElement;
  const start = moves[0];
  act(() => {
    h.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: start.x, clientY: start.y, pointerId: 1 }));
  });
  for (const m of moves.slice(1)) {
    act(() => {
      h.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: m.x, clientY: m.y, pointerId: 1 }));
    });
  }
  act(() => {
    h.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: moves[moves.length - 1].x, clientY: moves[moves.length - 1].y, pointerId: 1 }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useKiroPreferencesStore.setState({ sidecarSize: SIDECAR_DEFAULT_SIZE });
});

describe("Sidecar Shell 状态机", () => {
  it("open：md+ 浮动面板渲染（role=dialog），无全屏遮罩", async () => {
    const s = setup(true);
    await s.flush();
    const panel = s.panel();
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute("role")).toBe("dialog");
    expect(panel?.getAttribute("aria-label")).toBe("Kiro 侧边聊天");
    expect(panel?.style.width).toBe(`${SIDECAR_DEFAULT_SIZE.width}px`);
    expect(panel?.style.height).toBe(`${SIDECAR_DEFAULT_SIZE.height}px`);
    // 非模态：没有全屏 backdrop/mask 元素
    const overlay = s.container.querySelector('[data-testid*="overlay"], [data-testid*="backdrop"], [data-testid*="mask"]');
    expect(overlay).toBeNull();
    // body stub 渲染在面板内
    expect(s.container.querySelector('[data-testid="sidecar-body-stub"]')).toBeTruthy();
    s.cleanup();
  });

  it("close 按钮 → closeSidecar 被调用", async () => {
    const s = setup(true);
    await s.flush();
    const closeBtn = s.container.querySelector('[aria-label="关闭 Kiro"]') as HTMLElement;
    expect(closeBtn).toBeTruthy();
    act(() => closeBtn.click());
    expect(mocks.closeSidecar).toHaveBeenCalledTimes(1);
    s.cleanup();
  });

  it("Esc → closeSidecar 被调用", async () => {
    const s = setup(true);
    await s.flush();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(mocks.closeSidecar).toHaveBeenCalledTimes(1);
    s.cleanup();
  });

  it("closed：面板卸载（presence）", async () => {
    const s = setup(false);
    await s.flush();
    expect(s.panel()).toBeNull();
    s.cleanup();
  });
});

describe("Resize handles", () => {
  it("左/底/角三个 handle 存在且 aria 正确", async () => {
    const s = setup(true);
    await s.flush();
    expect(s.container.querySelector('[data-sidecar-resize-handle="left"][aria-label="调整宽度"]')).toBeTruthy();
    expect(s.container.querySelector('[data-sidecar-resize-handle="bottom"][aria-label="调整高度"]')).toBeTruthy();
    expect(s.container.querySelector('[data-sidecar-resize-handle="corner"][aria-label="调整尺寸"]')).toBeTruthy();
    s.cleanup();
  });

  it("左边缘拖拽 → 宽度变化并持久化到 store", async () => {
    const s = setup(true);
    await s.flush();
    const handle = s.container.querySelector('[data-sidecar-resize-handle="left"]')!;
    // 向左拉 100px → 宽 720
    pointerDrag(handle, [
      { x: 620, y: 300 },
      { x: 520, y: 300 },
    ]);
    const panel = s.panel()!;
    expect(panel.style.width).toBe("720px");
    expect(useKiroPreferencesStore.getState().sidecarSize.width).toBe(720);
    s.cleanup();
  });

  it("底边拖拽 → 高度变化", async () => {
    const s = setup(true);
    await s.flush();
    const handle = s.container.querySelector('[data-sidecar-resize-handle="bottom"]')!;
    pointerDrag(handle, [
      { x: 400, y: 760 },
      { x: 400, y: 800 },
    ]);
    const panel = s.panel()!;
    // 默认 760 + 向下拖 40 → 800（viewport 900 时上限 852，未触及）
    expect(panel.style.height).toBe("800px");
    expect(useKiroPreferencesStore.getState().sidecarSize.height).toBe(800);
    s.cleanup();
  });

  it("拖到最小 → 受 min 限制（420×560）", async () => {
    const s = setup(true);
    await s.flush();
    const handle = s.container.querySelector('[data-sidecar-resize-handle="corner"]')!;
    // 左下角 handle：向右上拖（dx 大正 → 变窄；dy 大负 → 变矮）→ 收敛到 min
    pointerDrag(handle, [
      { x: 620, y: 760 },
      { x: 100000, y: -100000 },
    ]);
    const panel = s.panel()!;
    expect(panel.style.width).toBe(`${SIDECAR_MIN_WIDTH}px`);
    expect(panel.style.height).toBe(`${SIDECAR_MIN_HEIGHT}px`);
    expect(useKiroPreferencesStore.getState().sidecarSize.width).toBe(SIDECAR_MIN_WIDTH);
    s.cleanup();
  });
});
