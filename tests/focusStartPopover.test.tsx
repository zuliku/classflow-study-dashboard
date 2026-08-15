// @vitest-environment jsdom
/**
 * FocusStartPopover（Task Execution Loop V1.1）picker 行为：
 * 每次打开默认 30、关闭重开仍 30、note 200 上限、非法时长校验。
 * 使用 jsdom + react-dom/client + act；不写 brittle snapshot。
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { FocusStartPopover } from "@/components/focus/FocusStartPopover";

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
    // React 19：effect（含 open→close 的 reset）需 async act 冲刷
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
    harness = setup();
    await harness.rerender(true);
  });

  afterEach(() => {
    act(() => harness.root.unmount());
    harness.container.remove();
  });

  it("1. 首次打开默认 30（input 值 + 30 preset active）", () => {
    const input = harness.container.querySelector<HTMLInputElement>('input[aria-label="自定义时长（分钟）"]');
    expect(input?.value).toBe("30");
    expect(presetButton(harness.container, "30 分").getAttribute("aria-pressed")).toBe("true");
  });

  it("2. 选择 60 → 关闭 → 重开 → 回到 30", async () => {
    act(() => presetButton(harness.container, "60 分").click());
    const input1 = harness.container.querySelector<HTMLInputElement>('input[aria-label="自定义时长（分钟）"]');
    expect(input1?.value).toBe("60");
    expect(presetButton(harness.container, "60 分").getAttribute("aria-pressed")).toBe("true");
    // 关闭 → 重开：每轮 picker session 独立，回默认 30
    await harness.rerender(false);
    await harness.rerender(true);
    const input2 = harness.container.querySelector<HTMLInputElement>('input[aria-label="自定义时长（分钟）"]');
    expect(input2?.value).toBe("30");
    expect(presetButton(harness.container, "30 分").getAttribute("aria-pressed")).toBe("true");
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
    expect(harness.onStart).toHaveBeenCalledWith(30, "复习笔记");
  });
});
