// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { validateIpcSender } from "@/lib/security/ipcSender";

// Mock useAppStore for TitleBar semester display
vi.mock("@/store/useAppStore", () => ({
  useAppStore: (selector: (s: unknown) => unknown) => {
    const state = {
      semester: { name: "2026 春" },
      currentSemesterWeek: 3,
    };
    return selector(state);
  },
}));

// Import after mock
import { getClassFlowDesktopWindowBridge, getClassFlowDesktopExtras } from "@/lib/desktop/desktopExtras";
import { TitleBar } from "@/src/renderer/components/TitleBar";

function setWindowBridge(mock: Record<string, unknown> | undefined) {
  const w = window as unknown as { classflowDesktop?: unknown };
  if (mock === undefined) {
    delete w.classflowDesktop;
  } else {
    w.classflowDesktop = mock;
  }
}

describe("TitleBar Window Controls — Task 16B D", () => {
  beforeEach(() => {
    cleanup();
    setWindowBridge(undefined);
    vi.restoreAllMocks();
  });
  afterEach(() => {
    cleanup();
    setWindowBridge(undefined);
  });

  it("getClassFlowDesktopWindowBridge does not require apiBase", () => {
    const minimize = vi.fn();
    const toggleMaximize = vi.fn();
    const close = vi.fn();
    const isMaximized = vi.fn(async () => false);
    const onMaximizedChange = vi.fn(() => () => {});
    setWindowBridge({
      version: 1,
      window: { minimize, toggleMaximize, close, isMaximized, onMaximizedChange },
    } as unknown);
    // Without apiBase should still succeed
    const bridge = getClassFlowDesktopWindowBridge();
    expect(bridge).not.toBeNull();
    expect(bridge?.minimize).toBe(minimize);

    // getClassFlowDesktopExtras requires apiBase -> should be null without apiBase
    expect(getClassFlowDesktopExtras()).toBeNull();

    // With apiBase, extras succeeds but window bridge also succeeds
    setWindowBridge({
      version: 1,
      apiBase: "http://127.0.0.1:1234",
      window: { minimize, toggleMaximize, close, isMaximized, onMaximizedChange },
    } as unknown);
    expect(getClassFlowDesktopExtras()).not.toBeNull();
    expect(getClassFlowDesktopWindowBridge()).not.toBeNull();

    // Incomplete window surface -> null
    setWindowBridge({ version: 1, window: { minimize } } as unknown);
    expect(getClassFlowDesktopWindowBridge()).toBeNull();
  });

  it("click minimize calls bridge.minimize exactly once", async () => {
    const minimize = vi.fn();
    const toggleMaximize = vi.fn();
    const close = vi.fn();
    const isMaximized = vi.fn(async () => false);
    const onMaximizedChange = vi.fn(() => () => {});
    setWindowBridge({
      version: 1,
      window: { minimize, toggleMaximize, close, isMaximized, onMaximizedChange },
    } as unknown);
    render(<TitleBar />);
    const btn = screen.getByLabelText("最小化") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(minimize).toHaveBeenCalledTimes(1);
  });

  it("click maximize calls toggleMaximize exactly once", async () => {
    const minimize = vi.fn();
    const toggleMaximize = vi.fn();
    const close = vi.fn();
    const isMaximized = vi.fn(async () => false);
    const onMaximizedChange = vi.fn(() => () => {});
    setWindowBridge({
      version: 1,
      window: { minimize, toggleMaximize, close, isMaximized, onMaximizedChange },
    } as unknown);
    render(<TitleBar />);
    const btn = screen.getByLabelText("最大化") as HTMLButtonElement;
    fireEvent.click(btn);
    expect(toggleMaximize).toHaveBeenCalledTimes(1);
  });

  it("click close calls bridge.close exactly once", async () => {
    const minimize = vi.fn();
    const toggleMaximize = vi.fn();
    const close = vi.fn();
    const isMaximized = vi.fn(async () => false);
    const onMaximizedChange = vi.fn(() => () => {});
    setWindowBridge({
      version: 1,
      window: { minimize, toggleMaximize, close, isMaximized, onMaximizedChange },
    } as unknown);
    render(<TitleBar />);
    const btn = screen.getByLabelText("关闭") as HTMLButtonElement;
    fireEvent.click(btn);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("desktop runtime without window bridge disables buttons and warns once in dev", async () => {
    // Simulate desktop runtime with classflowDesktop but missing window
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    setWindowBridge({ version: 1, apiBase: "http://127.0.0.1:1234" } as unknown);
    const { rerender } = render(<TitleBar />);
    // Buttons should be disabled
    expect((screen.getByLabelText("最小化") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("最大化") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("关闭") as HTMLButtonElement).disabled).toBe(true);
    // Warning should have been called once
    expect(warnSpy).toHaveBeenCalledWith("[classflow] desktop window bridge unavailable");
    warnSpy.mockClear();
    // Re-render should not warn again
    rerender(<TitleBar />);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("security: trusted app:// sender can call window:* ; untrusted denied", () => {
    const allowed = validateIpcSender("window:minimize", { destroyed: false, isTrustedWindow: true, url: "app://bundle/index.html" }, { allowedApiOrigin: "http://127.0.0.1:1234" });
    expect(allowed.ok).toBe(true);
    const allowedMax = validateIpcSender("window:maximize", { destroyed: false, isTrustedWindow: true, url: "app://bundle/index.html" }, { allowedApiOrigin: "http://127.0.0.1:1234" });
    expect(allowedMax.ok).toBe(true);
    const allowedClose = validateIpcSender("window:close", { destroyed: false, isTrustedWindow: true, url: "app://bundle/index.html" }, { allowedApiOrigin: "http://127.0.0.1:1234" });
    expect(allowedClose.ok).toBe(true);
    const allowedIsMax = validateIpcSender("window:isMaximized", { destroyed: false, isTrustedWindow: true, url: "app://bundle/index.html" }, { allowedApiOrigin: "http://127.0.0.1:1234" });
    expect(allowedIsMax.ok).toBe(true);

    const deniedUntrusted = validateIpcSender("window:minimize", { destroyed: false, isTrustedWindow: false, url: "app://bundle/index.html" }, { allowedApiOrigin: "http://127.0.0.1:1234" });
    expect(deniedUntrusted.ok).toBe(false);
    const deniedEvilOrigin = validateIpcSender("window:minimize", { destroyed: false, isTrustedWindow: true, url: "https://evil.com" }, { allowedApiOrigin: "http://127.0.0.1:1234" });
    expect(deniedEvilOrigin.ok).toBe(false);
    const deniedDestroyed = validateIpcSender("window:minimize", { destroyed: true, isTrustedWindow: true, url: "app://bundle/index.html" }, { allowedApiOrigin: "http://127.0.0.1:1234" });
    expect(deniedDestroyed.ok).toBe(false);
  });
});
