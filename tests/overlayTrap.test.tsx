/**
 * @vitest-environment jsdom
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { Dialog } from "@/components/ui/Dialog";
import { Drawer } from "@/components/ui/Drawer";

afterEach(() => cleanup());

/**
 * S2-1 Overlay 焦点陷阱：
 * - Dialog 默认 trap（Modal 语义），可显式 opt-out；
 * - Drawer 两种 presentation 均为真模态，默认 trap（背景不可操作，Tab 不逃逸）。
 */
describe("Dialog trap 默认开启", () => {
  it("Tab 在末尾包裹到首个", () => {
    render(
      <Dialog open onOpenChange={() => {}} overlayId="test-trap-default">
        <button type="button">甲</button>
        <button type="button">乙</button>
      </Dialog>
    );
    const btns = screen.getAllByRole("button");
    expect(btns.length).toBe(2);
    btns[1].focus();
    fireEvent.keyDown(btns[1], { key: "Tab" });
    expect(document.activeElement).toBe(btns[0]);
  });

  it("trapFocus={false} opt-out：不接管 Tab", () => {
    render(
      <Dialog open onOpenChange={() => {}} overlayId="test-trap-off" trapFocus={false}>
        <button type="button">甲</button>
        <button type="button">乙</button>
      </Dialog>
    );
    const btns = screen.getAllByRole("button");
    btns[1].focus();
    const ev = new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    let prevented = false;
    ev.preventDefault = () => {
      prevented = true;
    };
    btns[1].dispatchEvent(ev);
    expect(prevented).toBe(false);
  });
});

describe("Drawer trap：两种 presentation 均为真模态，默认 trap", () => {
  it("edge 默认 trap：Tab 在末尾包裹", () => {
    render(
      <Drawer open onOpenChange={() => {}} overlayId="test-drawer-edge">
        <button type="button">甲</button>
        <button type="button">乙</button>
      </Drawer>
    );
    const btns = screen.getAllByRole("button");
    expect(btns.length).toBe(2);
    btns[1].focus();
    fireEvent.keyDown(btns[1], { key: "Tab" });
    expect(document.activeElement).toBe(btns[0]);
  });

  it("floating 默认 trap：Tab 在末尾包裹，不逃逸到背后页面", () => {
    render(
      <Drawer open onOpenChange={() => {}} overlayId="test-drawer-floating" presentation="floating">
        <button type="button">甲</button>
        <button type="button">乙</button>
      </Drawer>
    );
    const btns = screen.getAllByRole("button");
    btns[1].focus();
    fireEvent.keyDown(btns[1], { key: "Tab" });
    expect(document.activeElement).toBe(btns[0]);
  });

  it("trapFocus={false} opt-out：不接管 Tab", () => {
    render(
      <Drawer open onOpenChange={() => {}} overlayId="test-drawer-floating-optout" presentation="floating" trapFocus={false}>
        <button type="button">甲</button>
        <button type="button">乙</button>
      </Drawer>
    );
    const btns = screen.getAllByRole("button");
    btns[1].focus();
    const ev = new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    let prevented = false;
    ev.preventDefault = () => {
      prevented = true;
    };
    btns[1].dispatchEvent(ev);
    expect(prevented).toBe(false);
  });
});

describe("Dialog backdrop close", () => {
  it("点击居中 wrapper（遮罩的 padding 区域）也触发 closeOnBackdrop", () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} overlayId="test-backdrop" closeOnBackdrop>
        <button type="button">面板内</button>
      </Dialog>
    );
    const panel = screen.getByRole("dialog");
    const wrapper = panel.parentElement!;
    fireEvent.pointerDown(wrapper);
    expect(onOpenChange).toHaveBeenCalledWith(false);

    onOpenChange.mockClear();
    fireEvent.pointerDown(panel);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
