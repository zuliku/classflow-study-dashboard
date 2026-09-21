// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

// Polyfills（jsdom）
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
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

import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { CommandCenter } from "@/components/command/CommandCenter";
import { WorkspaceSearchButton } from "@/components/layout/WorkspaceSearchButton";
import { OverlayBoundary } from "@/components/ui/OverlayBoundary";
import { SETTINGS_REGISTRY, SETTING_IDS } from "@/lib/settingsRegistry";

function Boom(): React.ReactElement {
  throw new Error("overlay boom");
}

describe("全局搜索（CommandCenter）隔离：Kiro Provider 缺失也不白屏", () => {
  beforeEach(() => {
    cleanup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    useToastStore.setState({ toasts: [] } as never);
    useAppStore.setState({ isSearchModalOpen: true } as never);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useAppStore.setState({ isSearchModalOpen: false } as never);
  });

  it("无 KiroSessionProvider 时仍能渲染并交互（不抛 useKiroSession 错误）", () => {
    expect(() => render(<CommandCenter />)).not.toThrow();
    expect(screen.getByTestId("command-center")).toBeTruthy();
  });

  it("关闭 → 打开 的 mounted 过渡不改变 Hook 顺序（回归：Rendered more hooks…）", async () => {
    // 应用启动时命令面板是常驻挂载 + 关闭态（early return）；点击搜索才 mounted=true。
    useAppStore.setState({ isSearchModalOpen: false } as never);
    render(<CommandCenter />);
    expect(screen.queryByTestId("command-center")).toBeNull();
    await act(async () => {
      useAppStore.setState({ isSearchModalOpen: true } as never);
      await Promise.resolve();
    });
    expect(screen.getByTestId("command-center")).toBeTruthy();
    // 再关闭一次（presence 退出）不应报错
    await act(async () => {
      useAppStore.setState({ isSearchModalOpen: false } as never);
      await Promise.resolve();
    });
  });

  it("无 Kiro Provider 时点击「交给 Kiro」→ 友好提示而非崩溃", () => {
    render(<CommandCenter />);
    const input = screen.getByPlaceholderText("搜索命令、课程、任务、资料…") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "帮我规划今天" } });
    const kiroRow = screen.getByText("交给 Kiro").closest("button");
    expect(kiroRow).toBeTruthy();
    fireEvent.click(kiroRow!);
    expect(useToastStore.getState().toasts.some((t) => t.message.includes("Kiro 尚未就绪"))).toBe(true);
  });

  it("点击顶部「搜索」按钮 → 命令面板真实打开（全局搜索入口可用）", async () => {
    useAppStore.setState({ isSearchModalOpen: false } as never);
    render(
      <OverlayBoundary name="command-center">
        <WorkspaceSearchButton />
        <CommandCenter />
      </OverlayBoundary>
    );
    expect(screen.queryByTestId("command-center")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "全局搜索" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("command-center")).toBeTruthy();
  });
});

describe("OverlayBoundary：单个面板崩溃不影响应用", () => {
  beforeEach(() => {
    cleanup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    useToastStore.setState({ toasts: [] } as never);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("子组件抛错 → 只卸载该 Overlay，并提示可重试", () => {
    const { container } = render(
      <OverlayBoundary name="test-overlay">
        <Boom />
      </OverlayBoundary>
    );
    expect(container.firstChild).toBeNull();
    expect(useToastStore.getState().toasts.some((t) => t.message.includes("暂时无法打开"))).toBe(true);
  });

  it("正常子组件原样渲染", () => {
    render(
      <OverlayBoundary name="ok">
        <div data-testid="ok-child">ok</div>
      </OverlayBoundary>
    );
    expect(screen.getByTestId("ok-child")).toBeTruthy();
  });

  it("崩溃后 children 变化且超过冷却 → 自动恢复（入口不会永久打不开）", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <OverlayBoundary name="recover">
        <Boom />
      </OverlayBoundary>
    );
    expect(screen.queryByTestId("recovered")).toBeNull();
    vi.advanceTimersByTime(1600);
    rerender(
      <OverlayBoundary name="recover">
        <div data-testid="recovered">ok</div>
      </OverlayBoundary>
    );
    expect(screen.getByTestId("recovered")).toBeTruthy();
    vi.useRealTimers();
  });
});

describe("Settings Registry ↔ 新增桌面开关对齐（防搜索死链）", () => {
  it("终端 / 桌面查看 / 桌面操作 三个开关均已登记", () => {
    const ids = new Set(SETTINGS_REGISTRY.map((s) => s.id));
    expect(ids.has(SETTING_IDS["kiro-agent"].terminal)).toBe(true);
    expect(ids.has(SETTING_IDS["kiro-agent"].desktopObserve)).toBe(true);
    expect(ids.has(SETTING_IDS["kiro-agent"].desktopAction)).toBe(true);
  });

  it("桌面开关为 conditional（仅桌面版渲染，不产生 Registry 漂移告警）", () => {
    const byId = new Map(SETTINGS_REGISTRY.map((s) => [s.id, s]));
    expect(byId.get(SETTING_IDS["kiro-agent"].desktopObserve)?.conditional).toBe(true);
    expect(byId.get(SETTING_IDS["kiro-agent"].desktopAction)?.conditional).toBe(true);
    expect(byId.get(SETTING_IDS["kiro-agent"].terminal)?.conditional).toBeUndefined();
  });

  it("渠道卡片条目为 conditional（未配置渠道时搜索不出现死链）", () => {
    const byId = new Map(SETTINGS_REGISTRY.map((s) => [s.id, s]));
    expect(byId.get(SETTING_IDS.extensions.qqBot)?.conditional).toBe(true);
    expect(byId.get(SETTING_IDS.extensions.gmail)?.conditional).toBe(true);
    expect(byId.get(SETTING_IDS.extensions.qqMail)?.conditional).toBe(true);
  });
});
