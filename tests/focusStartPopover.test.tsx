// @vitest-environment jsdom
/**
 * FocusStartPopover（Task Execution Loop V1.1 + V5A1）picker 行为：
 * 默认值来自 preferences.focusDefaultMinutes；已打开 session 不被外部 preference 覆盖；关闭重开读取最新。
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { FocusStartPopover } from "@/components/focus/FocusStartPopover";
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

/** React 受控 input：必须经原生 value setter 赋值再派发 input 事件 */
function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function presetButton(container: HTMLElement, label: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === label
  );
  if (!btn) throw new Error(`preset button not found: ${label}`);
  return btn;
}

function setup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onStart = vi.fn();
  const onOpenChange = vi.fn();
  const rerender = async (open: boolean) => {
    await act(async () => {
      root.render(
        <FocusStartPopover
          open={open}
          onOpenChange={onOpenChange}
          assignmentTitle="任务A"
          onStart={onStart}
        />
      );
    });
  };
  return { container, root, onStart, onOpenChange, rerender };
}

describe("FocusStartPopover", () => {
  let harness: ReturnType<typeof setup>;

  beforeEach(async () => {
    localStorage.clear();
    // 确保 preference 默认为 25（与 DEFAULT_PREFERENCES 一致），每个测试隔离
    useAppStore.setState({ preferences: { ...useAppStore.getState().preferences, focusDefaultMinutes: 25 } });
    harness = setup();
    await harness.rerender(true);
  });

  afterEach(() => {
    act(() => harness.root.unmount());
    harness.container.remove();
  });

  it("1. 首次打开默认 25（input 值 + 25 preset active）", () => {
    const input = harness.container.querySelector<HTMLInputElement>('input[aria-label="自定义时长（分钟）"]');
    expect(input?.value).toBe("25");
    expect(presetButton(harness.container, "25 分").getAttribute("aria-pressed")).toBe("true");
  });

  it("2. 选择 60 → 关闭 → 重开 → 回到 25", async () => {
    act(() => presetButton(harness.container, "60 分").click());
    const input1 = harness.container.querySelector<HTMLInputElement>('input[aria-label="自定义时长（分钟）"]');
    expect(input1?.value).toBe("60");
    expect(presetButton(harness.container, "60 分").getAttribute("aria-pressed")).toBe("true");
    await harness.rerender(false);
    await harness.rerender(true);
    const input2 = harness.container.querySelector<HTMLInputElement>('input[aria-label="自定义时长（分钟）"]');
    expect(input2?.value).toBe("25");
    expect(presetButton(harness.container, "25 分").getAttribute("aria-pressed")).toBe("true");
  });

  it("3. note 201+ 字符 → 截断 200（与 Overview 一致）", () => {
    const note = harness.container.querySelector<HTMLInputElement>('input[aria-label="专注备注"]');
    expect(note?.maxLength).toBe(200);
    setInputValue(note!, "x".repeat(250));
    expect(note?.value).toBe("x".repeat(200));
  });

  it("4. 非法时长（0 / 241 / 小数）→ 内联错误，不触发 onStart；合法值恢复", () => {
    const input = harness.container.querySelector<HTMLInputElement>('input[aria-label="自定义时长（分钟）"]');
    const confirm = harness.container.querySelector<HTMLButtonElement>('button[data-testid="focus-start-confirm"]');
    for (const bad of ["0", "241", "12.5"]) {
      setInputValue(input!, bad);
      act(() => confirm!.click());
      expect(harness.onStart).not.toHaveBeenCalled();
      const error = harness.container.querySelector("p.text-danger");
      expect(error?.textContent).toContain("专注时长需为 1–240 的整数");
    }
    setInputValue(input!, "45");
    act(() => confirm!.click());
    expect(harness.onStart).toHaveBeenCalledWith(45, "");
  });

  it("5. 有效 start 传已 trim 备注", () => {
    const note = harness.container.querySelector<HTMLInputElement>('input[aria-label="专注备注"]');
    setInputValue(note!, "  复习笔记  ");
    const confirm = harness.container.querySelector<HTMLButtonElement>('button[data-testid="focus-start-confirm"]');
    act(() => confirm!.click());
    expect(harness.onStart).toHaveBeenCalledWith(25, "复习笔记");
  });

  it("6. 已打开时用户改成 60，外部 preference 改成 15 → 当前 picker 仍保持 60（不被覆盖）", async () => {
    act(() => presetButton(harness.container, "60 分").click());
    const input1 = harness.container.querySelector<HTMLInputElement>('input[aria-label="自定义时长（分钟）"]');
    expect(input1?.value).toBe("60");
    // 外部修改 preference
    useAppStore.getState().updatePreferences({ focusDefaultMinutes: 15 });
    // 仍打开状态，不应被覆盖
    const input2 = harness.container.querySelector<HTMLInputElement>('input[aria-label="自定义时长（分钟）"]');
    expect(input2?.value).toBe("60");
  });

  it("7. 关闭后重开读取最新 preference 15", async () => {
    act(() => presetButton(harness.container, "60 分").click());
    useAppStore.getState().updatePreferences({ focusDefaultMinutes: 15 });
    // picker 仍 60
    expect(harness.container.querySelector<HTMLInputElement>('input[aria-label="自定义时长（分钟）"]')?.value).toBe("60");
    await harness.rerender(false);
    await harness.rerender(true);
    expect(harness.container.querySelector<HTMLInputElement>('input[aria-label="自定义时长（分钟）"]')?.value).toBe("15");
    expect(presetButton(harness.container, "15 分").getAttribute("aria-pressed")).toBe("true");
  });

  it("8. 默认值不再是硬编码 30，30 仅作为可选 preset 存在", async () => {
    // 默认应为 25，而非 30
    const input = harness.container.querySelector<HTMLInputElement>('input[aria-label="自定义时长（分钟）"]');
    expect(input?.value).not.toBe("30");
    // 但 30 preset 仍可手动选择
    act(() => presetButton(harness.container, "30 分").click());
    expect(harness.container.querySelector<HTMLInputElement>('input[aria-label="自定义时长（分钟）"]')?.value).toBe("30");
  });
});
