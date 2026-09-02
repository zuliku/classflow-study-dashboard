// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { FocusControl } from "@/components/focus/FocusControl";
import { useAppStore } from "@/store/useAppStore";

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

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = async () => {
    await act(async () => {
      root.render(<FocusControl />);
    });
  };
  return { container, root, render };
}

describe("FocusControl default minutes wiring", () => {
  let harness: ReturnType<typeof setup>;
  beforeEach(async () => {
    localStorage.clear();
    // reset store to clean state
    const store = useAppStore.getState();
    // clear focusSessions
    useAppStore.setState({ focusSessions: [], preferences: { ...store.preferences, focusDefaultMinutes: 45 } });
    harness = setup();
    await harness.render();
  });
  afterEach(() => {
    act(() => harness.root.unmount());
    harness.container.remove();
  });

  it("首次打开 FocusControl picker 默认值为 45", async () => {
    const trigger = harness.container.querySelector('[data-testid="focus-control"]') as HTMLButtonElement;
    act(() => trigger.click());
    const input = harness.container.querySelector('input[aria-label="自定义专注时长（分钟）"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe("45");
  });

  it("已打开时改为 60，外部 preference 改成 15，不覆盖当前 draft", async () => {
    const trigger = harness.container.querySelector('[data-testid="focus-control"]') as HTMLButtonElement;
    act(() => trigger.click());
    const input = harness.container.querySelector('input[aria-label="自定义专注时长（分钟）"]') as HTMLInputElement;
    // 改成 60
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, "60");
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // 由于受控 input 的 onChange 使用 e.target.value，需要同时触发 input
    // 直接 set planned via UI: 点击 preset 60 if exists, else use input
    // 这里直接通过 store 外部修改 preference
    useAppStore.getState().updatePreferences({ focusDefaultMinutes: 15 });
    // 等待一帧，避免被外部更新覆盖
    await act(async () => {});
    const input2 = harness.container.querySelector('input[aria-label="自定义专注时长（分钟）"]') as HTMLInputElement;
    expect(input2.value).toBe("60");
  });

  it("关闭后重开读取最新 15", async () => {
    const trigger = harness.container.querySelector('[data-testid="focus-control"]') as HTMLButtonElement;
    act(() => trigger.click());
    let input = harness.container.querySelector('input[aria-label="自定义专注时长（分钟）"]') as HTMLInputElement;
    // 改成 60
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, "60");
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    useAppStore.getState().updatePreferences({ focusDefaultMinutes: 15 });
    // 关闭
    act(() => trigger.click());
    // 重开
    act(() => trigger.click());
    input = harness.container.querySelector('input[aria-label="自定义专注时长（分钟）"]') as HTMLInputElement;
    expect(input.value).toBe("15");
  });
});
