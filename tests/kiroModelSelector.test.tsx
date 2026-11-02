// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { KiroModelSelector, type KiroModelOption } from "@/components/kiro/composer/KiroModelSelector";

/**
 * Kiro Model Selector（玻璃面板）行为契约：
 * - 打开后 Portal 面板可见，带 glass 材质 class，无原生 title；
 * - 搜索过滤 + Enter 选择；
 * - Escape / 外部点击关闭；
 * - Dark appearance 作为面板作用域。
 * 视觉动画由 Playwright E2E（tests/e2e/model-selector-glass.spec.ts）覆盖。
 */

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
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const MODELS: KiroModelOption[] = [
  { value: "gpt-5.6-sol", label: "GPT-5.6 Sol", vendor: "openai" },
  { value: "claude-x", label: "Claude X", vendor: "anthropic" },
  { value: "gemini-4-argon", label: "Gemini 4 Argon", vendor: "google" },
];

function panel(): HTMLElement | null {
  return document.querySelector('[data-testid="kiro-composer-model-menu"]');
}

function trigger(): HTMLButtonElement {
  return document.querySelector('[data-testid="kiro-composer-model"]') as HTMLButtonElement;
}

function renderSelector(overrides: Partial<React.ComponentProps<typeof KiroModelSelector>> = {}) {
  return render(
    <KiroModelSelector
      modelOptions={MODELS}
      selectedModelId="gpt-5.6-sol"
      activeModelName="GPT-5.6 Sol"
      activeModelVendor="openai"
      onSelectModel={vi.fn()}
      onOpenSettings={vi.fn()}
      {...overrides}
    />
  );
}

afterEach(() => {
  cleanup();
});

describe("KiroModelSelector", () => {
  it("打开：Portal 玻璃面板 + 选中态；无原生 title", async () => {
    renderSelector();
    fireEvent.click(trigger());
    await waitFor(() => expect(panel()).toBeTruthy());

    const menu = panel()!;
    expect(menu.className).toContain("kiro-model-glass");
    expect(menu.getAttribute("data-appearance")).toBe("light");
    expect(menu.querySelectorAll('[role="menuitemradio"]')).toHaveLength(3);
    expect(menu.querySelector('[role="menuitemradio"][aria-checked="true"]')?.textContent).toContain(
      "GPT-5.6 Sol"
    );
    expect(menu.querySelector("[title]")).toBeNull();
    expect(menu.textContent).toContain("模型");
  });

  it("搜索过滤 + Enter 选择；触发按钮 not title-only", async () => {
    const onSelectModel = vi.fn();
    renderSelector({ onSelectModel });
    fireEvent.click(trigger());
    await waitFor(() => expect(panel()).toBeTruthy());

    const input = screen.getByLabelText("搜索模型");
    fireEvent.change(input, { target: { value: "claude" } });
    expect(panel()!.querySelectorAll('[role="menuitemradio"]')).toHaveLength(1);
    expect(panel()!.textContent).toContain("Claude X");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelectModel).toHaveBeenCalledWith("claude-x");
  });

  it("Escape 与外部点击关闭（受控回调）", async () => {
    const onOpenChange = vi.fn();
    renderSelector({ open: true, onOpenChange });
    await waitFor(() => expect(panel()).toBeTruthy());

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);

    onOpenChange.mockClear();
    fireEvent.pointerDown(document.body);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Dark appearance 作用于面板（支持浅/深材质）", async () => {
    renderSelector({ open: true, appearance: "dark" });
    await waitFor(() => expect(panel()).toBeTruthy());
    expect(panel()!.getAttribute("data-appearance")).toBe("dark");
    expect(panel()!.className).toContain("kiro-model-glass");
  });
});
