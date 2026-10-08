// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { DropdownMenuPanel, DropdownMenuItem } from "@/components/ui/DropdownMenu";

afterEach(() => cleanup());

// presence 进入需 2×rAF（挂载隐藏态→显示），单测里手动放行，否则面板带 inert 致漫游无项
async function settlePresence(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 100));
  });
}

/**
 * DropdownMenu keyboard roving（ArrowDown/Up/Home/End）：
 * - disabled 项跳过；首尾循环；jsdom 无布局下仍可用（可见性走 computedStyle，不查 offsetParent）
 */
function renderMenu() {
  render(
    <DropdownMenuPanel open>
      <DropdownMenuItem label="一" onClick={() => {}} />
      <DropdownMenuItem label="二" onClick={() => {}} />
      <DropdownMenuItem label="三" onClick={() => {}} disabled />
      <DropdownMenuItem label="四" onClick={() => {}} />
    </DropdownMenuPanel>
  );
  return screen.getByRole("menu");
}

describe("DropdownMenuPanel roving", () => {
  it("ArrowDown 顺序移动并跳过 disabled（末尾循环到首项）", async () => {
    const menu = renderMenu();
    await settlePresence();
    (screen.getByRole("menuitem", { name: "一" }) as HTMLElement).focus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("二");
    // 三 disabled → 跳到四
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("四");
    // 末尾循环回首
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("一");
  });

  it("ArrowUp 反向移动并跳过 disabled", async () => {
    const menu = renderMenu();
    await settlePresence();
    (screen.getByRole("menuitem", { name: "一" }) as HTMLElement).focus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement?.textContent).toContain("四");
  });

  it("Home/End 直达首尾（跳过 disabled）", async () => {
    const menu = renderMenu();
    await settlePresence();
    (screen.getByRole("menuitem", { name: "二" }) as HTMLElement).focus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement?.textContent).toContain("四");
    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement?.textContent).toContain("一");
  });

  it("menuitemradio 同样参与漫游", async () => {
    render(
      <DropdownMenuPanel open>
        <DropdownMenuItem label="一" onClick={() => {}} />
        <button type="button" role="menuitemradio" aria-checked="false">
          字号
        </button>
      </DropdownMenuPanel>
    );
    await settlePresence();
    const menu = screen.getByRole("menu");
    (screen.getByRole("menuitem", { name: "一" }) as HTMLElement).focus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("role")).toBe("menuitemradio");
  });
});
