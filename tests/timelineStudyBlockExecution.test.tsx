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
// jsdom 无 matchMedia：仅 "(pointer: fine)" 命中（StudyBlock direct manipulation 依赖），
// 其余（prefers-reduced-motion 等）保持 false，避免误入 reduced-motion 分支
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
if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
}
// V9 engagement 路径依赖 elementFromPoint（jsdom 未实现）：返回 null = 「pointer 不在有效 day 列」
(document as unknown as Record<string, unknown>).elementFromPoint = () => null;
// jsdom 无 PointerEvent：fireEvent.pointerDown 会退化为普通 Event（button/clientX 全丢），
// StudyBlock drag 的 button!==0 守卫永远早退。补一个最小 PointerEvent（MouseEvent 携带 pointerId）。
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
    useKiroSessionActions: () => ({
      claimEmptyIntro: vi.fn(),
      openSidecar: vi.fn(),
      closeSidecar: vi.fn(),
      expandSidecar: vi.fn(),
      minimizeSidecar: vi.fn(),
      restoreSidecar: vi.fn(),
    }),
  };
});

import { TimelineWorkspace } from "@/components/timeline/TimelineWorkspace";
import { AssignmentDrawer } from "@/components/drawers/AssignmentDrawer";
import { useAppStore } from "@/store/useAppStore";
import type { Assignment, Course, CourseSchedule, FocusSession, Semester, StudyBlock } from "@/types";

/**
 * Workflow UX V9 —— StudyBlock → Assignment Execution Handoff：
 * - linked StudyBlock 主区域是真实 <button>（原生键盘语义），与 Delete button 为 sibling（禁止 nested interactive）
 * - standalone 用普通 div，不伪造任务语义
 * - click vs drag suppression 只作用于 pointer 生成的 click（detail>0）；键盘激活不受 stale suppression 影响
 * - CourseTaskMarker：Portal 面板 outside 判定由 FloatingTimelineDetail 统一持有（anchor + panel 双边包含）；
 *   面板内 pointerdown 不抢先 semantic close；面板外 pointerdown 关闭
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
const mkLinkedBlock = (id: string, date: string = WEEK7_MON): StudyBlock =>
  ({
    id,
    assignmentId: "a-exec",
    courseId: "c-jl",
    title: "实证报告学习",
    date,
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
    focusSessions: [],
    preferences: { ...prefs, enableScheduleDirectManipulation: true },
  });
});
afterEach(() => {
  cleanup();
});

function seedBlocks(blocks: StudyBlock[]) {
  useAppStore.setState({ studyBlocks: blocks });
}

function getStudyBlockEl(): HTMLElement {
  return document.querySelector('[data-testid="timeline-study-block"]') as HTMLElement;
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
    // standalone wrapper 自身也不携带可聚焦语义（V9：wrapper 无 role / tabIndex）
    expect(standaloneWrapper.getAttribute("role")).toBeNull();
    expect(standaloneWrapper.getAttribute("tabindex")).toBeNull();
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

// ============================================================
// V9 DOM Semantics：wrapper / main / delete 三者关系
// ============================================================
describe("StudyBlock DOM semantics (no nested interactive)", () => {
  it("linked：wrapper 是普通 div（无 role/tabIndex）；main 与 delete 为 sibling button", () => {
    seedBlocks([mkLinkedBlock("sb-dom", WEEK7_MON)]);
    render(<TimelineWorkspace />);

    const wrapper = getStudyBlockEl();
    // wrapper 只负责 geometry / drag pointerdown / hover，不携带 interactive 语义
    expect(wrapper.tagName).toBe("DIV");
    expect(wrapper.getAttribute("role")).toBeNull();
    expect(wrapper.getAttribute("tabindex")).toBeNull();

    const mainBtn = screen.getByLabelText("打开任务《实证报告学习》") as HTMLElement;
    const delBtn = screen.getByLabelText("删除学习计划 实证报告学习") as HTMLElement;
    expect(mainBtn.tagName).toBe("BUTTON");
    expect(delBtn.tagName).toBe("BUTTON");
    // 两者都在 wrapper 内、且互不为后代（sibling）
    expect(wrapper.contains(mainBtn)).toBe(true);
    expect(wrapper.contains(delBtn)).toBe(true);
    expect(mainBtn.contains(delBtn)).toBe(false);
    expect(delBtn.contains(mainBtn)).toBe(false);
  });
});

// ============================================================
// Keyboard regression（原生 button 语义 + suppression 豁免）
// ============================================================
describe("Keyboard activation", () => {
  function engageDrag(el: HTMLElement, pointerId = 1) {
    fireEvent.pointerDown(el, { button: 0, clientX: 100, clientY: 100, pointerId });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 100, clientY: 114, pointerId });
    });
    fireEvent.pointerUp(window, { pointerId });
  }

  it("main button Enter → 打开 Assignment", () => {
    seedBlocks([mkLinkedBlock("sb-kb-e", WEEK7_MON)]);
    render(<TimelineWorkspace />);
    const mainBtn = screen.getByLabelText("打开任务《实证报告学习》");
    // 原生 button 键盘激活 = 浏览器派发 detail=0 的 click
    fireEvent.keyDown(mainBtn, { key: "Enter" });
    fireEvent.click(mainBtn);
    expect(useAppStore.getState().selectedAssignmentId).toBe("a-exec");
  });

  it("main button Space → 打开 Assignment", () => {
    seedBlocks([mkLinkedBlock("sb-kb-s", WEEK7_MON)]);
    render(<TimelineWorkspace />);
    const mainBtn = screen.getByLabelText("打开任务《实证报告学习》");
    fireEvent.keyDown(mainBtn, { key: " " });
    fireEvent.keyUp(mainBtn, { key: " " });
    fireEvent.click(mainBtn);
    expect(useAppStore.getState().selectedAssignmentId).toBe("a-exec");
  });

  it("stale suppression 不吞键盘激活：drag engage 后 Enter 仍打开", () => {
    seedBlocks([mkLinkedBlock("sb-kb-stale", WEEK7_MON)]);
    render(<TimelineWorkspace />);
    const el = getStudyBlockEl();
    const mainBtn = screen.getByLabelText("打开任务《实证报告学习》");

    // drag engagement（>5px）：suppression 置 true 且未被消费
    engageDrag(el);
    expect(useAppStore.getState().selectedAssignmentId).toBeNull();

    // 键盘激活（detail=0 的 click）：不经 pointer session，不得被吞
    fireEvent.keyDown(mainBtn, { key: "Enter" });
    fireEvent.click(mainBtn);
    expect(useAppStore.getState().selectedAssignmentId).toBe("a-exec");
  });

  it("Delete 上按 Enter → 删除 StudyBlock 且不打开 Assignment", () => {
    seedBlocks([mkLinkedBlock("sb-kdel", WEEK7_MON)]);
    render(<TimelineWorkspace />);
    const delBtn = screen.getByLabelText("删除学习计划 实证报告学习");
    fireEvent.keyDown(delBtn, { key: "Enter" });
    fireEvent.click(delBtn);

    expect(useAppStore.getState().studyBlocks.length).toBe(0);
    expect(useAppStore.getState().selectedAssignmentId).toBeNull();
  });

  it("Delete 上按 Space → 同样删除且不打开 Assignment", () => {
    seedBlocks([mkLinkedBlock("sb-kdel-s", WEEK7_MON)]);
    render(<TimelineWorkspace />);
    const delBtn = screen.getByLabelText("删除学习计划 实证报告学习");
    fireEvent.keyDown(delBtn, { key: " " });
    fireEvent.keyUp(delBtn, { key: " " });
    fireEvent.click(delBtn);

    expect(useAppStore.getState().studyBlocks.length).toBe(0);
    expect(useAppStore.getState().selectedAssignmentId).toBeNull();
  });
});

// ============================================================
// Click vs drag suppression（pointer session）
// ============================================================
describe("Click vs drag suppression", () => {
  it(
    "轻点（<5px 抖动）→ click 打开 Assignment 且块不动、未进入 drag 态",
    async () => {
      seedBlocks([mkLinkedBlock("sb-tap", WEEK7_MON)]);
      render(<TimelineWorkspace />);
      const el = getStudyBlockEl();
      const mainBtn = screen.getByLabelText("打开任务《实证报告学习》");
      const before = useAppStore
        .getState()
        .studyBlocks.find((b) => b.id === "sb-tap")!;

      fireEvent.pointerDown(el, { button: 0, clientX: 50, clientY: 50, pointerId: 1 });
      act(() => {
        fireEvent.pointerMove(window, { clientX: 53, clientY: 51, pointerId: 1 });
      });
      fireEvent.pointerUp(window, { pointerId: 1 });
      // 未跨阈值：drag 未 engagement
      expect(document.body.dataset.dragActive).not.toBe("1");
      // 真实 tap 的 click 为 pointer 生成（detail>=1）
      fireEvent.click(mainBtn, { detail: 1 });

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
    "拖动 >5px → Move engagement（dragActive）且 Drawer 不打开",
    async () => {
      seedBlocks([mkLinkedBlock("sb-drag", WEEK7_MON)]);
      render(<TimelineWorkspace />);
      const el = getStudyBlockEl();

      fireEvent.pointerDown(el, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
      act(() => {
        fireEvent.pointerMove(window, { clientX: 100, clientY: 114, pointerId: 1 });
      });
      expect(document.body.dataset.dragActive).toBe("1");
      // jsdom 几何全 0 → candidate 可能 null（pointer 不在有效列），此处只断言 Drawer 不打开

      fireEvent.pointerUp(window, { pointerId: 1 });
      expect(document.body.dataset.dragActive).not.toBe("1");
      expect(useAppStore.getState().selectedAssignmentId).toBeNull();
    },
    10000
  );

  it(
    "拖动释放产生的 pointer click（detail=1）被吞一次；下一次正常 click 恢复",
    async () => {
      seedBlocks([mkLinkedBlock("sb-rec", WEEK7_MON)]);
      render(<TimelineWorkspace />);
      const el = getStudyBlockEl();
      const mainBtn = screen.getByLabelText("打开任务《实证报告学习》");

      fireEvent.pointerDown(el, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
      act(() => {
        fireEvent.pointerMove(window, { clientX: 108, clientY: 100, pointerId: 1 });
      });
      fireEvent.pointerUp(window, { pointerId: 1 });

      // 拖动释放的 trailing click：被 suppression 消费（并重置）
      fireEvent.click(mainBtn, { detail: 1 });
      expect(useAppStore.getState().selectedAssignmentId).toBeNull();

      // 下一次正常 click：恢复打开
      fireEvent.click(mainBtn, { detail: 1 });
      expect(useAppStore.getState().selectedAssignmentId).toBe("a-exec");
    },
    10000
  );

  it("invalid drag（拖出网格）→ Drawer 不打开", async () => {
    seedBlocks([mkLinkedBlock("sb-inv", WEEK7_MON)]);
    render(<TimelineWorkspace />);
    const el = getStudyBlockEl();
    fireEvent.pointerDown(el, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    act(() => {
      fireEvent.pointerMove(window, { clientX: -500, clientY: -500, pointerId: 1 });
    });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(useAppStore.getState().selectedAssignmentId).toBeNull();
  });
});

// ============================================================
// Delete action independence
// ============================================================
describe("StudyBlock delete regression", () => {
  it("删除按钮独立：deleteStudyBlock 执行、selection 不变、pointerdown 不 engage drag", () => {
    seedBlocks([mkLinkedBlock("sb-del", WEEK7_MON)]);
    render(<TimelineWorkspace />);
    const delBtn = screen.getByLabelText("删除学习计划 实证报告学习");
    fireEvent.pointerDown(delBtn);
    // delete pointerdown 已 stopPropagation → wrapper 不进入 pending/drag
    act(() => {
      fireEvent.pointerMove(window, { clientX: 300, clientY: 300, pointerId: 9 });
    });
    expect(document.body.dataset.dragActive).not.toBe("1");
    expect(document.querySelector('[data-testid="study-block-ghost"]')).toBeNull();

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

const MARKER_ASSIGNMENT_B: Assignment = {
  ...LINKED,
  id: "a-exec-b",
  title: "线性代数习题集",
} as unknown as Assignment;

const MARKER_BLOCK_B: StudyBlock = {
  id: "mk-b",
  assignmentId: "a-exec-b",
  courseId: "c-jl",
  title: "重叠学习 B",
  date: weekDate(7, 1),
  startTime: "15:00",
  endTime: "15:50",
  source: "manual",
} as unknown as StudyBlock;

describe("CourseTaskMarker rows → Assignment", () => {
  function markerHarness(blocks: StudyBlock[]) {
    seedBlocks(blocks);
    render(<TimelineWorkspace />);
    const dot = screen.getByLabelText(/个学习任务与本课程时间重叠/) as HTMLElement;
    fireEvent.mouseEnter(dot);
    return dot;
  }

  it("marker click：只 toggle 打开面板，不改 selection", () => {
    seedBlocks([MARKER_BLOCK_A]);
    render(<TimelineWorkspace />);
    const dot = screen.getByLabelText(/个学习任务与本课程时间重叠/) as HTMLElement;
    // 初始关闭；click toggle → 只打开面板（不导航）
    expect(dot.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(dot);
    expect(dot.getAttribute("aria-expanded")).toBe("true");
    expect(floatingDetail()).toBeTruthy();
    expect(useAppStore.getState().selectedAssignmentId).toBeNull();
  });

  it("linked row：真实 pointerdown/up/click 序列 → 正确打开 Assignment + semantic close", async () => {
    markerHarness([MARKER_BLOCK_A]);

    const rowBtn = screen.getByRole("button", { name: "打开任务 重叠学习 A" });
    fireEvent.pointerDown(rowBtn);
    fireEvent.pointerUp(rowBtn);
    fireEvent.click(rowBtn);
    await waitFor(() => {
      expect(useAppStore.getState().selectedAssignmentId).toBe("a-exec");
    });
    await waitFor(() => {
      expect(floatingDetail()).toBeNull();
    });
  });

  it("panel 内 pointerdown：不被 outside 契约抢先 semantic close（aria-expanded 保持 true）", () => {
    const dot = markerHarness([MARKER_BLOCK_A]);
    const rowBtn = screen.getByRole("button", { name: "打开任务 重叠学习 A" });
    const panel = floatingDetail();
    expect(panel).toBeTruthy();
    expect(panel!.contains(rowBtn)).toBe(true);

    fireEvent.pointerDown(rowBtn);
    expect(dot.getAttribute("aria-expanded")).toBe("true");
    fireEvent.pointerDown(panel!);
    expect(dot.getAttribute("aria-expanded")).toBe("true");

    // 随后的完整 click 流程仍可用
    fireEvent.click(rowBtn);
    expect(useAppStore.getState().selectedAssignmentId).toBe("a-exec");
  });

  it("panel 外 pointerdown（body 其它区域）→ semantic close", async () => {
    const dot = markerHarness([MARKER_BLOCK_A]);
    expect(dot.getAttribute("aria-expanded")).toBe("true");

    fireEvent.pointerDown(document.body);
    expect(dot.getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => {
      expect(floatingDetail()).toBeNull();
    });
  });

  it("多个 linked rows：点击 B → 打开 B 对应实体", async () => {
    useAppStore.setState({ assignments: [{ ...LINKED }, { ...MARKER_ASSIGNMENT_B }] });
    markerHarness([MARKER_BLOCK_A, MARKER_BLOCK_B]);

    // outside 契约存在下，rowB 的 pointerdown 不得提前关闭导致 action 丢失
    const rowB = screen.getByRole("button", { name: "打开任务 重叠学习 B" });
    fireEvent.pointerDown(rowB);
    fireEvent.pointerUp(rowB);
    fireEvent.click(rowB);
    await waitFor(() => {
      expect(useAppStore.getState().selectedAssignmentId).toBe("a-exec-b");
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

  it("Esc → 关闭 panel（semantic open ownership 保持）", async () => {
    markerHarness([MARKER_BLOCK_A]);
    expect(floatingDetail()).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(floatingDetail()).toBeNull();
    });
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

// ============================================================
// Workflow UX V10 —— StudyBlock Active Focus Awareness
// ============================================================
const FOCUS_STARTED_MON_1407 = new Date(`${WEEK7_MON}T14:07:00`).getTime();
const FOCUS_STARTED_TUE_1430 = new Date(`${WEEK7_TUE}T14:30:00`).getTime();

const mkActiveFocus = (over: Partial<FocusSession> = {}): FocusSession =>
  ({
    id: "f-anchor",
    plannedMinutes: 25,
    startedAt: FOCUS_STARTED_MON_1407,
    activeStartedAt: FOCUS_STARTED_MON_1407,
    accumulatedActiveMs: 0,
    status: "running",
    assignmentId: "a-exec",
    source: "manual",
    createdAt: FOCUS_STARTED_MON_1407,
    updatedAt: FOCUS_STARTED_MON_1407,
    ...over,
  }) as FocusSession;

describe("StudyBlock focus anchor visual", () => {
  it("startedAt 命中 block → 对应 block 存在 focus state（aria + 状态文案）", () => {
    seedBlocks([mkLinkedBlock("sb-f1", WEEK7_MON)]);
    useAppStore.setState({ focusSessions: [mkActiveFocus()] });
    render(<TimelineWorkspace />);

    expect(
      screen.getByLabelText("打开任务《实证报告学习》，该任务正在专注")
    ).toBeTruthy();
    const blockEl = getStudyBlockEl();
    expect(within(blockEl).getByText("专注中")).toBeTruthy();
  });

  it("同 Assignment 第二个 block（时间不含 startedAt）→ 无 focus state", () => {
    seedBlocks([
      mkLinkedBlock("sb-f2a", WEEK7_MON), // 14:00–15:00 ← anchor
      {
        ...mkLinkedBlock("sb-f2b", WEEK7_MON),
        title: "另一段学习",
        startTime: "19:00",
        endTime: "20:00",
      } as unknown as StudyBlock,
    ]);
    useAppStore.setState({ focusSessions: [mkActiveFocus()] }); // 14:07 只落在第一段
    render(<TimelineWorkspace />);

    expect(
      screen.getByLabelText("打开任务《实证报告学习》，该任务正在专注")
    ).toBeTruthy();
    // 第二段：普通 aria（无 suffix）、无状态文案
    expect(screen.getByLabelText("打开任务《另一段学习》")).toBeTruthy();
    const second = screen
      .getByText("另一段学习")
      .closest('[data-testid="timeline-study-block"]') as HTMLElement;
    expect(within(second).queryByText("专注中")).toBeNull();
  });

  it("startedAt 不在任何 block 内 → 任何 block 都不标（Header chip 仍显示）", () => {
    seedBlocks([
      mkLinkedBlock("sb-f3a", WEEK7_MON),
      {
        ...mkLinkedBlock("sb-f3b", WEEK7_MON),
        title: "晚间学习",
        startTime: "19:00",
        endTime: "20:00",
      } as unknown as StudyBlock,
    ]);
    useAppStore.setState({
      focusSessions: [
        mkActiveFocus({ startedAt: new Date(`${WEEK7_MON}T17:30:00`).getTime() }),
      ],
    });
    render(<TimelineWorkspace />);

    expect(screen.getByLabelText("打开任务《实证报告学习》")).toBeTruthy();
    expect(screen.getByLabelText("打开任务《晚间学习》")).toBeTruthy();
    expect(screen.queryByText("专注中")).toBeNull(); // block 层无；chip 文本为「剩余 · 专注中」不同节点结构
  });

  it("paused → anchor 保留但状态变 paused", () => {
    seedBlocks([mkLinkedBlock("sb-f4", WEEK7_MON)]);
    useAppStore.setState({
      focusSessions: [
        mkActiveFocus({ status: "paused", activeStartedAt: undefined, accumulatedActiveMs: 300_000 }),
      ],
    });
    render(<TimelineWorkspace />);

    expect(
      screen.getByLabelText("打开任务《实证报告学习》，专注已暂停")
    ).toBeTruthy();
    expect(within(getStudyBlockEl()).getByText("已暂停")).toBeTruthy();
  });

  it("completed → 状态清除（anchor 不再存在）", () => {
    seedBlocks([mkLinkedBlock("sb-f5", WEEK7_MON)]);
    useAppStore.setState({
      focusSessions: [
        mkActiveFocus({
          status: "completed",
          activeStartedAt: undefined,
          endedAt: FOCUS_STARTED_MON_1407 + 1_500_000,
          actualActiveMs: 1_500_000,
        }),
      ],
    });
    render(<TimelineWorkspace />);

    expect(screen.getByLabelText("打开任务《实证报告学习》")).toBeTruthy();
    expect(screen.queryByText("专注中")).toBeNull();
    expect(screen.queryByText("已暂停")).toBeNull();
  });
});

// ============================================================
// Workflow UX V10 —— CourseTaskMarker focus awareness
// ============================================================
describe("CourseTaskMarker focus awareness", () => {
  function markerHarnessWithFocus(
    blocks: StudyBlock[],
    session: FocusSession | null
  ) {
    seedBlocks(blocks);
    useAppStore.setState({ focusSessions: session ? [session] : [] });
    render(<TimelineWorkspace />);
    const dot = screen.getByLabelText(/个学习任务与本课程时间重叠/) as HTMLElement;
    fireEvent.mouseEnter(dot);
    return dot;
  }

  it("重叠 anchor block → Marker trigger 有 focus awareness（aria 同步）", () => {
    const dot = markerHarnessWithFocus(
      [MARKER_BLOCK_A], // Tue 14:10–15:00
      mkActiveFocus({ startedAt: FOCUS_STARTED_TUE_1430 })
    );
    expect(dot.getAttribute("aria-label")).toBe(
      "1 个学习任务与本课程时间重叠，其中当前专注任务 1 个"
    );
  });

  it("panel 中只有 anchor row 显示「专注中」；同 Assignment 其它 row 不显示", () => {
    // 同 Assignment（a-exec）的第二段：15:00–15:50 不含 startedAt → 不是 anchor
    const sameAssignmentBlockC = {
      ...MARKER_BLOCK_A,
      id: "mk-c",
      title: "重叠学习 C",
      startTime: "15:00",
      endTime: "15:50",
    } as unknown as StudyBlock;
    markerHarnessWithFocus(
      [MARKER_BLOCK_A, sameAssignmentBlockC],
      mkActiveFocus({ startedAt: FOCUS_STARTED_TUE_1430 })
    );

    const rowA = screen.getByRole("button", { name: "打开任务 重叠学习 A" });
    expect(rowA.textContent).toContain("专注中");
    const rowC = screen.getByRole("button", { name: "打开任务 重叠学习 C" });
    expect(rowC.textContent).not.toContain("专注中");
    expect(rowC.textContent).not.toContain("已暂停");
  });

  it("paused → anchor row 显示「已暂停」", () => {
    markerHarnessWithFocus(
      [MARKER_BLOCK_A],
      mkActiveFocus({
        status: "paused",
        activeStartedAt: undefined,
        startedAt: FOCUS_STARTED_TUE_1430,
        accumulatedActiveMs: 120_000,
      })
    );
    const rowA = screen.getByRole("button", { name: "打开任务 重叠学习 A" });
    expect(rowA.textContent).toContain("已暂停");
    expect(rowA.textContent).not.toContain("专注中");
  });

  it("anchor row：pointerdown/up/click 仍能打开 Assignment（V9 契约不回归）", async () => {
    markerHarnessWithFocus(
      [MARKER_BLOCK_A],
      mkActiveFocus({ startedAt: FOCUS_STARTED_TUE_1430 })
    );
    const rowA = screen.getByRole("button", { name: "打开任务 重叠学习 A" });
    fireEvent.pointerDown(rowA);
    fireEvent.pointerUp(rowA);
    fireEvent.click(rowA);
    await waitFor(() => {
      expect(useAppStore.getState().selectedAssignmentId).toBe("a-exec");
    });
  });

  it("无 anchor → trigger aria 保持原样", () => {
    seedBlocks([MARKER_BLOCK_A]);
    useAppStore.setState({ focusSessions: [] });
    render(<TimelineWorkspace />);
    const dot = screen.getByLabelText(/个学习任务与本课程时间重叠/);
    expect(dot.getAttribute("aria-label")).toBe("1 个学习任务与本课程时间重叠");
  });
});

function floatingDetail(): HTMLElement | null {
  return document.querySelector('[aria-label="重叠的学习任务"]');
}

// ============================================================
// Execution handoff → AssignmentDrawer integration（轻量：
// FocusStartPopover / AssignmentFocusControl 细节由专属测试覆盖）
// ============================================================
// ============================================================
// Execution handoff → AssignmentDrawer integration（轻量：
// FocusStartPopover / AssignmentFocusControl 细节由专属测试覆盖）
// ============================================================
describe("StudyBlock → AssignmentDrawer execution handoff", () => {
  it(
    "linked task status=doing：从 StudyBlock 打开后 Drawer 出现且含「开始专注」入口",
    async () => {
      seedBlocks([mkLinkedBlock("sb-handoff", WEEK7_MON)]);
      const prefs = useAppStore.getState().preferences;
      useAppStore.setState({
        preferences: { ...prefs, enableScheduleDirectManipulation: false },
      });
      render(<TimelineWorkspace />);

      fireEvent.click(screen.getByLabelText("打开任务《实证报告学习》"));
      expect(useAppStore.getState().selectedAssignmentId).toBe("a-exec");

      // Global owner：AssignmentDrawer 由 selectedAssignmentId 驱动渲染（activeTab 不变）
      render(<AssignmentDrawer />);
      await waitFor(() => {
        expect(document.querySelector('[aria-label="任务详情"]')).toBeTruthy();
      });
      // doing 任务 eligible → Drawer 提供执行入口「开始专注」
      expect(screen.getByText("开始专注")).toBeTruthy();
      // handoff 不切换 tab：用户关闭 Drawer 后仍停留在 Timeline
      expect(useAppStore.getState().activeTab).toBe("timetable");
    },
    10000
  );
});
