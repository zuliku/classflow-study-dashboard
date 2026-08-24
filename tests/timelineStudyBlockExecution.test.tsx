// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
  waitFor,
  within,
} from "@testing-library/react";

// Polyfills
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

vi.mock("@/hooks/useKiroHandoff", () => ({
  useKiroHandoff: () => ({
    handoffPrompt: vi.fn(),
    handoffAssignmentPrompt: vi.fn(),
    openForWeek: vi.fn(),
    openForGroupProject: vi.fn(),
  }),
}));
vi.mock("@/components/kiro/KiroSessionProvider", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/components/kiro/KiroSessionProvider")>();
  return {
    ...mod,
    KiroSessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useKiroSession: () => ({
      planningPreview: null,
      setPlanningPreview: vi.fn(),
      studyRebalancePreview: null,
      setStudyRebalancePreview: vi.fn(),
      handoffPrompt: null,
    }),
    useKiroSessionMeta: () => ({ kiroBusy: false }),
    useKiroSessionActions: () => ({ claimEmptyIntro: vi.fn() }),
  };
});

import { TimelineWorkspace } from "@/components/timeline/TimelineWorkspace";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import type { Assignment, Course, CourseSchedule, Semester, StudyBlock } from "@/types";

/**
 * Workflow UX V8 —— StudyBlock → Task Execution Handoff：
 * linked StudyBlock 主内容区可打开 Assignment Drawer（留在 Timeline 上下文）；
 * standalone 不伪造任务语义；click vs drag suppression；Delete 独立；
 * CourseTaskMarker linked row 可打开具体 Assignment。
 */

const COURSE_JL: Course = {
  id: "c-jl",
  name: "计量经济学",
  code: "ECON301",
  teacher: "",
  classroom: "",
  credit: 2,
  description: "",
  bgHex: "#E3E6E0",
  borderHex: "#CCCBC4",
  textHex: "#313032",
  materials: [],
} as unknown as Course;

const SEMESTER: Semester = {
  id: "s1",
  name: "2026秋",
  startDate: "2026-08-31",
  totalWeeks: 16,
};
/** 第 N 周周一 + dayOffset */
const weekDate = (week: number, dayOffset = 0): string => {
  const d = new Date(`${SEMESTER.startDate}T00:00:00`);
  d.setDate(d.getDate() + (week - 1) * 7 + dayOffset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};
const WEEK7_MON = weekDate(7, 0); // 无课日：普通 StudyBlock 用
const WEEK7_TUE = weekDate(7, 1); // 周二（有课日）

const SCHEDULE: CourseSchedule = {
  id: "sch-1",
  courseId: "c-jl",
  dayOfWeek: 2,
  startTime: "14:00",
  endTime: "16:00",
  location: "",
  weeks: [7],
} as unknown as CourseSchedule;

const LINKED: Assignment = {
  id: "a-exec",
  courseId: "c-jl",
  title: "计量经济学实证报告",
  description: "",
  ddl: "2026-11-01T23:59:00",
  priority: "high",
  status: "doing",
  progress: 30,
  tags: [],
} as unknown as Assignment;

/** linked StudyBlock 工厂：title 固定（aria-label 断言依赖） */
const mkLinkedBlock = (id: string): StudyBlock =>
  ({
    id,
    assignmentId: "a-exec",
    courseId: "c-jl",
    title: "实证报告学习",
    date: WEEK7_MON,
    startTime: "14:00",
    endTime: "15:00",
    source: "manual",
  }) as unknown as StudyBlock;

const mkStandaloneBlock = (id: string, date: string): StudyBlock =>
  ({
    id,
    courseId: "c-jl",
    title: `自由复习-${id}`,
    date,
    startTime: "09:00",
    endTime: "10:00",
    source: "manual",
  }) as unknown as StudyBlock;

beforeEach(() => {
  cleanup();
  const prefs = useAppStore.getState().preferences;
  useAppStore.setState({
    courses: [COURSE_JL],
    schedules: [SCHEDULE],
    calendarMarks: [],
    assignments: [{ ...LINKED }],
    studyBlocks: [],
    reminders: [],
    groupProjects: [],
    scheduleOccurrenceOverrides: [],
    semester: { ...SEMESTER },
    currentSemesterWeek: 7,
    activeTab: "timetable" as never,
    selectedAssignmentId: null,
    selectedCourseId: null,
    selectedCalendarMarkId: null,
    pendingTimelineArrangeAssignmentId: null,
    preferences: { ...prefs, enableScheduleDirectManipulation: true },
  });
});
afterEach(() => {
  cleanup();
});

function seedBlocks(blocks: StudyBlock[]) {
  useAppStore.setState({ studyBlocks: blocks });
}

describe("Linked StudyBlock → Assignment Drawer", () => {
  it("DM disabled：点击主区域 → 打开 Assignment 且 activeTab 仍是 timetable", () => {
    seedBlocks([mkLinkedBlock("sb-1", WEEK7_MON)]);
    const prefs = useAppStore.getState().preferences;
    useAppStore.setState({
      preferences: { ...prefs, enableScheduleDirectManipulation: false },
    });
    render(<TimelineWorkspace />);

    fireEvent.click(screen.getByLabelText("打开任务《实证报告学习》"));

    expect(useAppStore.getState().selectedAssignmentId).toBe("a-exec");
    expect(useAppStore.getState().activeTab).toBe("timetable");
  });

  it("linked 渲染 main button；standalone 无任务语义", () => {
    seedBlocks([
      mkLinkedBlock("sb-a", WEEK7_MON),
      mkStandaloneBlock("sb-b", weekDate(7, 2)),
    ]);
    render(<TimelineWorkspace />);

    expect(screen.getByLabelText("打开任务《实证报告学习》")).toBeTruthy();
    // standalone wrapper 内无 open-task 按钮
    const standaloneWrapper = screen
      .getByText(/自由复习/)
      .closest('[data-testid="timeline-study-block"]')!;
    expect(
      standaloneWrapper.querySelector('[data-testid="study-block-open-task"]')
    ).toBeNull();
  });

  it("stale assignmentId → 不渲染打开入口，点击不开空 Drawer", () => {
    seedBlocks([
      {
        ...mkLinkedBlock("sb-stale"),
        assignmentId: "a-gone",
      } as unknown as StudyBlock,
    ]);
    render(<TimelineWorkspace />);
    expect(
      document.querySelector('[data-testid="study-block-open-task"]')
    ).toBeNull();
    fireEvent.click(document.querySelector('[data-testid="timeline-study-block"]')!);
    expect(useAppStore.getState().selectedAssignmentId).toBeNull();
  });
});

describe("Click vs drag suppression", () => {
  function getBlockEl(): HTMLElement {
    return document.querySelector(
      '[data-testid="timeline-study-block"]'
    ) as HTMLElement;
  }

  it(
    "轻点（<5px）→ click 打开 Assignment 且块不动",
    async () => {
      seedBlocks([mkLinkedBlock("sb-tap", WEEK7_MON)]);
      render(<TimelineWorkspace />);
      const el = getBlockEl();
      const before = useAppStore
        .getState()
        .studyBlocks.find((b) => b.id === "sb-tap")!;

      fireEvent.pointerDown(el, { button: 0, clientX: 50, clientY: 50, pointerId: 1 });
      fireEvent.pointerUp(el, { pointerId: 1 });
      fireEvent.click(el);

      expect(useAppStore.getState().selectedAssignmentId).toBe("a-exec");
      const after = useAppStore
        .getState()
        .studyBlocks.find((b) => b.id === "sb-tap")!;
      expect(after.date).toBe(before.date);
      expect(after.startTime).toBe(before.startTime);
    },
    10000
  );

  it(
    "拖动 >5px → Move engagement（ghost 出现）且 Drawer 不打开；下一次 click 正常打开",
    async () => {
      seedBlocks([mkLinkedBlock("sb-drag", WEEK7_MON)]);
      render(<TimelineWorkspace />);
      const el = getBlockEl();

      fireEvent.pointerDown(el, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
      act(() => {
        fireEvent.pointerMove(window, { clientX: 100, clientY: 114, pointerId: 1 });
      });
      // jsdom 几何全 0 → candidate 可能 null（pointer 不在有效列），此处只断言 Drawer 不打开

      fireEvent.pointerUp(window, { pointerId: 1 });
      expect(useAppStore.getState().selectedAssignmentId).toBeNull();

      // suppression 重置后正常打开
      fireEvent.pointerDown(el, { button: 0, clientX: 100, clientY: 100, pointerId: 2 });
      fireEvent.pointerUp(el, { pointerId: 2 });
      fireEvent.click(el);
      expect(useAppStore.getState().selectedAssignmentId).toBe("a-exec");
    },
    10000
  );

  it("invalid drag（拖出网格）→ Drawer 不打开", async () => {
    seedBlocks([mkLinkedBlock("sb-inv", WEEK7_MON)]);
    render(<TimelineWorkspace />);
    const el = getBlockEl();
    fireEvent.pointerDown(el, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    act(() => {
      fireEvent.pointerMove(window, { clientX: -500, clientY: -500, pointerId: 1 });
    });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(useAppStore.getState().selectedAssignmentId).toBeNull();
  });
});

describe("StudyBlock delete regression", () => {
  it("删除按钮独立：deleteStudyBlock 执行、selection 不变、pointerdown 不 engage drag", () => {
    seedBlocks([mkLinkedBlock("sb-del", WEEK7_MON)]);
    render(<TimelineWorkspace />);
    const delBtn = screen.getByLabelText("删除学习计划 实证报告学习");
    fireEvent.pointerDown(delBtn);
    fireEvent.click(delBtn);

    expect(useAppStore.getState().studyBlocks.length).toBe(0);
    expect(useAppStore.getState().selectedAssignmentId).toBeNull();
  });
});

// ============================================================
// CourseTaskMarker rows → Assignment
// ============================================================
const MARKER_BLOCK_A: StudyBlock = {
  id: "mk-a",
  assignmentId: "a-exec",
  courseId: "c-jl",
  title: "重叠学习 A",
  date: weekDate(7, 1), // 周二有课 → 重叠生成 marker
  startTime: "14:10",
  endTime: "15:00",
  source: "manual",
} as unknown as StudyBlock;

describe("CourseTaskMarker rows → Assignment", () => {
  function markerHarness(blocks: StudyBlock[]) {
    seedBlocks(blocks);
    render(<TimelineWorkspace />);
    const dot = screen.getByLabelText(/个学习任务与本课程时间重叠/);
    fireEvent.mouseEnter(dot);
    return dot;
  }

  it("linked row 点击 → semantic close Floating Detail + selectedAssignmentId 设置", async () => {
    markerHarness([MARKER_BLOCK_A]);

    const rowBtn = screen.getByRole("button", { name: "打开任务 重叠学习 A" });
    fireEvent.click(rowBtn);
    await waitFor(() => {
      expect(useAppStore.getState().selectedAssignmentId).toBe("a-exec");
    });
    await waitFor(() => {
      expect(floatingDetail()).toBeNull();
    });
  });

  it("standalone row：只读展示（无 button），不可打开 Assignment", () => {
    markerHarness([
      {
        id: "sb-free-mk",
        courseId: "c-jl",
        title: "自由复习",
        date: WEEK7_TUE,
        startTime: "14:30",
        endTime: "15:30",
        source: "manual",
      } as unknown as StudyBlock,
    ]);
    // standalone 与课程重叠 → marker 出现但行不可点击
    const dot = screen.getByLabelText(/个学习任务与本课程时间重叠/);
    fireEvent.mouseEnter(dot);
    const standaloneRowTitle = screen.getAllByText(/自由复习/)[0];
    expect(standaloneRowTitle.closest("button")).toBeNull();
    fireEvent.click(standaloneRowTitle);
    expect(useAppStore.getState().selectedAssignmentId).toBeNull();
  });

  it("marker hover bridge：mouseLeave 后 detail 保持（100ms grace 内）", () => {
    markerHarness([MARKER_BLOCK_A]);
    const dot = screen.getByLabelText(/个学习任务与本课程时间重叠/);
    // mouseLeave → grace 100ms 后才关闭
    fireEvent.mouseLeave(dot);
    // detail 仍在（grace 内）
    expect(floatingDetail()).toBeTruthy();
  });
});

// within Floating Detail 的行定位辅助
function withinFloatingDetailRow(title: string): HTMLElement {
  const detail = screen
    .getAllByText(title)
    .map((el) => el.closest("button"))
    .find((b): b is HTMLButtonElement => !!b && !!b.textContent?.includes(title));
  if (!detail) throw new Error(`row button not found: ${title}`);
  return detail;
}

function floatingDetail(): HTMLElement | null {
  return document.querySelector('[aria-label="重叠的学习任务"]');
}
