// @vitest-environment jsdom
/**
 * Kiro Sidecar Shell（UX V2 + V2.1）UI 测试：
 * open/close presence、非模态（无全屏遮罩）、Esc 关闭、single mount、
 * resize（origin snapshot / multi-move / clamp / 持久化 / unmount cleanup）。
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
    // V2.1：尺寸走 CSS variables（mobile/desktop 共用同一 Shell）
    expect(panel?.style.getPropertyValue("--kiro-sidecar-width")).toBe(`${SIDECAR_DEFAULT_SIZE.width}px`);
    expect(panel?.style.getPropertyValue("--kiro-sidecar-height")).toBe(`${SIDECAR_DEFAULT_SIZE.height}px`);
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
  const panelW = (s: ReturnType<typeof setup>) =>
    Number.parseFloat(s.panel()!.style.getPropertyValue("--kiro-sidecar-width"));
  const panelH = (s: ReturnType<typeof setup>) =>
    Number.parseFloat(s.panel()!.style.getPropertyValue("--kiro-sidecar-height"));

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
    pointerDrag(handle, [
      { x: 620, y: 300 },
      { x: 520, y: 300 },
    ]);
    expect(panelW(s)).toBe(SIDECAR_DEFAULT_SIZE.width + 100);
    expect(useKiroPreferencesStore.getState().sidecarSize.width).toBe(SIDECAR_DEFAULT_SIZE.width + 100);
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
    // 默认 760 + 向下拖 40 → 800（viewport 900 时上限 852，未触及）
    expect(panelH(s)).toBe(SIDECAR_DEFAULT_SIZE.height + 40);
    expect(useKiroPreferencesStore.getState().sidecarSize.height).toBe(800);
    s.cleanup();
  });

  it("拖到最小 → 受 min 限制（420×560）", async () => {
    const s = setup(true);
    await s.flush();
    const handle = s.container.querySelector('[data-sidecar-resize-handle="corner"]')!;
    pointerDrag(handle, [
      { x: 620, y: 760 },
      { x: 100000, y: -100000 },
    ]);
    expect(panelW(s)).toBe(SIDECAR_MIN_WIDTH);
    expect(panelH(s)).toBe(SIDECAR_MIN_HEIGHT);
    expect(useKiroPreferencesStore.getState().sidecarSize.width).toBe(SIDECAR_MIN_WIDTH);
    s.cleanup();
  });

  // ---- V2.1：drag origin snapshot（multi-move 不得累计漂移） ----

  it("multi-move left：宽度 = origin + 最终 delta（非逐帧累计）", async () => {
    const s = setup(true);
    await s.flush();
    const handle = s.container.querySelector('[data-sidecar-resize-handle="left"]')!;
    // down x=620 → move 600 (+20) → 560 (+60) → 520 (+100)；最终 = 620 + 100 = 720
    pointerDrag(handle, [
      { x: 620, y: 300 },
      { x: 600, y: 300 },
      { x: 560, y: 300 },
      { x: 520, y: 300 },
    ]);
    expect(panelW(s)).toBe(SIDECAR_DEFAULT_SIZE.width + 100);
    // 持久化 = 最终帧（非 620+20+60+100=800）
    expect(useKiroPreferencesStore.getState().sidecarSize.width).toBe(SIDECAR_DEFAULT_SIZE.width + 100);
    s.cleanup();
  });

  it("multi-move bottom：高度 = origin + 最终 delta（+50）", async () => {
    const s = setup(true);
    await s.flush();
    const handle = s.container.querySelector('[data-sidecar-resize-handle="bottom"]')!;
    pointerDrag(handle, [
      { x: 400, y: 700 },
      { x: 400, y: 710 },
      { x: 400, y: 730 },
      { x: 400, y: 750 },
    ]);
    expect(panelH(s)).toBe(SIDECAR_DEFAULT_SIZE.height + 50);
    expect(useKiroPreferencesStore.getState().sidecarSize.height).toBe(SIDECAR_DEFAULT_SIZE.height + 50);
    s.cleanup();
  });

  it("multi-move corner：宽高同时 = origin + 最终 delta", async () => {
    const s = setup(true);
    await s.flush();
    const handle = s.container.querySelector('[data-sidecar-resize-handle="corner"]')!;
    // down (620,760) → (600,780) delta(+20,+20) → (580,800) delta(+40,+40) → (560,820) delta(+60,+60)
    pointerDrag(handle, [
      { x: 620, y: 760 },
      { x: 600, y: 780 },
      { x: 580, y: 800 },
      { x: 560, y: 820 },
    ]);
    expect(panelW(s)).toBe(SIDECAR_DEFAULT_SIZE.width + 60);
    expect(panelH(s)).toBe(SIDECAR_DEFAULT_SIZE.height + 60);
    expect(useKiroPreferencesStore.getState().sidecarSize).toEqual({
      width: SIDECAR_DEFAULT_SIZE.width + 60,
      height: SIDECAR_DEFAULT_SIZE.height + 60,
    });
    s.cleanup();
  });

  it("multi-move 穿越 min 边界：最终稳定在 min（无跳变/回弹）", async () => {
    const s = setup(true);
    await s.flush();
    const handle = s.container.querySelector('[data-sidecar-resize-handle="left"]')!;
    // 大幅缩小越过 420 → 再微调，最终仍 = min（基于 origin 620 计算，不累计）
    pointerDrag(handle, [
      { x: 620, y: 300 },
      { x: 2000, y: 300 },
      { x: 1800, y: 300 },
      { x: 1750, y: 300 },
    ]);
    expect(panelW(s)).toBe(SIDECAR_MIN_WIDTH);
    expect(useKiroPreferencesStore.getState().sidecarSize.width).toBe(SIDECAR_MIN_WIDTH);
    s.cleanup();
  });

  it("最后一帧持久化：move 后立即 pointerup，保存的是该帧 size", async () => {
    const s = setup(true);
    await s.flush();
    const handle = s.container.querySelector('[data-sidecar-resize-handle="left"]')!;
    // down → move(590, +30) → 立即 up（无更多 move）
    pointerDrag(handle, [
      { x: 620, y: 300 },
      { x: 590, y: 300 },
    ]);
    expect(useKiroPreferencesStore.getState().sidecarSize.width).toBe(SIDECAR_DEFAULT_SIZE.width + 30);
    s.cleanup();
  });

  it("拖拽中 unmount：body userSelect 恢复", async () => {
    const s = setup(true);
    await s.flush();
    const handle = s.container.querySelector('[data-sidecar-resize-handle="left"]')!;
    const h = handle as HTMLElement;
    act(() => {
      h.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 620, clientY: 300, pointerId: 1 }));
    });
    expect(document.body.style.userSelect).toBe("none");
    // 未 pointerup 直接 unmount
    s.cleanup();
    expect(document.body.style.userSelect).toBe("");
    s.cleanup();
  });
});

describe("Single Mount（V2.1）", () => {
  let probeMounts = 0;
  let probeUnmounts = 0;

  function ChildProbe() {
    React.useEffect(() => {
      probeMounts++;
      return () => {
        probeUnmounts++;
      };
    }, []);
    return <div data-testid="sidecar-child" />;
  }

  beforeEach(() => {
    probeMounts = 0;
    probeUnmounts = 0;
  });

  it("children 只 mount 一次（DOM 中只有一个 sidecar-child）", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    act(() => {
      root.render(
        <KiroSidecarShell open={true}>
          <ChildProbe />
        </KiroSidecarShell>
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(probeMounts).toBe(1);
    expect(probeUnmounts).toBe(0);
    // jsdom 不执行 Tailwind media query：即使 responsive CSS 存在，DOM 也不得复制 child
    expect(container.querySelectorAll('[data-testid="sidecar-child"]').length).toBe(1);
    act(() => root.unmount());
    container.remove();
  });
});
