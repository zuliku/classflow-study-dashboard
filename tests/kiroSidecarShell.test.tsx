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
import fs from "node:fs";
import path from "node:path";
import { KiroSidecarShell } from "@/components/kiro/sidecar/KiroSidecarShell";
import {
  SIDECAR_DEFAULT_SIZE,
  SIDECAR_MIN_WIDTH,
  SIDECAR_MIN_HEIGHT,
  SIDECAR_VIEWPORT_TOP_MARGIN,
} from "@/lib/ai/ui/sidecarSize";
import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";

const mocks = vi.hoisted(() => ({
  closeSidecar: vi.fn(),
  expandSidecar: vi.fn(),
  minimizeSidecar: vi.fn(),
  restoreSidecar: vi.fn(),
}));

vi.mock("@/components/kiro/KiroSessionProvider", () => ({
  useKiroSession: () => ({
    closeSidecar: mocks.closeSidecar,
    expandSidecar: mocks.expandSidecar,
  }),
  useKiroSessionActions: () => ({
    closeSidecar: mocks.closeSidecar,
    expandSidecar: mocks.expandSidecar,
    minimizeSidecar: mocks.minimizeSidecar,
    restoreSidecar: mocks.restoreSidecar,
  }),
  useKiroSessionMeta: () => ({
    currentConversationId: null,
    conversationTitle: null,
    conversationCreatedAt: null,
    conversationSummary: null,
    historyVersion: 0,
    sidecarOpen: true,
    sidecarMode: "open" as const,
    kiroBusy: false,
    suggestionsKind: null,
    suggestionsGen: 0,
    lastUserTurnGen: 0,
    hasMessages: false,
    conversationTransitioning: false,
    conversationTransition: { phase: "idle" },
    conversationProjectId: null,
    projectsVersion: 0,
    emptyIntroGeneration: 0,
  }),
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
// jsdom 无 setPointerCapture / PointerEvent（Node 24 jsdom 缺失，补齐以保证拖拽测试）
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (typeof PointerEvent === "undefined") {
  // @ts-ignore
  globalThis.PointerEvent = class PointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = (params as any).pointerId ?? 0;
    }
  } as any;
}

function setup(mode: "open" | "closed" | "minimized" = "open", present = true) {
  // 固定 viewport（jsdom 默认 768 高会把 clamp 上限压到 720，干扰 resize 断言）
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const rerender = (m: typeof mode, p: boolean = true) => {
    act(() => {
      root.render(
        <KiroSidecarShell mode={m} present={p}>
          <div data-testid="sidecar-body-stub">messages</div>
        </KiroSidecarShell>
      );
    });
  };
  act(() => {
    root.render(
      <KiroSidecarShell mode={mode} present={present}>
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
  return { container, panel, flush, cleanup, rerender, root };
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
  useKiroPreferencesStore.setState({ sidecarPosition: { top: SIDECAR_VIEWPORT_TOP_MARGIN, right: 24 } });
});

describe("Sidecar Shell 状态机", () => {
  it("open：md+ 浮动面板渲染（role=dialog），无全屏遮罩", async () => {
    const s = setup("open", true);
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
    const s = setup("open", true);
    await s.flush();
    const closeBtn = s.container.querySelector('[aria-label="关闭 Kiro"]') as HTMLElement;
    expect(closeBtn).toBeTruthy();
    act(() => closeBtn.click());
    expect(mocks.closeSidecar).toHaveBeenCalledTimes(1);
    s.cleanup();
  });

  it("Esc → Shell 不直接处理（由 Provider + Overlay Stack 负责）", async () => {
    const s = setup("open", true);
    await s.flush();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    // Shell 已移除独立 Esc 监听，Provider 负责
    expect(mocks.closeSidecar).toHaveBeenCalledTimes(0);
    s.cleanup();
  });

  it("closed：present=false 时 Full 隐藏（opacity-0 + inert），不闪回", async () => {
    const s = setup("closed", false);
    await s.flush();
    const panel = s.panel();
    expect(panel).toBeTruthy();
    expect(panel!.getAttribute("aria-hidden")).toBe("true");
    expect(panel!.hasAttribute("inert")).toBe(true);
    expect(panel!.className).toContain("opacity-0");
    s.cleanup();
  });
});

describe("Resize handles", () => {
  const panelW = (s: ReturnType<typeof setup>) =>
    Number.parseFloat(s.panel()!.style.getPropertyValue("--kiro-sidecar-width"));
  const panelH = (s: ReturnType<typeof setup>) =>
    Number.parseFloat(s.panel()!.style.getPropertyValue("--kiro-sidecar-height"));

  it("左/底/角三个 handle 存在且 aria 正确", async () => {
    const s = setup("open", true);
    await s.flush();
    expect(s.container.querySelector('[data-sidecar-resize-handle="left"][aria-label="调整宽度"]')).toBeTruthy();
    expect(s.container.querySelector('[data-sidecar-resize-handle="bottom"][aria-label="调整高度"]')).toBeTruthy();
    expect(s.container.querySelector('[data-sidecar-resize-handle="corner"][aria-label="调整尺寸"]')).toBeTruthy();
    s.cleanup();
  });

  it("左边缘拖拽 → 宽度变化并持久化到 store", async () => {
    const s = setup("open", true);
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
    const s = setup("open", true);
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
    const s = setup("open", true);
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
    const s = setup("open", true);
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
    const s = setup("open", true);
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
    const s = setup("open", true);
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
    const s = setup("open", true);
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
    const s = setup("open", true);
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
    const s = setup("open", true);
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
        <KiroSidecarShell mode="open" present={true}>
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

describe("Move handle（Move V1）", () => {
  const panelTop = (s: ReturnType<typeof setup>) =>
    Number.parseFloat(s.panel()!.style.getPropertyValue("--kiro-sidecar-top"));
  const panelRight = (s: ReturnType<typeof setup>) =>
    Number.parseFloat(s.panel()!.style.getPropertyValue("--kiro-sidecar-right"));

  it("A. handle 可聚焦：separator 语义 + Tab order + 键盘提示（S6-2，替代旧 aria-hidden）", async () => {
    const s = setup("open", true);
    await s.flush();
    const handle = s.container.querySelector('[data-testid="kiro-sidecar-move-handle"]')!;
    expect(handle).toBeTruthy();
    expect(handle.hasAttribute("aria-hidden")).toBe(false);
    expect(handle.getAttribute("tabindex")).toBe("0");
    expect(handle.getAttribute("role")).toBe("separator");
    expect(handle.getAttribute("aria-label")).toBe("移动 Kiro 面板");
    // 响应式隐藏类（mobile 不显示）
    expect(handle.className).toContain("hidden");
    s.cleanup();
  });

  it("B. 初始 position vars = 40px / 24px（TitleBar safe area）", async () => {
    const s = setup("open", true);
    await s.flush();
    expect(panelTop(s)).toBe(SIDECAR_VIEWPORT_TOP_MARGIN);
    expect(panelRight(s)).toBe(24);
    s.cleanup();
  });

  it("C. move：pointerdown(1000,100) → move(900,150) → right +100 / top +50（safe top 40 基准）", async () => {
    const s = setup("open", true);
    await s.flush();
    const handle = s.container.querySelector('[data-testid="kiro-sidecar-move-handle"]')!;
    pointerDrag(handle, [
      { x: 1000, y: 100 },
      { x: 900, y: 150 },
    ]);
    expect(panelRight(s)).toBe(124);
    expect(panelTop(s)).toBe(SIDECAR_VIEWPORT_TOP_MARGIN + 50);
    s.cleanup();
  });

  it("D. multi-move：最终 = origin + 最终 delta（非逐帧累计，safe top）", async () => {
    const s = setup("open", true);
    await s.flush();
    const handle = s.container.querySelector('[data-testid="kiro-sidecar-move-handle"]')!;
    // down(1000,100) → (950,120) → (900,150)：最终 delta = (-100, +50)；origin top 已 clamp 到 40
    pointerDrag(handle, [
      { x: 1000, y: 100 },
      { x: 950, y: 120 },
      { x: 900, y: 150 },
    ]);
    expect(panelRight(s)).toBe(124);
    expect(panelTop(s)).toBe(SIDECAR_VIEWPORT_TOP_MARGIN + 50);
    expect(useKiroPreferencesStore.getState().sidecarPosition).toEqual({
      top: SIDECAR_VIEWPORT_TOP_MARGIN + 50,
      right: 124,
    });
    s.cleanup();
  });

  it("E+G. pointermove 后立即 pointerup：store 保存最后一帧位置（safe top）", async () => {
    const s = setup("open", true);
    await s.flush();
    const handle = s.container.querySelector('[data-testid="kiro-sidecar-move-handle"]')!;
    pointerDrag(handle, [
      { x: 1000, y: 100 },
      { x: 900, y: 150 },
    ]);
    expect(useKiroPreferencesStore.getState().sidecarPosition).toEqual({
      top: SIDECAR_VIEWPORT_TOP_MARGIN + 50,
      right: 124,
    });
    s.cleanup();
  });

  it("快速拖动松手 → 精确落位（无投射、无边角吸附；速度再快也不瞬移）", async () => {
    const s = setup("open", true);
    await s.flush();
    const handle = s.container.querySelector('[data-testid="kiro-sidecar-move-handle"]') as HTMLElement;
    let now = 5000;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      act(() => {
        handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 1000, clientY: 100, pointerId: 1 }));
      });
      // 3 次 move，每次间隔 20ms（≈2px/ms 的果断拖动；此前会触发惯性投射拍向边角）
      for (const [x, y] of [[960, 110], [920, 120], [880, 130]] as const) {
        now += 20;
        act(() => {
          handle.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
        });
      }
      act(() => {
        handle.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 880, clientY: 130, pointerId: 1 }));
      });
    } finally {
      nowSpy.mockRestore();
    }
    // 手指落位 right=144 / top=70（origin top 已 clamp 到 40 +30）；与 store 完全一致
    expect(panelRight(s)).toBe(144);
    expect(panelTop(s)).toBe(SIDECAR_VIEWPORT_TOP_MARGIN + 30);
    expect(useKiroPreferencesStore.getState().sidecarPosition).toEqual({
      top: SIDECAR_VIEWPORT_TOP_MARGIN + 30,
      right: 144,
    });
    s.cleanup();
  });

  it("慢速长拖 → 原落位（与快拖同一精确落位语义）", async () => {
    const s = setup("open", true);
    await s.flush();
    const handle = s.container.querySelector('[data-testid="kiro-sidecar-move-handle"]') as HTMLElement;
    let now = 9000;
    const nowSpy = vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      act(() => {
        handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 1000, clientY: 100, pointerId: 1 }));
      });
      // 同样 3 次 move，但每次间隔 500ms：末速度 ≈0.08px/ms < 阈值
      for (const [x, y] of [[960, 110], [920, 120], [880, 130]] as const) {
        now += 500;
        act(() => {
          handle.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
        });
      }
      act(() => {
        handle.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 880, clientY: 130, pointerId: 1 }));
      });
    } finally {
      nowSpy.mockRestore();
    }
    expect(panelRight(s)).toBe(144);
    expect(panelTop(s)).toBe(SIDECAR_VIEWPORT_TOP_MARGIN + 30);
    s.cleanup();
  });

  it("F. clamp：拖出右上角 → top=40 / right=maxRight（TitleBar safe，不越边界）", async () => {
    const s = setup("open", true);
    await s.flush();
    const handle = s.container.querySelector('[data-testid="kiro-sidecar-move-handle"]')!;
    pointerDrag(handle, [
      { x: 1000, y: 100 },
      { x: -5000, y: -5000 },
    ]);
    const maxRight = 1440 - SIDECAR_DEFAULT_SIZE.width - 24;
    expect(panelTop(s)).toBe(SIDECAR_VIEWPORT_TOP_MARGIN);
    expect(panelRight(s)).toBe(maxRight);
    s.cleanup();
  });

  it("F2. clamp：拖出左下角 → top=maxTop / right=24", async () => {
    const s = setup("open", true);
    await s.flush();
    const handle = s.container.querySelector('[data-testid="kiro-sidecar-move-handle"]')!;
    pointerDrag(handle, [
      { x: 1000, y: 100 },
      { x: 5000, y: 5000 },
    ]);
    const maxTop = 900 - SIDECAR_DEFAULT_SIZE.height - 24;
    expect(panelTop(s)).toBe(maxTop);
    expect(panelRight(s)).toBe(24);
    s.cleanup();
  });

  it("H. 拖拽中 unmount：body userSelect 恢复", async () => {
    const s = setup("open", true);
    await s.flush();
    const handle = s.container.querySelector('[data-testid="kiro-sidecar-move-handle"]')!;
    const h = handle as HTMLElement;
    act(() => {
      h.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 1000, clientY: 100, pointerId: 1 }));
    });
    expect(document.body.style.userSelect).toBe("none");
    s.cleanup();
    expect(document.body.style.userSelect).toBe("");
    s.cleanup();
  });

  it("§27a. move 靠左后 left-resize：right edge 不变且 left ≥ 24", async () => {
    const s = setup("open", true);
    await s.flush();
    // 1) 移动到 right=500（左移 476：down(1000,100) → move(524,100)）
    const move = s.container.querySelector('[data-testid="kiro-sidecar-move-handle"]')!;
    pointerDrag(move, [
      { x: 1000, y: 100 },
      { x: 524, y: 100 },
    ]);
    expect(panelRight(s)).toBe(500);
    // 2) left-resize 增宽 +200（向左拉：dx=-200 → deltaWidth=+200）
    const left = s.container.querySelector('[data-sidecar-resize-handle="left"]')!;
    pointerDrag(left, [
      { x: 300, y: 300 },
      { x: 100, y: 300 },
    ]);
    // position-aware clamp：width ≤ 1440-500-24=916；origin 620 + 200 = 820 ✓
    expect(panelRight(s)).toBe(500);
    expect(
      Number.parseFloat(s.panel()!.style.getPropertyValue("--kiro-sidecar-width"))
    ).toBe(SIDECAR_DEFAULT_SIZE.width + 200);
    // left = 1440 - right - width ≥ 24
    expect(1440 - 500 - (SIDECAR_DEFAULT_SIZE.width + 200)).toBeGreaterThanOrEqual(24);
    s.cleanup();
  });

  it("§27b. move 靠下后 bottom-resize：top edge 不变且 bottom ≤ viewport - 24（safe top 40）", async () => {
    const s = setup("open", true);
    await s.flush();
    // 移到 top=90（40+50，避开 760 高度的 bottom bound 116）
    const move = s.container.querySelector('[data-testid="kiro-sidecar-move-handle"]')!;
    pointerDrag(move, [
      { x: 1000, y: 100 },
      { x: 1000, y: 150 },
    ]);
    expect(panelTop(s)).toBe(SIDECAR_VIEWPORT_TOP_MARGIN + 50);
    // bottom-resize +100：position-aware height 上限 = 900-90-24 = 786
    const bottom = s.container.querySelector('[data-sidecar-resize-handle="bottom"]')!;
    pointerDrag(bottom, [
      { x: 400, y: 700 },
      { x: 400, y: 800 },
    ]);
    expect(panelTop(s)).toBe(SIDECAR_VIEWPORT_TOP_MARGIN + 50);
    const height = Number.parseFloat(s.panel()!.style.getPropertyValue("--kiro-sidecar-height"));
    expect(height).toBe(786);
    expect(SIDECAR_VIEWPORT_TOP_MARGIN + 50 + height).toBeLessThanOrEqual(900 - 24);
    s.cleanup();
  });
});

describe("Drag Perf（手势帧零 reconcile + compositor 位移）", () => {
  function setupCounting() {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    let renders = 0;
    function CountingChild() {
      renders += 1;
      return <div data-testid="sidecar-body-stub">messages</div>;
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <KiroSidecarShell mode="open" present={true}>
          <CountingChild />
        </KiroSidecarShell>
      );
    });
    const panel = () => container.querySelector('[data-testid="kiro-sidecar"]') as HTMLElement | null;
    const flushFrame = async () => {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 32));
      });
    };
    const cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };
    const renderCount = () => renders;
    return { container, panel, flushFrame, cleanup, renderCount };
  }

  function down(handle: Element, x: number, y: number) {
    act(() => {
      (handle as HTMLElement).dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 })
      );
    });
  }

  function move(handle: Element, x: number, y: number) {
    act(() => {
      (handle as HTMLElement).dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y, pointerId: 1 })
      );
    });
  }

  function up(handle: Element, x: number, y: number) {
    act(() => {
      (handle as HTMLElement).dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientX: x, clientY: y, pointerId: 1 })
      );
    });
  }

  it("move 手势帧：transform 直写 + 内容零重渲染，store 只在松手持久化", async () => {
    const s = setupCounting();
    const handle = s.container.querySelector('[data-testid="kiro-sidecar-move-handle"]')!;
    const before = s.renderCount();
    down(handle, 1000, 100);
    // 连续多帧 pointermove（rAF 合并，同步 act 内不执行帧回调）
    move(handle, 980, 110);
    move(handle, 960, 120);
    move(handle, 940, 130);
    // 手势帧期间：无 React state 更新 → 内容零重渲染，store 未写
    expect(s.renderCount()).toBe(before);
    expect(useKiroPreferencesStore.getState().sidecarPosition).toEqual({ top: SIDECAR_VIEWPORT_TOP_MARGIN, right: 24 });
    // 帧回调执行后：compositor transform 生效（origin top 已 clamp 到 40）
    await s.flushFrame();
    expect(s.panel()!.style.transform).toContain("translate(");
    expect(s.renderCount()).toBe(before);
    // 松手：transform 清零 + 最后一帧持久化（delta -60/+30）
    up(handle, 940, 130);
    expect(s.panel()!.style.transform).toBe("");
    expect(useKiroPreferencesStore.getState().sidecarPosition).toEqual({
      top: SIDECAR_VIEWPORT_TOP_MARGIN + 30,
      right: 84,
    });
    s.cleanup();
  });

  it("geometry 交互期间根 transition 关闭（松手跳回归）：属性挂载/卸载 + CSS kill 规则", async () => {
    // 根节点常年带 transition-[opacity,transform]（进/退场用）；拖动逐帧直写 transform 时
    // 若 230ms spring 介入插值 → 渲染滞后光标，松手残余一次性结算 = 松手跳。
    // 交互期间根自身 transition 必须关闭（内部元素降权只覆盖后代，够不到自身）。
    const s = setup("open", true);
    await s.flush();
    const handle = s.container.querySelector('[data-testid="kiro-sidecar-move-handle"]')!;
    const interacting = () => s.panel()!.hasAttribute("data-geometry-interacting");
    expect(interacting()).toBe(false);
    down(handle, 1000, 100);
    expect(interacting()).toBe(true);
    move(handle, 960, 120);
    move(handle, 940, 130);
    expect(interacting()).toBe(true);
    // 提交期同步布局读：把“数值落地”与“过渡恢复”隔进两次样式重算，
    // 否则 transition:none→230ms 与 transform 变更同帧提交会重启动过渡（松手跳）。
    const layoutSpy = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get");
    try {
      up(handle, 940, 130);
      expect(layoutSpy).toHaveBeenCalled();
    } finally {
      layoutSpy.mockRestore();
    }
    expect(interacting()).toBe(false);
    s.cleanup();

    const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toContain(".kiro-sidecar-shell[data-geometry-interacting]");
    expect(css).toMatch(/\.kiro-sidecar-shell\[data-geometry-interacting\]\s*\{\s*transition:\s*none/);
    const shellSrc = fs.readFileSync(
      path.join(process.cwd(), "components/kiro/sidecar/KiroSidecarShell.tsx"),
      "utf8"
    );
    expect(shellSrc).toContain("kiro-sidecar-shell");
  });

  it("resize 手势帧：CSS 变量直写 + 内容零重渲染，store 只在松手持久化", async () => {
    const s = setupCounting();
    const left = s.container.querySelector('[data-sidecar-resize-handle="left"]')!;
    const before = s.renderCount();
    down(left, 300, 300);
    move(left, 250, 300);
    move(left, 200, 300);
    expect(s.renderCount()).toBe(before);
    await s.flushFrame();
    // origin 620 + 100 = 720（上限 1440-24-24 内）
    expect(Number.parseFloat(s.panel()!.style.getPropertyValue("--kiro-sidecar-width"))).toBe(
      SIDECAR_DEFAULT_SIZE.width + 100
    );
    expect(s.renderCount()).toBe(before);
    up(left, 200, 300);
    expect(useKiroPreferencesStore.getState().sidecarSize.width).toBe(SIDECAR_DEFAULT_SIZE.width + 100);
    s.cleanup();
  });
});

describe("Keyboard geometry（S6-1/S6-2：方向键 discrete 路径，走同一 clamp + 持久化）", () => {
  function keyDown(el: Element, key: string, shift = false): boolean {
    let prevented = false;
    act(() => {
      const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, shiftKey: shift });
      ev.preventDefault = () => {
        prevented = true;
      };
      (el as HTMLElement).dispatchEvent(ev);
    });
    return prevented;
  }

  const panelTop = (s: ReturnType<typeof setup>) =>
    Number.parseFloat(s.panel()!.style.getPropertyValue("--kiro-sidecar-top"));
  const panelRight = (s: ReturnType<typeof setup>) =>
    Number.parseFloat(s.panel()!.style.getPropertyValue("--kiro-sidecar-right"));
  const panelWidth = (s: ReturnType<typeof setup>) =>
    Number.parseFloat(s.panel()!.style.getPropertyValue("--kiro-sidecar-width"));
  const panelHeight = (s: ReturnType<typeof setup>) =>
    Number.parseFloat(s.panel()!.style.getPropertyValue("--kiro-sidecar-height"));

  it("resize 把手可聚焦：三把手 tabindex + 方向语义 label", async () => {
    const s = setup("open", true);
    await s.flush();
    const left = s.container.querySelector('[data-sidecar-resize-handle="left"]')!;
    const bottom = s.container.querySelector('[data-sidecar-resize-handle="bottom"]')!;
    const corner = s.container.querySelector('[data-sidecar-resize-handle="corner"]')!;
    for (const h of [left, bottom, corner]) {
      expect(h.getAttribute("tabindex")).toBe("0");
      expect(h.getAttribute("role")).toBe("separator");
    }
    expect(left.getAttribute("aria-label")).toBe("调整宽度");
    expect(bottom.getAttribute("aria-label")).toBe("调整高度");
    expect(corner.getAttribute("aria-label")).toBe("调整尺寸");
    s.cleanup();
  });

  it("left 把手：Left 加宽 16 / Right 收窄 16（与 pointer 拖拽同向），持久化", async () => {
    const s = setup("open", true);
    await s.flush();
    const left = s.container.querySelector('[data-sidecar-resize-handle="left"]')!;
    expect(keyDown(left, "ArrowLeft")).toBe(true);
    expect(panelWidth(s)).toBe(SIDECAR_DEFAULT_SIZE.width + 16);
    expect(useKiroPreferencesStore.getState().sidecarSize.width).toBe(SIDECAR_DEFAULT_SIZE.width + 16);
    expect(panelRight(s)).toBe(24);
    expect(keyDown(left, "ArrowRight")).toBe(true);
    expect(panelWidth(s)).toBe(SIDECAR_DEFAULT_SIZE.width);
    s.cleanup();
  });

  it("left 把手忽略纵向键；bottom 把手忽略横向键", async () => {
    const s = setup("open", true);
    await s.flush();
    const left = s.container.querySelector('[data-sidecar-resize-handle="left"]')!;
    const bottom = s.container.querySelector('[data-sidecar-resize-handle="bottom"]')!;
    expect(keyDown(left, "ArrowUp")).toBe(false);
    expect(panelWidth(s)).toBe(SIDECAR_DEFAULT_SIZE.width);
    expect(panelHeight(s)).toBe(SIDECAR_DEFAULT_SIZE.height);
    expect(keyDown(bottom, "ArrowLeft")).toBe(false);
    expect(panelWidth(s)).toBe(SIDECAR_DEFAULT_SIZE.width);
    s.cleanup();
  });

  it("bottom 把手：Shift+Down 加高 64；corner：Up 同调宽高", async () => {
    const s = setup("open", true);
    await s.flush();
    const bottom = s.container.querySelector('[data-sidecar-resize-handle="bottom"]')!;
    expect(keyDown(bottom, "ArrowDown", true)).toBe(true);
    // 760 + 64 = 824（上限 900-48=852 内）
    expect(panelHeight(s)).toBe(SIDECAR_DEFAULT_SIZE.height + 64);
    const corner = s.container.querySelector('[data-sidecar-resize-handle="corner"]')!;
    expect(keyDown(corner, "ArrowUp")).toBe(true);
    expect(panelHeight(s)).toBe(SIDECAR_DEFAULT_SIZE.height + 64 - 16);
    // corner Up 只调高度，宽度不变
    expect(panelWidth(s)).toBe(SIDECAR_DEFAULT_SIZE.width);
    s.cleanup();
  });

  it("move 把手：Left 左移 24（right 24→48）持久化；Shift+Down 受底边 clamp", async () => {
    const s = setup("open", true);
    await s.flush();
    const move = s.container.querySelector('[data-testid="kiro-sidecar-move-handle"]')!;
    expect(keyDown(move, "ArrowLeft")).toBe(true);
    expect(panelRight(s)).toBe(48);
    expect(panelTop(s)).toBe(SIDECAR_VIEWPORT_TOP_MARGIN);
    expect(useKiroPreferencesStore.getState().sidecarPosition).toEqual({ top: 40, right: 48 });
    expect(keyDown(move, "ArrowDown", true)).toBe(true);
    // 40 + 96 = 136 会越底边（136+760 > 900-24）→ clamp 到 maxTop = 900-760-24 = 116
    expect(panelTop(s)).toBe(900 - SIDECAR_DEFAULT_SIZE.height - 24);
    expect(useKiroPreferencesStore.getState().sidecarPosition.top).toBe(900 - SIDECAR_DEFAULT_SIZE.height - 24);
    s.cleanup();
  });

  it("move 把手聚焦时 pill 显现（键盘用户可见）", async () => {
    const s = setup("open", true);
    await s.flush();
    const move = s.container.querySelector('[data-testid="kiro-sidecar-move-handle"]') as HTMLElement;
    const pill = move.firstElementChild as HTMLElement;
    expect(pill.className).toContain("opacity-0");
    act(() => {
      move.focus();
    });
    expect(pill.className).toContain("opacity-100");
    s.cleanup();
  });

  it("S6-3 <768 策略：resize/move 把手 hidden md:block（全屏下无几何手势）", async () => {
    const s = setup("open", true);
    await s.flush();
    const move = s.container.querySelector('[data-testid="kiro-sidecar-move-handle"]')!;
    expect(move.className).toContain("hidden");
    expect(move.className).toContain("md:block");
    for (const pos of ["left", "bottom", "corner"]) {
      const h = s.container.querySelector(`[data-sidecar-resize-handle="${pos}"]`)!;
      expect(h.className).toContain("hidden");
      expect(h.className).toContain("md:block");
    }
    s.cleanup();
  });
});
