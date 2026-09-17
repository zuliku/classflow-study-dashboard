/**
 * @vitest-environment jsdom
 */
import React, { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { useFocusTrap, getFocusableElements } from "@/lib/useFocusTrap";

afterEach(() => cleanup());

function Harness({ active, hiddenMiddle = false }: { active: boolean; hiddenMiddle?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const trap = useFocusTrap(ref, active);
  return (
    <div ref={ref} onKeyDown={trap} data-testid="trap-root">
      <button type="button">第一</button>
      <button type="button" hidden={hiddenMiddle || undefined}>隐藏</button>
      <button type="button">第二</button>
      <button type="button">第三</button>
    </div>
  );
}

function tabOn(root: HTMLElement, shift = false) {
  fireEvent.keyDown(root, { key: "Tab", shiftKey: shift });
}

describe("useFocusTrap", () => {
  it("getFocusableElements 跳过 hidden 子树与禁用项", () => {
    render(<Harness active={false} hiddenMiddle />);
    const root = screen.getByTestId("trap-root");
    const labels = getFocusableElements(root).map((el) => el.textContent);
    expect(labels).toEqual(["第一", "第二", "第三"]);
  });

  it("Tab 在末尾包裹到首个；Shift+Tab 在首个包裹到末尾", () => {
    render(<Harness active />);
    const root = screen.getByTestId("trap-root");
    const btns = root.querySelectorAll("button");
    // 注意 hidden={undefined} 时不过滤：4 个按钮
    expect(btns.length).toBe(4);

    btns[3].focus();
    expect(document.activeElement).toBe(btns[3]);
    tabOn(root);
    expect(document.activeElement).toBe(btns[0]);

    (btns[0] as HTMLElement).focus();
    tabOn(root, true);
    expect(document.activeElement).toBe(btns[3]);
  });

  it("中间 Tab 不干预（只在包裹时接管）", () => {
    render(<Harness active />);
    const root = screen.getByTestId("trap-root");
    const btns = root.querySelectorAll("button");
    btns[1].focus();
    const ev = new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    let defaultPrevented = false;
    ev.preventDefault = () => {
      defaultPrevented = true;
    };
    root.dispatchEvent(ev);
    expect(defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(btns[1]);
  });

  it("未启用时不拦截", () => {
    render(<Harness active={false} />);
    const root = screen.getByTestId("trap-root");
    const btns = root.querySelectorAll("button");
    btns[3].focus();
    tabOn(root);
    // jsdom 不自动移动焦点；关键是 trap 未调用 preventDefault 接管
    expect(document.activeElement).toBe(btns[3]);
  });
});
