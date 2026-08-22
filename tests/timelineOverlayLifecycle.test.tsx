// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { useRef } from "react";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import * as fs from "node:fs";
import * as path from "node:path";

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

import { ArrangeSheet, MarkSheet } from "@/components/timeline/TimelineWorkspace";
import { FloatingTimelineDetail } from "@/components/timeline/FloatingTimelineDetail";
import { MOTION_EXIT_MS } from "@/lib/motion";
import type { Assignment } from "@/types";
import { useAppStore } from "@/store/useAppStore";

/**
 * Motion Coverage V2.1 —— Timeline Overlay Consumer Lifecycle：
 * 修复「Primitive 有正确 Presence，但 consumer 在外层被条件卸载」后，
 * 锁定以下行为契约：
 * 1. semantic close → exit presence 窗口内 DOM 仍在（--motion-exit-base 后卸载）
 * 2. ArrangeSheet exit snapshot：任务 A 关闭后淡出期间内容仍是 A，不得 morph 成自由表单
 * 3. MarkSheet fresh-open reset：每次打开为新表单；exit 中不清空
 * 4. Rapid reopen：A → close → B 只有一个 Dialog 且显示 B，无 A 闪现
 * 5. Reduced Motion：semantic close 即卸载
 * 6. FloatingTimelineDetail：原位 opacity exit、退出期释放 Esc/pointer 所有权
 */

function setMotionPreference(pref: "system" | "full" | "reduced") {
  const prefs = useAppStore.getState().preferences;
  useAppStore.setState({ preferences: { ...prefs, motionPreference: pref } });
}

const taskA = { id: "a1", title: "任务 A" } as unknown as Assignment;
const taskB = { id: "a2", title: "任务 B" } as unknown as Assignment;

const WEEK_DATES = ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"];

beforeEach(() => {
  vi.useFakeTimers();
  setMotionPreference("full");
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  setMotionPreference("system");
});

describe("ArrangeSheet lifecycle", () => {
  it("assignment open → close → exit 窗口内仍存在 → base(150ms) 后卸载", () => {
    const { rerender } = render(
      <ArrangeSheet open assignment={taskA} weekDates={WEEK_DATES} onClose={() => {}} onSubmit={() => {}} />
    );
    expect(screen.getByRole("dialog", { hidden: true })).toBeTruthy();
    expect(screen.getByText("任务 A")).toBeTruthy();

    rerender(
      <ArrangeSheet open={false} assignment={null} weekDates={WEEK_DATES} onClose={() => {}} onSubmit={() => {}} />
    );
    // exit presence：仍在文档中
    expect(screen.getByRole("dialog", { hidden: true })).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS.base);
    });
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
  });

  it("exit snapshot：任务 A 关闭后的淡出期间内容仍是 A，不得变成自由学习计划表单", () => {
    const { rerender } = render(
      <ArrangeSheet open assignment={taskA} weekDates={WEEK_DATES} onClose={() => {}} onSubmit={() => {}} />
    );
    rerender(
      <ArrangeSheet open={false} assignment={null} weekDates={WEEK_DATES} onClose={() => {}} onSubmit={() => {}} />
    );
    // exit 中：payload snapshot 保持 Task A
    expect(screen.getByText("任务 A")).toBeTruthy();
    // 不发生 content morph：自由创建的标题输入框不出现
    expect(screen.queryByLabelText("学习计划标题")).toBeNull();
  });

  it("free block：open → close → exit 正常且保持自由表单快照", () => {
    const { rerender } = render(
      <ArrangeSheet open assignment={null} weekDates={WEEK_DATES} onClose={() => {}} onSubmit={() => {}} />
    );
    const input = screen.getByLabelText("学习计划标题") as HTMLInputElement;
    expect(input).toBeTruthy();

    rerender(
      <ArrangeSheet open={false} assignment={null} weekDates={WEEK_DATES} onClose={() => {}} onSubmit={() => {}} />
    );
    expect(screen.getByRole("dialog", { hidden: true })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS.base);
    });
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
  });

  it("fresh-open session reset：关闭再打开，草稿已清空（不在 close 时 reset）", () => {
    const { rerender } = render(
      <ArrangeSheet open assignment={null} weekDates={WEEK_DATES} onClose={() => {}} onSubmit={() => {}} />
    );
    const input = screen.getByLabelText("学习计划标题") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "未提交的草稿" } });
    expect(input.value).toBe("未提交的草稿");

    // close：exit 中输入值仍保留（内容不清空）
    rerender(
      <ArrangeSheet open={false} assignment={null} weekDates={WEEK_DATES} onClose={() => {}} onSubmit={() => {}} />
    );
    expect((screen.getByLabelText("学习计划标题") as HTMLInputElement).value).toBe("未提交的草稿");

    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS.base + 1);
    });
    // 下一次 fresh open：新表单
    rerender(
      <ArrangeSheet open assignment={null} weekDates={WEEK_DATES} onClose={() => {}} onSubmit={() => {}} />
    );
    expect((screen.getByLabelText("学习计划标题") as HTMLInputElement).value).toBe("");
  });

  it("rapid reopen：A open → close → B open（未等 exit 完成）→ 单 Dialog 显示 B，无 A 内容", () => {
    const { rerender } = render(
      <ArrangeSheet open assignment={taskA} weekDates={WEEK_DATES} onClose={() => {}} onSubmit={() => {}} />
    );
    rerender(
      <ArrangeSheet open={false} assignment={null} weekDates={WEEK_DATES} onClose={() => {}} onSubmit={() => {}} />
    );
    // 未推进任何 timer，直接重开 B
    rerender(
      <ArrangeSheet open assignment={taskB} weekDates={WEEK_DATES} onClose={() => {}} onSubmit={() => {}} />
    );
    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS.base * 2);
    });
    expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(1);
    expect(screen.getByText("任务 B")).toBeTruthy();
    expect(screen.queryByText("任务 A")).toBeNull();
  });

  it("reduced motion：close 即卸载", () => {
    setMotionPreference("reduced");
    const { rerender } = render(
      <ArrangeSheet open assignment={taskA} weekDates={WEEK_DATES} onClose={() => {}} onSubmit={() => {}} />
    );
    rerender(
      <ArrangeSheet open={false} assignment={null} weekDates={WEEK_DATES} onClose={() => {}} onSubmit={() => {}} />
    );
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
  });
});

describe("MarkSheet lifecycle", () => {
  it("open 填写标题 → close → exit 期间标题仍存在；reopen 表单已 reset", () => {
    const { rerender } = render(
      <MarkSheet open weekDates={WEEK_DATES} onClose={() => {}} onSubmit={() => {}} />
    );
    const input = screen.getByLabelText("标题") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "英语六级模拟考试" } });

    rerender(<MarkSheet open={false} weekDates={WEEK_DATES} onClose={() => {}} onSubmit={() => {}} />);
    // exit 中内容保留
    expect((screen.getByLabelText("标题") as HTMLInputElement).value).toBe("英语六级模拟考试");

    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS.base);
    });
    // reopen：新表单
    rerender(<MarkSheet open weekDates={WEEK_DATES} onClose={() => {}} onSubmit={() => {}} />);
    expect((screen.getByLabelText("标题") as HTMLInputElement).value).toBe("");
  });

  it("reduced motion：close 即卸载", () => {
    setMotionPreference("reduced");
    const { rerender } = render(
      <MarkSheet open weekDates={WEEK_DATES} onClose={() => {}} onSubmit={() => {}} />
    );
    rerender(<MarkSheet open={false} weekDates={WEEK_DATES} onClose={() => {}} onSubmit={() => {}} />);
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
  });
});

describe("FloatingTimelineDetail lifecycle", () => {
  function DetailHarness({ open, onRequestClose }: { open: boolean; onRequestClose: vi.Mock }) {
    const anchorRef = useRef<HTMLElement | null>(null);
    const boundsRef = useRef<HTMLElement | null>(null);
    return (
      <>
        <div
          ref={anchorRef as React.RefObject<HTMLDivElement>}
          data-testid="anchor"
          style={{ position: "fixed", top: 40, left: 40, width: 8, height: 8 }}
        />
        <div ref={boundsRef as React.RefObject<HTMLDivElement>} data-testid="bounds" style={{ position: "fixed", inset: 0 }} />
        <FloatingTimelineDetail
          anchorRef={anchorRef}
          boundsRef={boundsRef}
          open={open}
          kind="marker"
          onRequestClose={() => onRequestClose()}
        >
          panel-body
        </FloatingTimelineDetail>
      </>
    );
  }

  it("open 定位可见 → close 原位置 opacity exit → fast(110ms) 后卸载", () => {
    const onRequestClose = vi.fn();
    const { rerender } = render(<DetailHarness open onRequestClose={onRequestClose} />);
    const panel = document.querySelector('[data-testid="floating-timeline-detail"]') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.style.left).not.toBe("-9999px");

    const leftBefore = panel.style.left;
    const topBefore = panel.style.top;

    rerender(<DetailHarness open={false} onRequestClose={onRequestClose} />);
    const exiting = document.querySelector('[data-testid="floating-timeline-detail"]') as HTMLElement;
    // exit presence：原位置淡出（left/top 不被清空、不做位移）
    expect(exiting).toBeTruthy();
    expect(exiting.style.left).toBe(leftBefore);
    expect(exiting.style.top).toBe(topBefore);
    expect(exiting.className).toContain("opacity-0");
    expect(exiting.className).toContain("pointer-events-none");

    act(() => {
      vi.advanceTimersByTime(MOTION_EXIT_MS.fast);
    });
    expect(document.querySelector('[data-testid="floating-timeline-detail"]')).toBeNull();
  });

  it("semantic close：Esc listener 随 open 解除，exiting DOM 不再拥有 ownership", () => {
    const onRequestClose = vi.fn();
    const { rerender } = render(<DetailHarness open onRequestClose={onRequestClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onRequestClose).toHaveBeenCalledTimes(1);

    rerender(<DetailHarness open={false} onRequestClose={onRequestClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    // exiting 期间不再拦截
    expect(onRequestClose).toHaveBeenCalledTimes(1);
  });

  it("reduced motion：close 即卸载", () => {
    setMotionPreference("reduced");
    const onRequestClose = vi.fn();
    const { rerender } = render(<DetailHarness open onRequestClose={onRequestClose} />);
    rerender(<DetailHarness open={false} onRequestClose={onRequestClose} />);
    expect(document.querySelector('[data-testid="floating-timeline-detail"]')).toBeNull();
  });
});

describe("Hover bridge static guard", () => {
  it("100ms hover grace 是交互计时：留在 TimelineWorkspace，不入 lib/motion.ts", () => {
    const timelineSrc = fs.readFileSync(path.join(process.cwd(), "components/timeline/TimelineWorkspace.tsx"), "utf8");
    expect(timelineSrc).toContain("HOVER_BRIDGE_GRACE_MS = 100");
    const motionSrc = fs.readFileSync(path.join(process.cwd(), "lib/motion.ts"), "utf8");
    expect(motionSrc).not.toContain("HOVER_BRIDGE");
  });
});
