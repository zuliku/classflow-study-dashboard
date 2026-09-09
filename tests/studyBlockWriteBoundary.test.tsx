// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

vi.mock("@/hooks/useKiroHandoff", () => ({
  useKiroHandoff: () => ({ openForGroupProject: vi.fn(), openForWeek: vi.fn() }),
}));

class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as Record<string, unknown>).ResizeObserver = RO as unknown as typeof ResizeObserver;
if (typeof window !== "undefined" && !window.matchMedia) {
  (window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({
    matches: query.includes("pointer: fine"),
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
// jsdom 无 PointerEvent：fireEvent.pointerDown 会退化为普通 Event（button/clientX 全丢）
if (typeof window !== "undefined" && !(window as unknown as { PointerEvent?: unknown }).PointerEvent) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventPolyfill;
}
(document as unknown as Record<string, unknown>).elementFromPoint = ((_x: number, _y: number) => {
  // 返回渲染网格中的第一个日列，让 drag candidate 计算走真实路径
  return (document.querySelector("[data-timetable-day]") as HTMLElement | null) ?? null;
}) as unknown as typeof document.elementFromPoint;

function actSet(partial: Record<string, unknown>) {
  useAppStore.setState(partial as never);
}
vi.mock("@/components/kiro/KiroSessionProvider", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/components/kiro/KiroSessionProvider")>();
  return {
    ...mod,
    KiroSessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useKiroSession: () => ({
      planningPreview: null, setPlanningPreview: vi.fn(),
      studyRebalancePreview: null, setStudyRebalancePreview: vi.fn(),
      handoffPrompt: null,
    }),
    useKiroSessionMeta: () => ({ kiroBusy: false }),
    useKiroSessionActions: () => ({ claimEmptyIntro: vi.fn(), openSidecar: vi.fn(), closeSidecar: vi.fn(), expandSidecar: vi.fn(), minimizeSidecar: vi.fn(), restoreSidecar: vi.fn() }),
  };
});

import { useAppStore } from "@/store/useAppStore";
import { validateStudyBlockPlanningWrite } from "@/lib/planning/studyBlockLifecycle";
import { TimelineWorkspace } from "@/components/timeline/TimelineWorkspace";
import { useToastStore } from "@/store/useToastStore";
import type { Assignment, Course, Semester, StudyBlock } from "@/types";

/**
 * Workflow UX V17 —— StudyBlock Planning Write Boundary：
 * Store = Final Planning Authority。任何 caller（UI drag / ArrangeSheet / Kiro / 未来 API）
 * 最终走到 addStudyBlock / addStudyBlocksBatch / updateStudyBlock / updateStudyBlocksBatch 时，
 * 都不能写出违反 V14（planning eligibility）+ V15（release lifecycle）的状态。
 */

const NOW_BASE = new Date("2026-03-10T12:00:00").getTime();

const COURSE: Course = { id: "c1", name: "计量经济学" } as unknown as Course;
const SEMESTER: Semester = { id: "s1", name: "x", startDate: "2026-03-09", totalWeeks: 16 };

const mkA = (over: Partial<Assignment> = {}): Assignment =>
  ({ id: "a-1", courseId: "c1", title: "任务一", description: "", ddl: "", priority: "medium", status: "todo", progress: 0, tags: [], ...over }) as Assignment;

function seed(opts?: { status?: Assignment["status"]; blocks?: StudyBlock[]; week?: number }) {
  const prefs = useAppStore.getState().preferences;
  useAppStore.setState({
    courses: [COURSE],
    assignments: [mkA({ status: opts?.status ?? "todo" })],
    schedules: [],
    calendarMarks: [],
    groupProjects: [],
    scheduleOccurrenceOverrides: [],
    semester: SEMESTER,
    currentSemesterWeek: opts?.week ?? 1,
    activeTab: "timetable" as never,
    selectedAssignmentId: null,
    selectedCourseId: null,
    selectedCalendarMarkId: null,
    pendingTimelineArrangeAssignmentId: null,
    focusSessions: [],
    studyBlocks: opts?.blocks ?? [],
    reminders: [],
    preferences: { ...prefs, enableScheduleDirectManipulation: true },
  });
}

beforeEach(() => {
  cleanup();
});
afterEach(() => {
  cleanup();
});

// ============================================================
// Create boundary
// ============================================================
describe("addStudyBlock write boundary", () => {
  it.each([
    ["todo"],
    ["doing"],
  ] as const)("%s parent → 创建成功", (status) => {
    seed({ status });
    const id = useAppStore.getState().addStudyBlock({ title: "新计划", date: "2026-03-11", startTime: "10:00", endTime: "11:00", assignmentId: "a-1", source: "manual" });
    expect(id).toBeTruthy();
    expect(useAppStore.getState().studyBlocks).toHaveLength(1);
  });

  it.each([
    ["submitted"],
    ["completed"],
  ] as const)("terminal parent（%s）→ null 且零 mutation", (status) => {
    seed({ status });
    const id = useAppStore.getState().addStudyBlock({ title: "非法计划", date: "2026-03-11", startTime: "10:00", endTime: "11:00", assignmentId: "a-1", source: "manual" });
    expect(id).toBeNull();
    expect(useAppStore.getState().studyBlocks).toHaveLength(0);
    expect(useAppStore.getState().reminders).toHaveLength(0); // Reminder 零副作用
  });

  it("missing assignmentId target → null", () => {
    seed();
    expect(
      useAppStore.getState().addStudyBlock({ title: "orphan", date: "2026-03-11", startTime: "10:00", endTime: "11:00", assignmentId: "a-gone", source: "manual" })
    ).toBeNull();
    expect(useAppStore.getState().studyBlocks).toHaveLength(0);
  });

  it("standalone → 正常允许（不受 gate 影响）", () => {
    seed({ status: "completed" }); // 无 linked 关系，completed 不影响 standalone
    const id = useAppStore.getState().addStudyBlock({ title: "自由学习", date: "2026-03-11", startTime: "10:00", endTime: "11:00", source: "manual" });
    expect(id).toBeTruthy();
  });

  it("batch：全部 eligible → 成功；混入 terminal → 整批 null；missing → null；empty → []", () => {
    seed({ status: "doing" });
    const ok = useAppStore.getState().addStudyBlocksBatch([
      { title: "b1", date: "2026-03-11", startTime: "10:00", endTime: "11:00", assignmentId: "a-1", source: "kiro" },
      { title: "b2", date: "2026-03-12", startTime: "10:00", endTime: "11:00", assignmentId: "a-1", source: "kiro" },
    ]);
    expect(ok).toHaveLength(2);

    actSet({ assignments: [mkA({ status: "submitted" })] });
    const rejected = useAppStore.getState().addStudyBlocksBatch([
      { title: "good", date: "2026-03-13", startTime: "10:00", endTime: "11:00", assignmentId: "a-1", source: "kiro" },
      { title: "bad", date: "2026-03-13", startTime: "11:00", endTime: "12:00", assignmentId: "a-1", source: "kiro" },
    ]);
    expect(rejected).toBeNull();
    // 0 mutation：只有第一次成功的两个 block
    expect(useAppStore.getState().studyBlocks.length).toBe(2);

    const missing = useAppStore.getState().addStudyBlocksBatch([
      { title: "orphan", date: "2026-03-13", startTime: "10:00", endTime: "11:00", assignmentId: "a-gone", source: "kiro" },
    ]);
    expect(missing).toBeNull();

    expect(useAppStore.getState().addStudyBlocksBatch([])).toEqual([]);
  });
});

// ============================================================
// Update boundary
// ============================================================
describe("updateStudyBlock write boundary", () => {
  it("active standalone → true；active + eligible parent → true", () => {
    seed();
    actSet({
      studyBlocks: [
        { id: "sb-free", title: "自由", date: "2026-03-11", startTime: "10:00", endTime: "11:00", source: "manual" as const },
        { id: "sb-link", title: "关联", date: "2026-03-11", startTime: "12:00", endTime: "13:00", assignmentId: "a-1", source: "manual" as const },
      ],
    });
    expect(useAppStore.getState().updateStudyBlock("sb-free", { startTime: "10:30" })).toBe(true);
    expect(useAppStore.getState().updateStudyBlock("sb-link", { startTime: "12:30" })).toBe(true);
  });

  it("released → false 且 geometry 完全不变（reopen 后仍拒绝）", () => {
    seed({ status: "todo" });
    actSet({
      studyBlocks: [{ id: "sb-rel", title: "历史", date: "2026-03-11", startTime: "14:00", endTime: "15:00", assignmentId: "a-1", planningState: "released", source: "manual" as const }],
    });
    actSet({ assignments: [mkA({ status: "todo" })] }); // reopen：released 不复活
    const before = useAppStore.getState().studyBlocks[0];
    expect(useAppStore.getState().updateStudyBlock("sb-rel", { date: "2026-03-12", startTime: "09:00" })).toBe(false);
    const after = useAppStore.getState().studyBlocks[0];
    expect(after.date).toBe(before.date);
    expect(after.startTime).toBe(before.startTime);
    expect(after.planningState).toBe("released");
  });

  it.each([
    ["terminal parent", mkA({ status: "completed" })],
    ["missing parent", mkA({ id: "other" })],
  ])("%s 的 active block → false（V15 过去块同样不可移动）", (_name, parent) => {
    seed();
    actSet({
      assignments: [parent],
      studyBlocks: [{ id: "sb-hist", title: "过去计划", date: "2026-03-08", startTime: "09:00", endTime: "10:00", assignmentId: parent.id === "a-1" ? "a-1" : "a-1", source: "manual" as const }],
    });
    expect(useAppStore.getState().updateStudyBlock("sb-hist", { startTime: "11:00" })).toBe(false);
    expect(useAppStore.getState().studyBlocks[0].startTime).toBe("09:00");
  });

  it("reject 时 Reminder triggerAt 保持原值（Reminder 零副作用）", () => {
    seed({ status: "submitted" });
    actSet({
      studyBlocks: [{ id: "sb-r", title: "带提醒", date: "2026-03-11", startTime: "14:00", endTime: "15:00", assignmentId: "a-1", source: "manual" as const }],
      reminders: [
        { id: "r1", targetType: "studyBlock", targetId: "sb-r", timingMode: "relative", offsetMinutes: -30, triggerAt: "2026-03-11T13:30:00", status: "fired", source: "manual", title: "t", createdAt: "", updatedAt: "" } as never,
      ],
    });
    expect(useAppStore.getState().updateStudyBlock("sb-r", { startTime: "16:00" })).toBe(false);
    expect(useAppStore.getState().reminders[0].triggerAt).toBe("2026-03-11T13:30:00");
  });
});

describe("updateStudyBlocksBatch boundary", () => {
  const baseBlocks = (): StudyBlock[] => [
    { id: "b1", title: "一", date: "2026-03-11", startTime: "10:00", endTime: "11:00", assignmentId: "a-1", source: "manual" as const },
    { id: "b2", title: "二", date: "2026-03-12", startTime: "10:00", endTime: "11:00", assignmentId: "a-1", source: "manual" as const },
  ];

  it("全部 active + eligible → success", () => {
    seed({ status: "doing", blocks: baseBlocks() });
    const result = useAppStore.getState().updateStudyBlocksBatch([
      { id: "b1", patch: { date: "2026-03-13", startTime: "10:00", endTime: "11:00" } },
      { id: "b2", patch: { date: "2026-03-14", startTime: "10:00", endTime: "11:00" } },
    ]);
    expect(result).not.toBeNull();
  });

  it("任一 released / 任一 terminal-parent → null 且 geometry 完全保持、无 partial history", () => {
    seed({ status: "todo", blocks: baseBlocks() });
    actSet({
      studyBlocks: [
        ...baseBlocks(),
        { id: "b3", title: "已释放", date: "2026-03-15", startTime: "10:00", endTime: "11:00", planningState: "released", source: "manual" as const },
      ],
    });
    const beforeSnapshot = JSON.stringify(useAppStore.getState().studyBlocks.map((b) => [b.id, b.date, b.startTime]));
    const r1 = useAppStore.getState().updateStudyBlocksBatch([
      { id: "b1", patch: { date: "2026-03-20", startTime: "10:00", endTime: "11:00" } },
      { id: "b3", patch: { date: "2026-03-21", startTime: "10:00", endTime: "11:00" } },
    ]);
    expect(r1).toBeNull();

    actSet({ assignments: [mkA({ status: "completed" })] }); // parent terminal → b1/b2 也被拒
    const r2 = useAppStore.getState().updateStudyBlocksBatch([
      { id: "b1", patch: { date: "2026-03-20", startTime: "10:00", endTime: "11:00" } },
    ]);
    expect(r2).toBeNull();

    const afterSnapshot = JSON.stringify(useAppStore.getState().studyBlocks.map((b) => [b.id, b.date, b.startTime]));
    expect(afterSnapshot).toBe(beforeSnapshot);
  });
});

// ============================================================
// 纯 helper 直测（与 Store 行为对齐）
// ============================================================
describe("validateStudyBlockPlanningWrite helper", () => {
  it("released / parent-missing / parent-terminal 分别给出 reason；standalone ok", () => {
    const assignments = [{ id: "a1", status: "todo" as const }];
    expect(validateStudyBlockPlanningWrite({ planningState: "released", assignmentId: undefined }, assignments)).toEqual({ ok: false, reason: "released" });
    expect(validateStudyBlockPlanningWrite({ assignmentId: "gone" }, assignments)).toEqual({ ok: false, reason: "parent-missing" });
    expect(validateStudyBlockPlanningWrite({ assignmentId: "a2" }, [{ id: "a2", status: "completed" as const }])).toEqual({ ok: false, reason: "parent-terminal" });
    expect(validateStudyBlockPlanningWrite({ assignmentId: undefined }, assignments)).toEqual({ ok: true });
    expect(validateStudyBlockPlanningWrite({ assignmentId: "a1" }, assignments)).toEqual({ ok: true });
  });
});

// ============================================================
// UI race：Unscheduled drag + direct drag + undo（真实 pointer 流）
// ============================================================
const MON = "2026-03-09";
const TUE = "2026-03-10";

describe("UI race guards（Timeline）", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-03-09T12:00:00").getTime() });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it("direct drag：拖拽期间 parent completed → drop 被拒 + warning toast + geometry 保持", () => {
    seed({
      week: 1,
      blocks: [{ id: "sb-drag", title: "实证报告学习", date: MON, startTime: "14:00", endTime: "15:00", assignmentId: "a-1", source: "manual" as const }],
    });
    render(<TimelineWorkspace />);
    const el = document.querySelector('[data-testid="timeline-study-block"]') as HTMLElement;
    // jsdom 无布局：为日列注入真实高度，让 pointerMinutes/candidate 计算生效
    const dayCol = document.querySelector('[data-timetable-day]') as HTMLElement;
    vi.spyOn(dayCol, 'getBoundingClientRect').mockReturnValue({ top: 0, left: 0, right: 100, bottom: 1440, width: 100, height: 1440, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    fireEvent.pointerDown(el, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 100, clientY: 130, pointerId: 1 });
      useAppStore.getState().updateAssignmentStatus("a-1", "completed"); // 拖拽中 terminal → V15 release
    });
    fireEvent.pointerUp(window, { pointerId: 1 });

    const block = useAppStore.getState().studyBlocks.find((b) => b.id === "sb-drag")!;
    expect(block.planningState).toBe("released");
    expect(block.date).toBe(MON); // geometry 未变
    expect(useToastStore.getState().toasts.some((t) => t.message.includes("学习计划状态已变化，未调整时间"))).toBe(true);
  }, 20000);

  it("Undo race：move 成功后 parent completed → 点击撤销被拒 + 无法撤销 warning", () => {
    seed({
      status: "doing",
      week: 1,
      blocks: [{ id: "sb-move", title: "可移动", date: TUE, startTime: "14:00", endTime: "15:00", assignmentId: "a-1", source: "manual" as const }],
    });
    render(<TimelineWorkspace />);
    const el = document.querySelector('[data-testid="timeline-study-block"]') as HTMLElement;
    // jsdom 无布局：为日列注入真实高度，让 pointerMinutes/candidate 计算生效
    const dayCol = document.querySelector('[data-timetable-day]') as HTMLElement;
    vi.spyOn(dayCol, 'getBoundingClientRect').mockReturnValue({ top: 0, left: 0, right: 100, bottom: 1440, width: 100, height: 1440, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);

    // 第一次 move（parent doing）→ 成功 + Undo toast
    fireEvent.pointerDown(el, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 100, clientY: 130, pointerId: 1 });
    });
    fireEvent.pointerUp(window, { pointerId: 1 });
    const moved = useAppStore.getState().studyBlocks.find((b) => b.id === "sb-move")!;
    expect(moved.date).not.toBe(TUE); // 已移动到新位置
    const undoToast = useToastStore.getState().toasts.find((t) => t.actionLabel === "撤销");
    expect(undoToast).toBeTruthy();

    // Toast 仍在期间：parent completed → V15 release（moved 位置被冻结为历史）
    act(() => {
      useAppStore.getState().updateAssignmentStatus("a-1", "completed");
    });
    expect(useAppStore.getState().studyBlocks.find((b) => b.id === "sb-move")!.planningState).toBe("released");

    // 用户点击撤销 → Store boundary 拒绝移动 released 历史计划 + 克制 warning
    undoToast!.onAction?.();
    expect(useToastStore.getState().toasts.some((t) => t.message.includes("无法撤销时间调整"))).toBe(true);
    const finalBlock = useAppStore.getState().studyBlocks.find((b) => b.id === "sb-move")!;
    expect(finalBlock.date).toBe(moved.date); // 未被再次移动
    expect(finalBlock.planningState).toBe("released");
  }, 20000);

  it("Unscheduled drag：pointerdown 后任务 completed → pointerup 不创建 block + warning", () => {
    seed({ status: "todo", week: 1 });
    render(<TimelineWorkspace />);
    const item = document.querySelector('[data-testid="timeline-unscheduled-item"]') as HTMLElement;
    fireEvent.pointerDown(item, { button: 0, clientX: 200, clientY: 200, pointerId: 5 });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 260, clientY: 300, pointerId: 5 });
      useAppStore.getState().updateAssignmentStatus("a-1", "completed"); // 拖拽中 terminal
    });
    fireEvent.pointerUp(window, { pointerId: 5 });

    // 无 linked StudyBlock 被创建（standalone 也不应有——本次是失败的一次 planning write）
    const linked = useAppStore.getState().studyBlocks.filter((b) => b.assignmentId === "a-1");
    expect(linked).toHaveLength(0);
    expect(useToastStore.getState().toasts.some((t) => t.message.includes("任务状态已变化，未创建学习计划"))).toBe(true);
  }, 20000);
});
