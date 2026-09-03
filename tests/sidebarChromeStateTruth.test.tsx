// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { GeneralSettings } from "@/components/settings/GeneralSettings";
import { useUIChromeStore } from "@/store/useUIChromeStore";

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
 * V5A5：GeneralSettings 侧栏行绑定 useUIChromeStore 同一 truth。
 * Settings Switch 与 Sidebar collapse control 操作同一 state（源码级已验证双方均订阅
 * useUIChromeStore；此处验证 Settings 侧的文案真实性与即时同步）。
 */
describe("V5A5：GeneralSettings 侧栏行绑定同一 truth", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("row 存在且文案真实（无“默认收起”承诺），Switch 直连 useUIChromeStore", async () => {
    act(() => {
      useUIChromeStore.setState({ sidebarCollapsed: false });
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<GeneralSettings />);
    });
    try {
      const row = container.querySelector('[data-setting-id="sidebar-default-collapsed"]');
      expect(row).toBeTruthy();
      expect(row?.textContent).toContain("侧栏收起状态");
      expect(row?.textContent).not.toContain("默认收起侧栏");
      expect(row?.textContent).not.toContain("下次打开时默认收起");
      const toggle = row?.querySelector('button[role="switch"]');
      expect(toggle?.getAttribute("aria-label")).toBe("侧栏收起状态");
      expect(toggle?.getAttribute("aria-checked")).toBe("false");
      // 点击 Switch → 同一 store 立即翻转（Settings 与 Sidebar 共享，无双 state）
      await act(async () => {
        (toggle as HTMLButtonElement).click();
      });
      expect(useUIChromeStore.getState().sidebarCollapsed).toBe(true);
      expect(
        container
          .querySelector('[data-setting-id="sidebar-default-collapsed"] button[role="switch"]')
          ?.getAttribute("aria-checked")
      ).toBe("true");
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
