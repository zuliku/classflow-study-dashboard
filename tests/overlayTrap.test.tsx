/**
 * @vitest-environment jsdom
 */
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { Dialog } from "@/components/ui/Dialog";
import { Drawer } from "@/components/ui/Drawer";

afterEach(() => cleanup());

/**
 * S2-1 Overlay 焦点陷阱：
 * - Dialog 默认 trap（Modal 语义），可显式 opt-out；
 * - Drawer 跟随 presentation：edge 默认 trap，floating 默认不 trap。
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

describe("Drawer trap 跟随 presentation", () => {
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

  it("floating 默认不 trap：背景可交互工作流不受影响", () => {
    render(
      <Drawer open onOpenChange={() => {}} overlayId="test-drawer-floating" presentation="floating">
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
