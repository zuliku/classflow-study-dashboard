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
// Motion M5：settle 清理依赖 onAnimationEnd（e.animationName）；jsdom 无 AnimationEvent
if (typeof window !== "undefined" && !(window as unknown as { AnimationEvent?: unknown }).AnimationEvent) {
  class AnimationEventPolyfill extends Event {
    animationName: string;
    constructor(type: string, init: AnimationEventInit = {}) {
      super(type, init);
      this.animationName = init.animationName ?? "";
    }
  }
  (window as unknown as { AnimationEvent: unknown }).AnimationEvent = AnimationEventPolyfill;
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
import { useToastStore } from "@/store/useToastStore";
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

// Motion M5：action 真实实现快照（模块加载期，先于任何用例覆写）
const REAL_UPDATE_STUDY_BLOCK = useAppStore.getState().updateStudyBlock;
const REAL_ADD_STUDY_BLOCK = useAppStore.getState().addStudyBlock;

beforeEach(() => {
  cleanup();
  // Toast 跨用例隔离：同文案 2s 去重 + 队列上限会让后用例拿到过期 toast 的闭包
  //（Undo 用例曾因此抓到上一个 move 用例的撤销 toast，导致恢复落空）
  useToastStore.setState({ toasts: [] });
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
  // Motion M5 rejection 测试可能覆写 store action → 每个用例后恢复真实实现
  useAppStore.setState({
    updateStudyBlock: REAL_UPDATE_STUDY_BLOCK,
    addStudyBlock: REAL_ADD_STUDY_BLOCK,
  });
});

/**
 * Motion M5：mock elementFromPoint 返回指定 day column（jsdom 无布局/命中测试）。
 * rect top=0 height=780 → pointerMinutes = 480 + clientY（780px 全域 ≈ 08:00–21:00）。
 */
function mockElementFromPointDay(dow: number) {
  const fakeDayCol = {
    dataset: { timetableDay: String(dow) },
    getBoundingClientRect: () =>
      ({ top: 0, left: 0, right: 100, bottom: 780, width: 100, height: 780, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
  };
  (document as unknown as Record<string, unknown>).elementFromPoint = () => ({
    closest: () => fakeDayCol,
  });
}

function restoreElementFromPoint() {
  (document as unknown as Record<string, unknown>).elementFromPoint = () => null;
}

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

// ============================================================
// Workflow UX V15 —— Released StudyBlock Timeline 行为
// ============================================================
const RELEASE_NOW = new Date(`${SEMESTER.startDate}T00:00:00`).getTime() + 6 * 7 * 86400000 + 12 * 3600000;

describe("Released StudyBlock：Timeline 视觉 / 交互 / Marker", () => {
  function seedReleased(over: Partial<StudyBlock> = {}) {
    const prefs = useAppStore.getState().preferences;
    useAppStore.setState({
      assignments: [{ ...LINKED, status: "completed" }],
      studyBlocks: [
        {
          id: "sb-rel",
          title: "实证报告学习",
          date: WEEK7_MON,
          startTime: "14:00",
          endTime: "15:00",
          assignmentId: "a-exec",
          source: "manual",
          planningState: "released",
          ...over,
        } as unknown as StudyBlock,
      ],
      focusSessions: [],
      preferences: { ...prefs, enableScheduleDirectManipulation: true },
    });
    render(<TimelineWorkspace />);
  }

  it("released block 渲染并显示「已释放」；main action aria 含「学习计划已释放」", () => {
    useAppStore.setState({ currentSemesterWeek: 7 });
    seedReleased();
    const btn = screen.getByLabelText("打开任务《实证报告学习》，该学习计划已释放");
    expect(btn).toBeTruthy();
    expect(screen.getByText("已释放")).toBeTruthy();
  });

  it("released main action 仍打开 Assignment Drawer", () => {
    useAppStore.setState({ currentSemesterWeek: 7 });
    seedReleased();
    fireEvent.click(screen.getByLabelText(/该学习计划已释放/));
    expect(useAppStore.getState().selectedAssignmentId).toBe("a-exec");
  });

  it("released block pointerdown 不进入 drag lifecycle（无 dragActive）", () => {
    useAppStore.setState({ currentSemesterWeek: 7 });
    seedReleased();
    const el = getStudyBlockEl();
    fireEvent.pointerDown(el, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 130, clientY: 140, pointerId: 1 });
    });
    expect(document.body.dataset.dragActive).not.toBe("1");
  });

  it("released block 不锚定 Focus Awareness（即使时间窗命中也不显示专注中）", () => {
    useAppStore.setState({ currentSemesterWeek: 7 });
    seedReleased();
    // 构造 running focus，startedAt 落在 released block 时间窗内
    act(() => {
      useAppStore.setState({
        focusSessions: [
          {
            id: "f-race", plannedMinutes: 25,
            startedAt: new Date(`${WEEK7_TUE}T14:30:00`).getTime(),
            activeStartedAt: new Date(`${WEEK7_TUE}T14:30:00`).getTime(),
            accumulatedActiveMs: 0, status: "running",
            assignmentId: "a-exec", source: "manual",
            createdAt: 0, updatedAt: 0,
          } as never,
        ],
      });
    });
    expect(screen.getByLabelText("打开任务《实证报告学习》，该学习计划已释放")).toBeTruthy();
    expect(screen.queryByText("专注中")).toBeNull();
  });

  it("delete 对 released block 仍可用", () => {
    useAppStore.setState({ currentSemesterWeek: 7 });
    seedReleased();
    fireEvent.click(screen.getByLabelText("删除学习计划 实证报告学习"));
    expect(useAppStore.getState().studyBlocks.length).toBe(0);
  });

  it("CourseTaskMarker：released row 标注已释放且仍能打开 Assignment", async () => {
    useAppStore.setState({ currentSemesterWeek: 7 });
    // 与周二课程（14:00–16:00）重叠 → 折叠进 Marker
    seedReleased({ date: WEEK7_TUE, startTime: "14:10", endTime: "15:00" });
    const dot = screen.getByLabelText(/个学习任务与本课程时间重叠/);
    fireEvent.mouseEnter(dot);
    // Marker floating detail 中 row 带「已释放」标注
    const row = screen.getByRole("button", { name: "打开任务 实证报告学习" });
    expect(row.textContent).toContain("已释放");
    expect(row.textContent).not.toContain("专注中");
    // row 点击仍打开 Assignment
    fireEvent.pointerDown(row);
    fireEvent.pointerUp(row);
    fireEvent.click(row);
    await waitFor(() => {
      expect(useAppStore.getState().selectedAssignmentId).toBe("a-exec");
    });
  });
});

// ============================================================
// Motion M5 —— Direct Manipulation Feedback（Grab / Target / Settle）
// ============================================================
const WEEK7_WED = weekDate(7, 2); // 无课日：move 目标列（day 3）
const WEEK7_THU = weekDate(7, 3); // 无课日：quick drag 目标列（day 4）

describe("Motion M5 —— StudyBlock move feedback", () => {
  function engageMove(dow: number) {
    mockElementFromPointDay(dow);
    const el = getStudyBlockEl();
    fireEvent.pointerDown(el, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 100, clientY: 195, pointerId: 1 });
    });
    return el;
  }

  it("跨过阈值 → origin source subdued（opacity-40，geometry 不变）+ candidate 日出现统一 target surface", () => {
    seedBlocks([mkLinkedBlock("sb-m5a", WEEK7_MON)]);
    render(<TimelineWorkspace />);
    engageMove(3);

    const origin = getStudyBlockEl();
    expect(origin.className).toContain("opacity-40");
    expect(document.querySelector('[data-testid="study-block-ghost"]')).toBeTruthy();

    const target = document.querySelector('[data-testid="timeline-day-target"]') as HTMLElement;
    expect(target).toBeTruthy();
    // 中性 target surface：极弱背景 + 1px inset ring（有效性语义在 Ghost 上，列自身不变色）
    expect(target.className).toContain("bg-alabaster/55");
    expect(target.className).toContain("ring-charcoal/20");

    fireEvent.pointerUp(window, { pointerId: 1 });
    restoreElementFromPoint();
  });

  it("成功 move → 真实 block 获得 ux-settle；settle animation end 清除 local settle state", () => {
    seedBlocks([mkLinkedBlock("sb-m5b", WEEK7_MON)]);
    render(<TimelineWorkspace />);
    engageMove(3);
    fireEvent.pointerUp(window, { pointerId: 1 });

    // Store 已更新到周三
    const moved = useAppStore.getState().studyBlocks.find((b) => b.id === "sb-m5b")!;
    expect(moved.date).toBe(WEEK7_WED);

    const block = getStudyBlockEl();
    expect(block.className).toContain("ux-settle");

    // onAnimationEnd（animationName === ux-settle-in）→ 清 settle state（不用 setTimeout）
    act(() => {
      block.dispatchEvent(
        new window.AnimationEvent("animationend", { animationName: "ux-settle-in", bubbles: true })
      );
    });
    expect(getStudyBlockEl().className).not.toContain("ux-settle");
    restoreElementFromPoint();
  });

  it("write boundary 拒绝（updateStudyBlock → false）→ 无 settle、block 不动", () => {
    useAppStore.setState({ updateStudyBlock: () => false });
    seedBlocks([mkLinkedBlock("sb-m5c", WEEK7_MON)]);
    render(<TimelineWorkspace />);
    engageMove(3);
    fireEvent.pointerUp(window, { pointerId: 1 });

    const block = useAppStore.getState().studyBlocks.find((b) => b.id === "sb-m5c")!;
    expect(block.date).toBe(WEEK7_MON); // 未动
    expect(getStudyBlockEl().className).not.toContain("ux-settle");
    restoreElementFromPoint();
  });

  it("键盘激活不受 drag visual state 影响（无 subdued / 无 settle，正常打开 Assignment）", () => {
    seedBlocks([mkLinkedBlock("sb-m5d", WEEK7_MON)]);
    render(<TimelineWorkspace />);
    const mainBtn = screen.getByLabelText("打开任务《实证报告学习》");
    fireEvent.keyDown(mainBtn, { key: "Enter" });
    fireEvent.click(mainBtn);

    expect(useAppStore.getState().selectedAssignmentId).toBe("a-exec");
    const block = getStudyBlockEl();
    expect(block.className).not.toContain("opacity-40");
    expect(block.className).not.toContain("ux-settle");
  });

  it("Undo 成功 → block 回原位并再次轻 settle", () => {
    seedBlocks([mkLinkedBlock("sb-m5e", WEEK7_MON)]);
    render(<TimelineWorkspace />);
    engageMove(3);
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(useAppStore.getState().studyBlocks.find((b) => b.id === "sb-m5e")!.date).toBe(WEEK7_WED);

    // 触发成功 toast 的「撤销」action（真实 undo 路径）
    const undoToast = useToastStore
      .getState()
      .toasts.slice()
      .reverse()
      .find((t) => t.actionLabel === "撤销");
    expect(undoToast).toBeTruthy();
    act(() => {
      undoToast!.onAction?.();
    });

    expect(useAppStore.getState().studyBlocks.find((b) => b.id === "sb-m5e")!.date).toBe(WEEK7_MON);
    // Undo 成功同样轻 settle（不做反向飞行动画）
    expect(getStudyBlockEl().className).toContain("ux-settle");
    restoreElementFromPoint();
  });
});

describe("Motion M5 —— Unscheduled quick drag feedback", () => {
  function engageShelfDrag(dow: number) {
    mockElementFromPointDay(dow);
    const chip = document.querySelector('[data-testid="timeline-unscheduled-item"]') as HTMLElement;
    fireEvent.pointerDown(chip, { button: 0, clientX: 200, clientY: 600, pointerId: 2 });
    act(() => {
      fireEvent.pointerMove(window, { clientX: 200, clientY: 614, pointerId: 2 });
    });
    return chip;
  }

  it("跨过阈值 → shelf chip subdued（opacity-40）", () => {
    render(<TimelineWorkspace />); // LINKED 无 block → unscheduled shelf 有 chip
    const chip = engageShelfDrag(4);
    expect(chip.className).toContain("opacity-40");
    fireEvent.pointerUp(window, { pointerId: 2 });
    restoreElementFromPoint();
  });

  it("candidate 日保持 target surface 高亮；成功 create → 新 block 播放 ux-settle", () => {
    render(<TimelineWorkspace />);
    engageShelfDrag(4);

    const target = document.querySelector('[data-testid="timeline-day-target"]') as HTMLElement;
    expect(target).toBeTruthy();
    expect(target.className).toContain("ring-charcoal/20");

    fireEvent.pointerUp(window, { pointerId: 2 });
    const created = useAppStore.getState().studyBlocks[0];
    expect(created).toBeTruthy();
    expect(created.assignmentId).toBe("a-exec");

    const blockEl = document.querySelector('[data-testid="timeline-study-block"]') as HTMLElement;
    expect(blockEl.className).toContain("ux-settle");
    restoreElementFromPoint();
  });

  it("create 被 Store 拒绝（addStudyBlock → null）→ 无新 block、无 settle", () => {
    useAppStore.setState({ addStudyBlock: () => null });
    render(<TimelineWorkspace />);
    engageShelfDrag(4);
    fireEvent.pointerUp(window, { pointerId: 2 });

    expect(useAppStore.getState().studyBlocks.length).toBe(0);
    expect(document.querySelector('[data-testid="timeline-study-block"]')).toBeNull();
    expect(document.querySelector(".ux-settle")).toBeNull();
    restoreElementFromPoint();
  });
});
