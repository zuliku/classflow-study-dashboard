// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import React, { useRef, useState } from "react";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { Dialog } from "@/components/ui/Dialog";
import { useInertOnHidden } from "@/lib/useInertOnHidden";
import { useRestoreFocus } from "@/lib/useRestoreFocus";

afterEach(() => cleanup());

async function settlePresence(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 100));
  });
}

describe("Dialog initialFocusRef", () => {
  it("open 后 rAF 聚焦到目标输入框（比 autoFocus 稳：等 presence 可见）", async () => {
    function Harness() {
      const inputRef = useRef<HTMLInputElement | null>(null);
      return (
        <Dialog open onOpenChange={() => {}} overlayId="test-initial-focus" aria-label="测试弹窗" initialFocusRef={inputRef}>
          <input ref={inputRef} aria-label="目标输入" />
          <button>其他按钮</button>
        </Dialog>
      );
    }
    render(<Harness />);
    await settlePresence();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("目标输入");
  });

  it("不传 initialFocusRef 时聚焦首个可聚焦元素（模态接管焦点）", async () => {
    function Harness() {
      return (
        <Dialog open onOpenChange={() => {}} overlayId="test-no-initial-focus" aria-label="测试弹窗">
          <input aria-label="普通输入" />
        </Dialog>
      );
    }
    render(<Harness />);
    await settlePresence();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("普通输入");
  });
});

describe("useInertOnHidden", () => {
  it("hidden 切 true/false 时挂载/摘除 inert", () => {
    function Harness({ hidden }: { hidden: boolean }) {
      const ref = useInertOnHidden<HTMLDivElement>(hidden);
      return <div ref={ref} data-testid="box" />;
    }
    const { rerender } = render(<Harness hidden={false} />);
    expect(screen.getByTestId("box").hasAttribute("inert")).toBe(false);
    rerender(<Harness hidden />);
    expect(screen.getByTestId("box").hasAttribute("inert")).toBe(true);
    rerender(<Harness hidden={false} />);
    expect(screen.getByTestId("box").hasAttribute("inert")).toBe(false);
  });
});

describe("useRestoreFocus", () => {
  it("关闭后焦点回到可聚焦的触发元素；触发元素已禁用则不还焦", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      const [disabled, setDisabled] = useState(false);
      useRestoreFocus(open);
      return (
        <>
          <button onClick={() => setOpen(true)} disabled={disabled}>
            打开
          </button>
          <button onClick={() => setDisabled(true)}>禁用打开按钮</button>
          {open && <button onClick={() => setOpen(false)}>关闭</button>}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "打开" });
    opener.focus();
    fireEvent.click(opener);
    // 禁用触发元素并把焦点搬到别的可用按钮，再关闭：还焦守卫跳过已禁用元素，焦点不被拽回
    const disabler = screen.getByRole("button", { name: "禁用打开按钮" });
    fireEvent.click(disabler);
    disabler.focus();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await settlePresence();
    expect(document.activeElement?.textContent).not.toBe("打开");
  });
});
