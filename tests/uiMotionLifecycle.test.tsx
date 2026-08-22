// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { useState } from "react";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";

// Polyfills（jsdom 缺失的浏览器 API）
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as Record<string, unknown>).ResizeObserver = RO as unknown as typeof ResizeObserver;
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
if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
}

import { MOTION_MS, MOTION_EXIT_MS } from "@/lib/motion";
import { Dialog } from "@/components/ui/Dialog";
import { Drawer } from "@/components/ui/Drawer";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { ExitCollapse } from "@/components/ui/ExitCollapse";
import { useExitPresenceList } from "@/lib/useExitPresenceList";
import { UISelect } from "@/components/ui/Select";
import { ToastViewport } from "@/components/ui/ToastViewport";
import { useToastStore } from "@/store/useToastStore";
import { useAppStore } from "@/store/useAppStore";

/**
 * Motion Foundation V2 —— 共享 Primitive 的 presence lifecycle 行为契约：
 * CSS/JS 时间同源（见 motionContract.test.tsx），此处验证运行时行为：
 * - exit 视觉窗口内 DOM 仍在，MOTION_EXIT_MS.* 后精确卸载（无漂移）
 * - Reduced Motion 不等待 timer
 * - semantic close 立即释放 ARIA/inert，visual exit 随后完成
 */

function setMotionPreference(pref: "system" | "full" | "reduced") {
  const prefs = useAppStore.getState().preferences;
  useAppStore.setState({ preferences: { ...prefs, motionPreference: pref } });
}

function advanceTwoFrames() {
  act(() => {
    vi.advanceTimersByTime(16);
    vi.advanceTimersByTime(16);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  setMotionPreference("full");
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  setMotionPreference("system");
});

describe("Dialog presence lifecycle", () => {
  it("open 挂载 → close 后 exit 窗口内仍在 → base(150ms) 后卸载；Esc 请求关闭", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Dialog open onOpenChange={onOpenChange} overlayId="d-test">
        <p>dialog-body</p>
      </Dialog>
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("dialog-body")).toBeTruthy();

    // Esc：topmost overlay 请求关闭
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);

    rerender(
      <Dialog open={false} onOpenChange={onOpenChange} overlayId="d-test">
        <p>dialog-body</p>
      </Dialog>
    );
    // exit 视觉窗口内仍挂载（不突然消失）
    expect(screen.getByRole("dialog")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS.base);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reduced motion：close 即卸载，不等待 exit duration", () => {
    setMotionPreference("reduced");
    const { rerender } = render(
      <Dialog open onOpenChange={() => {}} overlayId="d-rm">
        <p>body</p>
      </Dialog>
    );
    rerender(
      <Dialog open={false} onOpenChange={() => {}} overlayId="d-rm">
        <p>body</p>
      </Dialog>
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Drawer presence lifecycle（edge / floating 同一语义）", () => {
  it.each(["edge", "floating"] as const)(
    "%s：close 后 panel(160ms) 内仍在 → 之后卸载",
    (presentation) => {
      const { rerender } = render(
        <Drawer open onOpenChange={() => {}} overlayId={`dr-${presentation}`} presentation={presentation}>
          <p>drawer-body</p>
        </Drawer>
      );
      expect(screen.getByRole("dialog")).toBeTruthy();

      rerender(
        <Drawer open={false} onOpenChange={() => {}} overlayId={`dr-${presentation}`} presentation={presentation}>
          <p>drawer-body</p>
        </Drawer>
      );
      expect(screen.getByRole("dialog")).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(MOTION_EXIT_MS.panel);
      });
      expect(screen.queryByRole("dialog")).toBeNull();
    }
  );
});

describe("DisclosureRegion contract", () => {
  function DisclosureHarness({ open }: { open: boolean }) {
    return (
      <DisclosureRegion open={open}>
        <button>disclosure-inner</button>
      </DisclosureRegion>
    );
  }

  it("semantic close：aria-hidden/inert 立即成立，视觉 presence 短暂保留后卸载", () => {
    const { rerender } = render(<DisclosureHarness open />);
    const button = screen.getByRole("button", { name: "disclosure-inner" });
    const region = button.closest("[data-state]");
    expect(region?.getAttribute("data-state")).toBe("open");

    rerender(<DisclosureHarness open={false} />);

    // semantic 释放是同步的：aria-hidden + inert 立即成立
    const closed = document.querySelector('[data-state="closed"]');
    expect(closed).not.toBeNull();
    expect(closed!.getAttribute("aria-hidden")).toBe("true");
    const inner = closed!.firstElementChild as HTMLElement;
    expect(inner.hasAttribute("inert")).toBe(true);

    // visual exit 与 presence unmount 同源（exit-base）
    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS.base);
    });
    expect(document.querySelector('[data-state="closed"]')).toBeNull();
  });

  it("reduced motion：close 即卸载", () => {
    setMotionPreference("reduced");
    const { rerender } = render(<DisclosureHarness open />);
    rerender(<DisclosureHarness open={false} />);
    expect(document.querySelector('[data-state="closed"]')).toBeNull();
  });
});

describe("useExitPresenceList ↔ ExitCollapse contract", () => {
  function ListProbe({ items, resetKey }: { items: string[]; resetKey: string }) {
    const retained = useExitPresenceList({ items, getId: (id) => id, resetKey });
    return (
      <ul>
        {retained.map(({ item, exiting }) => (
          <li key={item} data-testid={`item-${item}`} data-exiting={String(exiting)}>
            {item}
          </li>
        ))}
      </ul>
    );
  }

  it("真实 mutation：snapshot 保留为 exiting → panel(160ms) 后清理", () => {
    const { rerender, queryByTestId } = render(<ListProbe items={["a", "b"]} resetKey="v1" />);
    expect(queryByTestId("item-b")?.dataset.exiting).toBe("false");

    rerender(<ListProbe items={["a"]} resetKey="v1" />);
    // snapshot 保留（不突然消失）
    expect(queryByTestId("item-b")).not.toBeNull();
    expect(queryByTestId("item-b")!.dataset.exiting).toBe("true");

    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS.panel);
    });
    expect(queryByTestId("item-b")).toBeNull();
    expect(queryByTestId("item-a")).not.toBeNull();
  });

  it("resetKey 切换：直接同步新列表，不批量播放 exit", () => {
    const { rerender, queryByTestId } = render(<ListProbe items={["a", "b"]} resetKey="filter-1" />);
    rerender(<ListProbe items={["c", "d"]} resetKey="filter-2" />);
    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS.panel * 2);
    });
    expect(queryByTestId("item-a")).toBeNull();
    expect(queryByTestId("item-b")).toBeNull();
    expect(queryByTestId("item-c")?.dataset.exiting).toBe("false");
    expect(queryByTestId("item-d")?.dataset.exiting).toBe("false");
  });

  it("ExitCollapse：exiting 时 inner inert（不可 Tab）", () => {
    function CollapseProbe({ exiting }: { exiting: boolean }) {
      return (
        <ExitCollapse exiting={exiting}>
          <button>collapse-inner</button>
        </ExitCollapse>
      );
    }
    const { rerender, container } = render(<CollapseProbe exiting={false} />);
    expect(container.firstElementChild!.getAttribute("data-state")).toBe("present");
    rerender(<CollapseProbe exiting />);
    expect(container.firstElementChild!.getAttribute("data-state")).toBe("exiting");
    const inner = container.querySelector("button")!.closest("div[min-h-0]") as HTMLElement | null;
    // inner wrapper 获得 inert 属性
    const wrappers = container.querySelectorAll<HTMLElement>("div > div");
    expect(Array.from(wrappers).some((d) => d.hasAttribute("inert"))).toBe(true);
  });
});

describe("UISelect lifecycle（共享 usePresence）", () => {
  function SelectHarness({ onChange }: { onChange?: (v: string) => void }) {
    const [value, setValue] = useState("a");
    return (
      <UISelect
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
        options={[
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
          { value: "c", label: "Gamma" },
        ]}
        ariaLabel="选择"
      />
    );
  }

  const getCombobox = () => screen.getByRole("combobox");
  const getListbox = () => screen.queryByRole("listbox");

  it("open → 菜单挂载并进入可见态；trigger toggle 关闭走动画退出后卸载", () => {
    render(<SelectHarness />);
    fireEvent.click(getCombobox());
    expect(getListbox()).not.toBeNull();
    advanceTwoFrames();

    fireEvent.click(getCombobox()); // animated close
    // exit 窗口内仍在
    expect(getListbox()).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS.fast);
    });
    expect(getListbox()).toBeNull();
  });

  it("键盘：↑↓ 导航更新 aria-activedescendant；Enter 选择后立即卸载（不留退出窗口）", () => {
    const onChange = vi.fn();
    render(<SelectHarness onChange={onChange} />);
    const trigger = getCombobox();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(getListbox()).not.toBeNull();
    expect(trigger.getAttribute("aria-activedescendant")).toMatch(/option-0$/);

    fireEvent.keyDown(getListbox()!, { key: "ArrowDown" });
    expect(trigger.getAttribute("aria-activedescendant")).toMatch(/option-1$/);

    fireEvent.keyDown(getListbox()!, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("b");
    // 选择完成立即卸载：不推进任何 timer，菜单已不在文档中
    expect(getListbox()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Escape：可见时拦截（父层不收到）；淡出中不再拦截（父 Dialog 可响应）；focus 回 trigger", () => {
    const bubbleSpy = vi.fn();
    window.addEventListener("keydown", bubbleSpy);
    try {
      render(<SelectHarness />);
      fireEvent.click(getCombobox());
      advanceTwoFrames(); // visible = true

      fireEvent.keyDown(window, { key: "Escape" });
      // Select 以 window capture 拦截并 stopPropagation → 冒泡监听收不到
      expect(bubbleSpy).not.toHaveBeenCalled();
      // 动画退出开始，但监听已随 semantic open=false 解除
      act(() => {
        vi.advanceTimersByTime(MOTION_EXIT_MS.fast);
      });
      expect(getListbox()).toBeNull();

      // 淡出结束后：后续 Escape 直达父层（Overlay stack 所有权不被残留 DOM 拦截）
      fireEvent.keyDown(window, { key: "Escape" });
      expect(bubbleSpy).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(getCombobox());
    } finally {
      window.removeEventListener("keydown", bubbleSpy);
    }
  });

  it("outside pointerdown 关闭（动画退出）", () => {
    render(<SelectHarness />);
    fireEvent.click(getCombobox());
    advanceTwoFrames();
    fireEvent.pointerDown(document.body);
    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS.fast);
    });
    expect(getListbox()).toBeNull();
  });

  it("选择后立刻重开：绕过退出窗口的旁路被重置，菜单可再次打开", () => {
    render(<SelectHarness />);
    fireEvent.click(getCombobox());
    fireEvent.click(screen.getByRole("option", { selected: true })); // immediate close
    expect(getListbox()).toBeNull();
    fireEvent.click(getCombobox());
    expect(getListbox()).not.toBeNull();
  });

  it("reduced motion：close 即卸载", () => {
    setMotionPreference("reduced");
    render(<SelectHarness />);
    fireEvent.click(getCombobox());
    expect(getListbox()).not.toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(getListbox()).toBeNull();
  });
});

describe("ToastViewport lifecycle", () => {
  it("dismiss → exit 窗口内可见 → fast(140ms) 后移除且 store 清理", () => {
    useToastStore.setState({
      toasts: [{ id: "t1", type: "info", message: "保存成功", duration: 60_000 }],
    });
    render(<ToastViewport />);
    expect(screen.getByText("保存成功")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "关闭提示" }));
    // exit 动画播放中仍在
    expect(screen.getByText("保存成功")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(MOTION_MS.fast);
    });
    expect(screen.queryByText("保存成功")).toBeNull();
    expect(useToastStore.getState().toasts.find((t) => t.id === "t1")).toBeUndefined();
  });
});
