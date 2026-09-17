/**
 * @vitest-environment jsdom
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { CommandCenter } from "@/components/command/CommandCenter";
import { KiroSessionProvider } from "@/components/kiro/KiroSessionProvider";
import { useAppStore } from "@/store/useAppStore";

if (typeof globalThis.ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof window !== "undefined" && !window.matchMedia) {
  (window as unknown as Record<string, unknown>).matchMedia = () => ({
    matches: false,
    media: "",
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

afterEach(() => cleanup());

function openPalette() {
  useAppStore.setState({ isSearchModalOpen: true, searchModalView: "palette" });
  render(
    <KiroSessionProvider>
      <CommandCenter />
    </KiroSessionProvider>
  );
  const input = screen.getByLabelText("命令中心搜索") as HTMLInputElement;
  return { input };
}

function activeId(): string | null {
  return screen.getByLabelText("命令中心搜索").getAttribute("aria-activedescendant");
}

describe("命令面板 combobox 语义与键盘导航", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("input 为 combobox：expanded/controls/activedescendant + listbox/option 角色", () => {
    openPalette();
    const input = screen.getByLabelText("命令中心搜索");
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-controls")).toBe("command-results-listbox");
    const listbox = screen.getByTestId("command-results");
    expect(listbox.getAttribute("role")).toBe("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options.length).toBeGreaterThan(1);
    expect(options[0].id).toBe("command-option-0");
    // 初始高亮首项
    expect(activeId()).toBe("command-option-0");
    expect(options[0].getAttribute("aria-selected")).toBe("true");
  });

  it("ArrowDown/Up 移动高亮；Home/End 跳转；PageUp/PageDown 步进", () => {
    const { input } = openPalette();
    const count = within(screen.getByTestId("command-results")).getAllByRole("option").length;
    expect(count).toBeGreaterThan(2);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(activeId()).toBe("command-option-1");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(activeId()).toBe("command-option-0");

    fireEvent.keyDown(input, { key: "End" });
    expect(activeId()).toBe(`command-option-${count - 1}`);
    fireEvent.keyDown(input, { key: "Home" });
    expect(activeId()).toBe("command-option-0");

    fireEvent.keyDown(input, { key: "PageDown" });
    expect(activeId()).toBe(`command-option-${Math.min(5, count - 1)}`);
    fireEvent.keyDown(input, { key: "PageUp" });
    expect(activeId()).toBe("command-option-0");
  });

  it("键盘导航后 hover 不抢占；真实指针移动后恢复跟随", () => {
    const { input } = openPalette();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(activeId()).toBe("command-option-1");

    const options = () => within(screen.getByTestId("command-results")).getAllByRole("option");
    // 键盘滚动把行送到鼠标下（只有 mouseenter，无 pointermove）：高亮不变
    fireEvent.mouseEnter(options()[3]);
    expect(activeId()).toBe("command-option-1");
    // 真实指针移动后：hover 跟随恢复
    fireEvent.pointerMove(options()[3]);
    fireEvent.mouseEnter(options()[3]);
    expect(activeId()).toBe("command-option-3");
  });

  it("结果数通过 aria-live 公告", () => {
    openPalette();
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toMatch(/共 \d+ 个结果/);
  });
});
