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

  it("保序：中间项删除原位保留（不 teleport 到末尾、不硬跳兄弟）", () => {
    function OrderProbe({ items }: { items: string[] }) {
      const retained = useExitPresenceList({ items, getId: (id) => id, resetKey: "v1" });
      return (
        <ul>
          {retained.map(({ item, exiting }) => (
            <li key={item} data-testid={`ord-${item}`} data-exiting={String(exiting)}>
              {item}
            </li>
          ))}
        </ul>
      );
    }
    const { rerender, container, queryByTestId } = render(<OrderProbe items={["a", "b", "c"]} />);
    rerender(<OrderProbe items={["a", "c"]} />);
    // b 原位保留（a 与 c 之间），顺序不变
    expect(Array.from(container.querySelectorAll("li")).map((li) => li.textContent)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(queryByTestId("ord-b")?.dataset.exiting).toBe("true");
    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS.panel);
    });
    expect(queryByTestId("ord-b")).toBeNull();
    expect(Array.from(container.querySelectorAll("li")).map((li) => li.textContent)).toEqual(["a", "c"]);
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

  it("ExitCollapse horizontal：chip 行横向折叠（grid-cols + min-w-0）", () => {
    function HProbe({ exiting }: { exiting: boolean }) {
      return (
        <ExitCollapse axis="horizontal" exiting={exiting}>
          <span>chip</span>
        </ExitCollapse>
      );
    }
    const { rerender, container } = render(<HProbe exiting={false} />);
    const root = container.firstElementChild!;
    expect(root.getAttribute("data-axis")).toBe("horizontal");
    expect(root.className).toContain("grid-cols-[1fr]");
    expect(root.className).toContain("duration-[var(--motion-exit-panel)]");
    rerender(<HProbe exiting />);
    expect(root.getAttribute("data-state")).toBe("exiting");
    expect(root.className).toContain("grid-cols-[0fr]");
    expect(root.className).toContain("opacity-0");
  });

  it("leaving 态删除：160ms 后才真正 onRemove（顺序天然保留）", () => {
    const onRemove = vi.fn();
    function LeavingProbe({ ids }: { ids: string[] }) {
      const [leaving, setLeaving] = React.useState<ReadonlySet<string>>(new Set());
      const remove = (id: string) => {
        if (leaving.has(id)) return;
        setLeaving((prev) => new Set(prev).add(id));
        setTimeout(() => onRemove(id), MOTION_EXIT_MS.panel);
      };
      return (
        <ul>
          {ids.map((id) => (
            <li key={id}>
              <ExitCollapse axis="horizontal" exiting={leaving.has(id)}>
                <button data-testid={`rm-${id}`} onClick={() => remove(id)}>
                  {id}
                </button>
              </ExitCollapse>
            </li>
          ))}
        </ul>
      );
    }
    const { container, queryByTestId } = render(<LeavingProbe ids={["a", "b", "c"]} />);
    act(() => {
      fireEvent.click(queryByTestId("rm-b")!);
    });
    // 原位进入 exiting（a/b/c 顺序不变），onRemove 尚未调用
    expect(Array.from(container.querySelectorAll("li")).map((li) => li.textContent)).toEqual(["a", "b", "c"]);
    expect(container.querySelector('[data-state="exiting"]')).not.toBeNull();
    expect(onRemove).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS.panel);
    });
    expect(onRemove).toHaveBeenCalledWith("b");
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

  it("searchable：无搜索框时行为不变；有搜索框时过滤 + Enter 选过滤首项 + 空结果提示", () => {
    // 默认（非 searchable）：无搜索输入
    render(<SelectHarness />);
    fireEvent.click(getCombobox());
    expect(screen.queryByPlaceholderText("搜索选项...")).toBeNull();
    cleanup();

    const onChange = vi.fn();
    const many = Array.from({ length: 8 }, (_, i) => ({ value: `c${i}`, label: `课程${i}` }));
    render(
      <UISelect
        value="c0"
        onChange={onChange}
        options={many}
        ariaLabel="课程筛选"
        searchable
      />
    );
    fireEvent.click(screen.getByRole("combobox", { name: "课程筛选" }));
    const input = screen.getByPlaceholderText("搜索选项...") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "课程1" } });
    // "课程1" 命中 1 条（课程1），其余过滤掉
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("c1");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("searchable：搜索栏在滚动区外（选项不会从搜索栏上方透出）", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ value: `c${i}`, label: `课程${i}` }));
    render(<UISelect value="c0" onChange={vi.fn()} options={many} ariaLabel="课程筛选" searchable />);
    fireEvent.click(screen.getByRole("combobox", { name: "课程筛选" }));
    const search = screen.getByTestId("ui-select-search");
    const options = screen.getByTestId("ui-select-options");
    // 搜索栏与选项列表是兄弟节点：列表滚动时搜索栏不在同一个滚动容器里
    expect(options.contains(search)).toBe(false);
    expect(search.parentElement).toBe(options.parentElement);
    expect(options.className).toContain("overflow-y-auto");
    expect(options.parentElement!.className).toContain("overflow-hidden");
    expect(search.className).not.toContain("sticky");
  });

  it("searchable：无匹配时显示空态；空格在搜索框内是输入字符", () => {
    const onChange = vi.fn();
    const many = Array.from({ length: 8 }, (_, i) => ({ value: `c${i}`, label: `课程${i}` }));
    render(
      <UISelect value="c0" onChange={onChange} options={many} ariaLabel="课程筛选" searchable />
    );
    fireEvent.click(screen.getByRole("combobox", { name: "课程筛选" }));
    const input = screen.getByPlaceholderText("搜索选项...") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "不存在的课" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("无匹配选项")).not.toBeNull();
    // 空格不触发选择（仍在输入），菜单保持打开
    fireEvent.change(input, { target: { value: "课程 1" } });
    fireEvent.keyDown(input, { key: " " });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeNull();
    expect(input.value).toBe("课程 1");
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

// ============================================================
// Workflow UX Motion Productization M2 —— Popover / Select fast-tier contract
// ============================================================
describe("Motion M2 —— overlay fast-tier static contract", () => {
  it("Popover panel：enter --motion-fast / exit --motion-exit-fast；无 200ms+ 覆盖", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(process.cwd(), "components/ui/Popover.tsx"), "utf-8");
    expect(src).toContain("duration-[var(--motion-fast)]");
    expect(src).toContain("!duration-[var(--motion-exit-fast)]");
    expect(src).not.toMatch(/duration-\[(2|3)00ms\]/);
    const sel = fs.readFileSync(path.join(process.cwd(), "components/ui/Select.tsx"), "utf-8");
    expect(sel).toContain("duration-[var(--motion-fast)]");
    expect(sel).toContain("var(--motion-exit-fast)");
    // Context Menu 复用 ux-inline（fast 同源）
    const menu = fs.readFileSync(path.join(process.cwd(), "components/assignment/AssignmentContextMenu.tsx"), "utf-8");
    expect(menu).toContain("ux-inline");
  });
});
