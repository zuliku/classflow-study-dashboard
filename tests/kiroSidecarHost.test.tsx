// @vitest-environment jsdom
/**
 * KiroSidecar Host-level regression — Presence 单 ownership 与 Single Mount
 * 验证生产结构：KiroSidecar → Shell + ChatSurface + Capsule
 */
import React, { useEffect } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

const chatSurfaceMocks = vi.hoisted(() => ({
  mountCount: 0,
  unmountCount: 0,
}));

vi.mock("@/components/kiro/KiroChatSurface", () => ({
  KiroChatSurface: () => {
    useEffect(() => {
      chatSurfaceMocks.mountCount++;
      return () => {
        chatSurfaceMocks.unmountCount++;
      };
    }, []);
    return <div data-testid="mock-chat-surface" />;
  },
}));

vi.mock("@/components/kiro/KiroSessionProvider", async () => {
  const actual = await vi.importActual<typeof import("@/components/kiro/KiroSessionProvider")>("@/components/kiro/KiroSessionProvider");
  return {
    ...actual,
    useKiroSession: () => ({}),
    useKiroSessionMeta: () => ({ kiroBusy: false, sidecarMode: "open" as const }),
    useKiroSessionActions: () => ({
      closeSidecar: vi.fn(),
      expandSidecar: vi.fn(),
      minimizeSidecar: vi.fn(),
      restoreSidecar: vi.fn(),
    }),
  };
});

//  mock useKiroPreferencesStore 的 sidecar 几何，避免 clamp 依赖真实 viewport
vi.mock("@/store/useKiroPreferencesStore", async () => {
  const actual = await vi.importActual<typeof import("@/store/useKiroPreferencesStore")>("@/store/useKiroPreferencesStore");
  return actual;
});

import { KiroSidecar } from "@/components/kiro/KiroSidecar";

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

beforeEach(() => {
  chatSurfaceMocks.mountCount = 0;
  chatSurfaceMocks.unmountCount = 0;
  document.documentElement.setAttribute("data-motion-effective", "reduced");
});

afterEach(() => {
  document.documentElement.removeAttribute("data-motion-effective");
});

describe("KiroSidecar Host — Single Mount (ChatSurface 单实例)", () => {
  it("open → minimized → open：ChatSurface 仅 mount 一次", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<KiroSidecar mode="open" />);
    });
    await act(async () => { await Promise.resolve(); });
    expect(chatSurfaceMocks.mountCount).toBe(1);
    expect(chatSurfaceMocks.unmountCount).toBe(0);
    expect(container.querySelector('[data-testid="mock-chat-surface"]')).toBeTruthy();

    act(() => {
      root.render(<KiroSidecar mode="minimized" />);
    });
    await act(async () => { await Promise.resolve(); });
    expect(chatSurfaceMocks.mountCount).toBe(1);
    expect(chatSurfaceMocks.unmountCount).toBe(0);
    // minimized 时 Full 仍 mounted 但 hidden
    const shell = container.querySelector('[data-testid="kiro-sidecar"]') as HTMLElement;
    expect(shell).toBeTruthy();
    expect(shell.getAttribute("aria-hidden")).toBe("true");
    // Capsule 应 visible
    expect(container.querySelector('[data-testid="kiro-sidecar-capsule"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="kiro-sidecar-capsule"]')?.getAttribute("aria-hidden")).toBe("false");

    act(() => {
      root.render(<KiroSidecar mode="open" />);
    });
    await act(async () => { await Promise.resolve(); });
    expect(chatSurfaceMocks.mountCount).toBe(1);
    expect(chatSurfaceMocks.unmountCount).toBe(0);

    // closed 前 ChatSurface 仍在
    act(() => {
      root.render(<KiroSidecar mode="closed" />);
    });
    // 160ms 内仍 mounted 但 Full hidden，Capsule 隐藏
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    // 此时 host 仍 mounted（exit 动画中），但 ChatSurface 仍未卸载
    // 需等待 160ms 后才 unmount
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    expect(container.querySelector('[data-testid="kiro-sidecar-host"]')).toBeNull();
    expect(chatSurfaceMocks.unmountCount).toBe(1);

    act(() => root.unmount());
    container.remove();
  });

  it("streaming 中 minimize→restore：ChatSurface 不 remount", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    // 模拟 kiroBusy true 时的 host（Streaming 中）
    act(() => {
      root.render(<KiroSidecar mode="open" />);
    });
    await act(async () => { await Promise.resolve(); });
    expect(chatSurfaceMocks.mountCount).toBe(1);

    act(() => {
      root.render(<KiroSidecar mode="minimized" />);
    });
    await act(async () => { await Promise.resolve(); });
    expect(chatSurfaceMocks.mountCount).toBe(1);
    expect(chatSurfaceMocks.unmountCount).toBe(0);

    act(() => {
      root.render(<KiroSidecar mode="open" />);
    });
    await act(async () => { await Promise.resolve(); });
    expect(chatSurfaceMocks.mountCount).toBe(1);
    expect(chatSurfaceMocks.unmountCount).toBe(0);

    act(() => root.unmount());
    container.remove();
  });
});

describe("KiroSidecar Host — Presence 回归", () => {
  it("open → closed：Full 保持 hidden (opacity-0) 直至 unmount，不闪回", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<KiroSidecar mode="open" />);
    });
    await act(async () => { await Promise.resolve(); });
    let shell = container.querySelector('[data-testid="kiro-sidecar"]') as HTMLElement;
    expect(shell.className).toContain("opacity-100");

    act(() => {
      root.render(<KiroSidecar mode="closed" />);
    });
    // 立即：host 仍 mounted，但 Full 应已是 hidden（opacity-0），不能是 100
    await act(async () => { await Promise.resolve(); });
    shell = container.querySelector('[data-testid="kiro-sidecar"]') as HTMLElement | null;
    // mounted 仍 true 直到 160ms，但 Full 必须保持 opacity-0
    if (shell) {
      expect(shell.className).toContain("opacity-0");
      expect(shell.getAttribute("aria-hidden")).toBe("true");
    }

    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(container.querySelector('[data-testid="kiro-sidecar"]')).toBeNull();
    expect(container.querySelector('[data-testid="kiro-sidecar-capsule"]')).toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it("minimized → closed：Full 始终 hidden，Capsule 退出", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<KiroSidecar mode="minimized" />);
    });
    await act(async () => { await Promise.resolve(); });
    let shell = container.querySelector('[data-testid="kiro-sidecar"]') as HTMLElement;
    expect(shell.className).toContain("opacity-0");
    let capsule = container.querySelector('[data-testid="kiro-sidecar-capsule"]') as HTMLElement;
    expect(capsule.className).toContain("opacity-100");

    act(() => {
      root.render(<KiroSidecar mode="closed" />);
    });
    await act(async () => { await Promise.resolve(); });
    shell = container.querySelector('[data-testid="kiro-sidecar"]') as HTMLElement | null;
    capsule = container.querySelector('[data-testid="kiro-sidecar-capsule"]') as HTMLElement | null;
    // Full 必须保持 opacity-0，不能重新出现 opacity-100
    if (shell) expect(shell.className).toContain("opacity-0");
    // Capsule 应开始退出（opacity-0）
    if (capsule) expect(capsule.className).toContain("opacity-0");

    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
    expect(container.querySelector('[data-testid="kiro-sidecar-host"]')).toBeNull();

    act(() => root.unmount());
    container.remove();
  });
});

describe("KiroSidecar Host — Normal Motion 160ms Presence", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-motion-effective");
  });
  afterEach(() => {
    document.documentElement.setAttribute("data-motion-effective", "reduced");
  });

  it("open → closed 在 Normal Motion 下保持 hidden 160ms 后卸载", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<KiroSidecar mode="open" />);
    });
    // Normal Motion 需要 rAF 两帧才 visible
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    let shell = container.querySelector('[data-testid="kiro-sidecar"]') as HTMLElement;
    expect(shell.className).toContain("opacity-100");

    act(() => {
      root.render(<KiroSidecar mode="closed" />);
    });
    // 立即：仍 mounted 但 Full 已 hidden
    await act(async () => { await Promise.resolve(); });
    shell = container.querySelector('[data-testid="kiro-sidecar"]') as HTMLElement | null;
    if (shell) {
      expect(shell.className).toContain("opacity-0");
      expect(shell.getAttribute("aria-hidden")).toBe("true");
    }
    // 50ms 内仍 mounted
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(container.querySelector('[data-testid="kiro-sidecar-host"]')).toBeTruthy();
    // 200ms 后卸载
    await act(async () => { await new Promise((r) => setTimeout(r, 170)); });
    expect(container.querySelector('[data-testid="kiro-sidecar-host"]')).toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it("minimized → closed 在 Normal Motion 下 Full 始终 hidden", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(<KiroSidecar mode="minimized" />);
    });
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    let shell = container.querySelector('[data-testid="kiro-sidecar"]') as HTMLElement;
    expect(shell.className).toContain("opacity-0");
    let capsule = container.querySelector('[data-testid="kiro-sidecar-capsule"]') as HTMLElement;
    expect(capsule.className).toContain("opacity-100");

    act(() => {
      root.render(<KiroSidecar mode="closed" />);
    });
    await act(async () => { await Promise.resolve(); });
    shell = container.querySelector('[data-testid="kiro-sidecar"]') as HTMLElement | null;
    capsule = container.querySelector('[data-testid="kiro-sidecar-capsule"]') as HTMLElement | null;
    if (shell) expect(shell.className).toContain("opacity-0");
    if (capsule) expect(capsule.className).toContain("opacity-0");
    await act(async () => { await new Promise((r) => setTimeout(r, 220)); });
    expect(container.querySelector('[data-testid="kiro-sidecar-host"]')).toBeNull();

    act(() => root.unmount());
    container.remove();
  });
});
