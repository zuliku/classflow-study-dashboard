// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { GeneralSettings } from "@/components/settings/GeneralSettings";

if (typeof (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof (window as unknown as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = (
    globalThis as unknown as { ResizeObserver: unknown }
  ).ResizeObserver;
}
if (!(window as unknown as { matchMedia?: unknown }).matchMedia) {
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

/**
 * V5A5：侧栏控制唯一事实来源是 Sidebar 自身（useUIChromeStore）。
 * Settings 不再渲染重复的「侧栏收起状态」行，避免同一 state 两个入口。
 */
describe("V5A5：GeneralSettings 不再重复侧栏控制", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("不存在 sidebar-default-collapsed 设置行", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<GeneralSettings />);
    });
    try {
      expect(
        container.querySelector('[data-setting-id="sidebar-default-collapsed"]')
      ).toBeNull();
      expect(container.textContent).not.toContain("侧栏收起状态");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
