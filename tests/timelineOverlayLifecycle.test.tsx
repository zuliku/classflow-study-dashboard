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
// UISelect 打开时聚焦 active option 并 scrollIntoView（jsdom 未实现）
if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
}

import { ArrangeSheet, MarkSheet } from "@/components/timeline/TimelineWorkspace";
import { FloatingTimelineDetail } from "@/components/timeline/FloatingTimelineDetail";
import { TimelineWorkspaceViewBar } from "@/components/timeline/TimelineWorkspaceViewBar";
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

describe("UI Productization V2.2 —— Workspace Controls & Form Primitive Adoption", () => {
  const noop = () => {};

  describe("Timeline FilterToggle → Checkbox primitive", () => {
    function renderViewBar(onFilterChange = noop) {
      return render(
        <TimelineWorkspaceViewBar
          currentSemesterWeek={2}
          totalWeeks={16}
          isCurrentWeek
          onPrevWeek={noop}
          onNextWeek={noop}
          onToday={noop}
          filterOptions={[
            { key: "studyBlocks", label: "学习计划", checked: true },
            { key: "exams", label: "考试", checked: false },
          ]}
          filterActive
          filterOpen
          onFilterToggle={noop}
          onFilterClose={noop}
          onFilterChange={onFilterChange}
        />
      );
    }

    it("共享 Checkbox 渲染原生 checkbox semantics；点击行文本切换", () => {
      const onFilterChange = vi.fn();
      renderViewBar(onFilterChange);
      // 原生 checkbox semantics（真实 input，非 accent 样式）
      const studyCb = screen.getByLabelText("学习计划") as HTMLInputElement;
      expect(studyCb.type).toBe("checkbox");
      expect(studyCb.checked).toBe(true);
      // 点击行文本（sibling span）→ row onClick 切换
      fireEvent.click(screen.getByText("考试"));
      expect(onFilterChange).toHaveBeenCalledWith("exams", true);
    });

    it("点击 checkbox 本体只触发一次 change（stopPropagation 防双触发）", () => {
      const onFilterChange = vi.fn();
      renderViewBar(onFilterChange);
      const examsCb = screen.getByLabelText("考试") as HTMLInputElement;
      expect(examsCb.checked).toBe(false);
      fireEvent.click(examsCb);
      // checkbox 本体：input 原生 change 一次（row onClick 被 stopPropagation 挡住）；
      // 受控 props 未变 → checked 回滚为 false（harness 无 state），但回调只发生一次
      expect(onFilterChange).toHaveBeenCalledTimes(1);
      expect(onFilterChange).toHaveBeenCalledWith("exams", true);
    });

    it("课程恒显示：disabled checkbox 不响应点击", () => {
      const onFilterChange = vi.fn();
      renderViewBar(onFilterChange);
      const courseCb = screen.getByLabelText("课程") as HTMLInputElement;
      expect(courseCb.disabled).toBe(true);
      expect(courseCb.checked).toBe(true);
      fireEvent.click(screen.getByText("课程"));
      expect(onFilterChange).not.toHaveBeenCalled();
    });
  });

  describe("ArrangeSheet form primitives", () => {
    it("标题编辑 + 时间编辑 + UISelect 选日期 → 提交 payload 保持 domain value", () => {
      const onSubmit = vi.fn();
      render(
        <ArrangeSheet open assignment={null} weekDates={WEEK_DATES} onClose={noop} onSubmit={onSubmit} />
      );
      // 标题（Input primitive）
      fireEvent.change(screen.getByLabelText("学习计划标题"), { target: { value: "复习计量经济学" } });
      // 时间（Input type=time primitive）
      fireEvent.change(screen.getByLabelText("开始时间"), { target: { value: "07:30" } });
      fireEvent.change(screen.getByLabelText("结束时间"), { target: { value: "09:00" } });
      // 日期（UISelect：portal menu，label 为 MM/DD、value 保持 yyyy-MM-dd）
      fireEvent.click(screen.getByRole("combobox", { name: "日期" }));
      fireEvent.click(screen.getByRole("option", { name: "08/19" }));
      fireEvent.click(screen.getByRole("button", { name: "确认安排" }));
      expect(onSubmit).toHaveBeenCalledWith(null, "2026-08-19", "07:30", "09:00");
    });

    it("title.trim() validation 不变：空白标题禁止提交", () => {
      const onSubmit = vi.fn();
      render(
        <ArrangeSheet open assignment={null} weekDates={WEEK_DATES} onClose={noop} onSubmit={onSubmit} />
      );
      fireEvent.change(screen.getByLabelText("学习计划标题"), { target: { value: "   " } });
      expect((screen.getByRole("button", { name: "确认安排" }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "确认安排" }));
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe("MarkSheet SegmentedControl", () => {
    it("exam/activity exclusive selection；提交 payload type 跟随选择", () => {
      const onSubmit = vi.fn();
      render(<MarkSheet open weekDates={WEEK_DATES} onClose={noop} onSubmit={onSubmit} />);
      // 默认 exam
      expect(screen.getByRole("button", { name: "考试" }).getAttribute("aria-pressed")).toBe("true");
      // 切到活动
      fireEvent.click(screen.getByRole("button", { name: "活动" }));
      expect(screen.getByRole("button", { name: "活动" }).getAttribute("aria-pressed")).toBe("true");
      expect(screen.getByRole("button", { name: "考试" }).getAttribute("aria-pressed")).toBe("false");

      fireEvent.change(screen.getByLabelText("标题"), { target: { value: "社团纳新宣讲" } });
      fireEvent.click(screen.getByRole("button", { name: "添加" }));
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ title: "社团纳新宣讲", type: "activity" })
      );
    });

    it("空标题禁止提交（validation 不变）", () => {
      const onSubmit = vi.fn();
      render(<MarkSheet open weekDates={WEEK_DATES} onClose={noop} onSubmit={onSubmit} />);
      expect((screen.getByRole("button", { name: "添加" }) as HTMLButtonElement).disabled).toBe(true);
    });
  });

  describe("Static audit guard（目标文件 semantic token）", () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

    it("WorkspaceViewBar / Input / Textarea / AssignmentViewBar 不再散落 bg-[#F7F5F5]", () => {
      for (const f of [
        "components/layout/WorkspaceViewBar.tsx",
        "components/ui/Input.tsx",
        "components/ui/Textarea.tsx",
        "components/assignment/AssignmentWorkspaceViewBar.tsx",
      ]) {
        expect(read(f)).not.toContain("bg-[#F7F5F5]");
      }
    });

    it("AssignmentViewBar 图标色走 sandrift token；FilterToggle 不再使用 accent checkbox", () => {
      expect(read("components/assignment/AssignmentWorkspaceViewBar.tsx")).not.toContain("text-[#A48F82]");
      const viewBar = read("components/timeline/TimelineWorkspaceViewBar.tsx");
      expect(viewBar).not.toContain("accent-charcoal");
      expect(viewBar).toContain('from "@/components/ui/Checkbox"');
    });

    it("Timeline 表单不再有原生 select / 手写 label span（Field/UISelect 收敛）", () => {
      const src = read("components/timeline/TimelineWorkspace.tsx");
      expect(src).not.toMatch(/<select /);
      expect(src).toContain('from "@/components/ui/Field"');
      expect(src).toContain('from "@/components/ui/SegmentedControl"');
    });
  });
});
