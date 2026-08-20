// @vitest-environment jsdom
/**
 * Kiro Sidecar Minimize & Capsule — 关键回归测试
 * - Single Mount（open ↔ minimized 不卸载）
 * - Hidden Full Shell（minimized 时 aria-hidden + inert）
 * - Capsule Interaction（restore / close / drag threshold）
 * - Responsive（minimize 按钮仅 md+，<md 自动恢复）
 * - Streaming Semantics（minimize 不 stop）
 */
import React, { useEffect } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { KiroSidecarShell } from "@/components/kiro/sidecar/KiroSidecarShell";
import { KiroSidecarMinimized } from "@/components/kiro/sidecar/KiroSidecarMinimized";
import { useKiroPreferencesStore } from "@/store/useKiroPreferencesStore";
import { DEFAULT_SIDECAR_MINIMIZED_POSITION } from "@/lib/ai/ui/sidecarMinimizedPosition";
import { SIDECAR_DEFAULT_SIZE } from "@/lib/ai/ui/sidecarSize";

const mocks = vi.hoisted(() => ({
  closeSidecar: vi.fn(),
  expandSidecar: vi.fn(),
  minimizeSidecar: vi.fn(),
  restoreSidecar: vi.fn(),
  kiroBusy: false,
}));

vi.mock("@/components/kiro/KiroSessionProvider", () => ({
  useKiroSession: () => ({
    closeSidecar: mocks.closeSidecar,
    expandSidecar: mocks.expandSidecar,
    minimizeSidecar: mocks.minimizeSidecar,
    restoreSidecar: mocks.restoreSidecar,
  }),
  useKiroSessionMeta: () => ({
    kiroBusy: mocks.kiroBusy,
    sidecarMode: "open",
  }),
  useKiroSessionActions: () => ({
    closeSidecar: mocks.closeSidecar,
    restoreSidecar: mocks.restoreSidecar,
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

function setupShell(mode: "open" | "minimized" | "closed", present = true, Child?: React.ComponentType) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const Probe = Child ?? (() => <div data-testid="probe" />);
  act(() => {
    root.render(<KiroSidecarShell mode={mode} present={present}><Probe /></KiroSidecarShell>);
  });
  const shell = () => container.querySelector('[data-testid="kiro-sidecar"]') as HTMLElement | null;
  const cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return { container, shell, root, cleanup };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.kiroBusy = false;
  useKiroPreferencesStore.setState({ sidecarSize: SIDECAR_DEFAULT_SIZE });
  useKiroPreferencesStore.setState({ sidecarPosition: { top: 24, right: 24 } });
  useKiroPreferencesStore.setState({ sidecarMinimizedPosition: DEFAULT_SIDECAR_MINIMIZED_POSITION });
});

describe("Single Mount — open ↔ minimized 不卸载 ChatSurface", () => {
  it("open → minimized → open：probe 仅 mount 一次，未 unmount", async () => {
    let mountCount = 0;
    let unmountCount = 0;
    function Probe() {
      useEffect(() => {
        mountCount++;
        return () => unmountCount++;
      }, []);
      return <div data-testid="probe" />;
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });

    act(() => {
      root.render(<KiroSidecarShell mode="open" present={true}><Probe /></KiroSidecarShell>);
    });
    await act(async () => { await Promise.resolve(); });
    expect(mountCount).toBe(1);
    expect(unmountCount).toBe(0);

    act(() => {
      root.render(<KiroSidecarShell mode="minimized" present={true}><Probe /></KiroSidecarShell>);
    });
    await act(async () => { await Promise.resolve(); });
    expect(mountCount).toBe(1);
    expect(unmountCount).toBe(0);
    // 此时 shell 应为 aria-hidden + inert
    const shell = container.querySelector('[data-testid="kiro-sidecar"]') as HTMLElement;
    expect(shell.getAttribute("aria-hidden")).toBe("true");
    expect(shell.hasAttribute("inert")).toBe(true);

    act(() => {
      root.render(<KiroSidecarShell mode="open" present={true}><Probe /></KiroSidecarShell>);
    });
    await act(async () => { await Promise.resolve(); });
    expect(mountCount).toBe(1);
    expect(unmountCount).toBe(0);

    // closed  present=false 时 Shell 保持 hidden（host 负责 160ms 后卸载，Shell 单独不卸载）
    act(() => {
      root.render(<KiroSidecarShell mode="closed" present={false}><Probe /></KiroSidecarShell>);
    });
    await act(async () => { await Promise.resolve(); });
    const closedShell = container.querySelector('[data-testid="kiro-sidecar"]') as HTMLElement;
    expect(closedShell).toBeTruthy();
    expect(closedShell.getAttribute("aria-hidden")).toBe("true");
    expect(closedShell.hasAttribute("inert")).toBe(true);
    // Probe 仍 mounted（Shell 未卸载）
    expect(unmountCount).toBe(0);

    act(() => root.unmount());
    container.remove();
  });
});

describe("Hidden Full Shell — minimized 时不可交互", () => {
  it("minimized：aria-hidden true + inert + pointer-events-none", async () => {
    const { shell, cleanup } = setupShell("minimized", true);
    await act(async () => { await Promise.resolve(); });
    const el = shell();
    expect(el).toBeTruthy();
    expect(el!.getAttribute("aria-hidden")).toBe("true");
    expect(el!.hasAttribute("inert")).toBe(true);
    expect(el!.className).toContain("pointer-events-none");
    expect(el!.className).toContain("opacity-0");
    cleanup();
  });

  it("open：aria-hidden false 且可交互", async () => {
    const { shell, cleanup } = setupShell("open", true);
    await act(async () => { await Promise.resolve(); });
    const el = shell();
    expect(el!.getAttribute("aria-hidden")).toBe("false");
    expect(el!.hasAttribute("inert")).toBe(false);
    expect(el!.className).toContain("opacity-100");
    cleanup();
  });
});

describe("Capsule Interaction", () => {
  function setupCapsule(visible = true) {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<KiroSidecarMinimized visible={visible} />);
    });
    const capsule = () => container.querySelector('[data-testid="kiro-sidecar-capsule"]') as HTMLElement | null;
    const restoreBtn = () => container.querySelector('[aria-label="恢复 Kiro"]') as HTMLElement | null;
    const closeBtn = () => container.querySelector('[aria-label="关闭 Kiro"]') as HTMLElement | null;
    const cleanup = () => {
      act(() => root.unmount());
      container.remove();
    };
    return { container, capsule, restoreBtn, closeBtn, root, cleanup };
  }

  it("点击 restore 区域 → restoreSidecar()", async () => {
    const s = setupCapsule(true);
    await act(async () => { await Promise.resolve(); });
    expect(s.capsule()).toBeTruthy();
    act(() => s.restoreBtn()!.click());
    expect(mocks.restoreSidecar).toHaveBeenCalledTimes(1);
    expect(mocks.closeSidecar).toHaveBeenCalledTimes(0);
    s.cleanup();
  });

  it("点击 Close → closeSidecar() 且不触发 restore", async () => {
    const s = setupCapsule(true);
    await act(async () => { await Promise.resolve(); });
    act(() => s.closeBtn()!.click());
    expect(mocks.closeSidecar).toHaveBeenCalledTimes(1);
    expect(mocks.restoreSidecar).toHaveBeenCalledTimes(0);
    s.cleanup();
  });

  it("Drag：pointerdown → move > threshold → pointerup → 持久化一次且不 restore", async () => {
    const s = setupCapsule(true);
    await act(async () => { await Promise.resolve(); });
    const capsule = s.capsule()!;
    // 初始位置 24,24
    expect(useKiroPreferencesStore.getState().sidecarMinimizedPosition).toEqual({ right: 24, bottom: 24 });
    act(() => {
      capsule.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 100, pointerId: 1 }));
    });
    act(() => {
      // 向左拖 20px（dx -20）→ right = 24 - (-20) = 44 (>24，不被 clamp)
      capsule.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 80, clientY: 100, pointerId: 1 }));
    });
    act(() => {
      capsule.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 80, clientY: 100, pointerId: 1 }));
    });
    // 超过阈值 5，应只持久化一次，且不 restore
    expect(useKiroPreferencesStore.getState().sidecarMinimizedPosition.right).not.toBe(24);
    expect(useKiroPreferencesStore.getState().sidecarMinimizedPosition.right).toBeGreaterThan(24);
    expect(mocks.restoreSidecar).toHaveBeenCalledTimes(0);
    s.cleanup();
  });

  it("小移动（< threshold）→ 视为 click，恢复", async () => {
    const s = setupCapsule(true);
    await act(async () => { await Promise.resolve(); });
    const capsule = s.capsule()!;
    act(() => {
      capsule.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 100, pointerId: 1 }));
    });
    act(() => {
      capsule.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 102, clientY: 101, pointerId: 1 }));
    });
    act(() => {
      capsule.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 102, clientY: 101, pointerId: 1 }));
    });
    // 未超过阈值，不持久化位置，且 click 会触发 restore（通过 pointerup 后的 click 模拟）
    // 我们的实现中 pointerup 未拖拽不会持久化，但 click 会触发 restore；这里 pointerup 本身不 restore，click 才 restore
    // 为模拟 click，额外 dispatch click
    act(() => {
      const btn = s.restoreBtn()!;
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(mocks.restoreSidecar).toHaveBeenCalledTimes(1);
    s.cleanup();
  });

  it("Capsule busy 状态：kiroBusy true 显示“正在处理”，false 不显示", async () => {
    mocks.kiroBusy = true;
    const s1 = setupCapsule(true);
    await act(async () => { await Promise.resolve(); });
    expect(s1.container.textContent).toContain("正在处理");
    s1.cleanup();
    mocks.kiroBusy = false;
    const s2 = setupCapsule(true);
    await act(async () => { await Promise.resolve(); });
    expect(s2.container.textContent).not.toContain("正在处理");
    s2.cleanup();
  });
});

describe("Minimize 按钮响应式", () => {
  it("md+ 可见（hidden md:flex），<md 隐藏", async () => {
    const { shell, cleanup } = setupShell("open", true);
    await act(async () => { await Promise.resolve(); });
    const btn = shell()!.querySelector('[data-testid="kiro-sidecar-minimize"]') as HTMLElement;
    expect(btn).toBeTruthy();
    expect(btn.className).toContain("hidden");
    expect(btn.className).toContain("md:flex");
    cleanup();
  });
});

describe("Streaming Semantics — minimize 不 stop (Provider invariant)", () => {
  it("minimizeSidecar 仅 setSidecarMode('minimized')，不调用 stop/newChat/clear", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const file = path.resolve(process.cwd(), "components/kiro/KiroSessionProvider.tsx");
    const content = fs.readFileSync(file, "utf-8");
    const start = content.indexOf("const minimizeSidecar");
    const block = content.slice(start, start + 800);
    expect(block).toContain('setSidecarMode("minimized")');
    expect(block).not.toContain("stop(");
    expect(block).not.toContain("newChat");
    expect(block).not.toContain("clear(");
    expect(block).not.toContain("requestConversationTransition");
  });

  it("restoreSidecar 仅 setSidecarMode('open')", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const file = path.resolve(process.cwd(), "components/kiro/KiroSessionProvider.tsx");
    const content = fs.readFileSync(file, "utf-8");
    const start = content.indexOf("const restoreSidecar");
    const block = content.slice(start, start + 400);
    expect(block).toContain('setSidecarMode("open")');
  });
});
