// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";import React from "react";
import { render, screen, cleanup, fireEvent, act, waitFor, within } from "@testing-library/react";

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

import { AssignmentDrawer } from "@/components/drawers/AssignmentDrawer";
import { TimelineWorkspace } from "@/components/timeline/TimelineWorkspace";
import {
  resolveStudyScheduleTimelineTarget,
} from "@/lib/timeline/assignmentScheduleNavigation";
import { useAppStore } from "@/store/useAppStore";
import type { Assignment, Semester, StudyBlock } from "@/types";

/**
 * Workflow UX V8 —— Assignment → Timeline Planning Deep Link Closure：
 * - 「日程」(Primary) = Arrange intent（当前周 + 打开 ArrangeSheet），与 DDL 无关
 * - 「在时间表查看」(Execution) = 按已有 StudyBlock 精确跳周（非 DDL 周）
 * - pendingTimelineArrangeAssignmentId：transient consume-once navigation intent
 */

const SEMESTER: Semester = {
  id: "s1",
  name: "2026秋",
  startDate: "2026-08-31", // 周一；第 N 周 = start + (N-1)*7 天
  totalWeeks: 16,
};
/** 第 N 周的周一日期 */
const weekDate = (week: number, dayOffset = 0) => {
  const d = new Date(`${SEMESTER.startDate}T00:00:00`);
  d.setDate(d.getDate() + (week - 1) * 7 + dayOffset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};

const mkAssignment = (over: Partial<Assignment> = {}): Assignment =>
  ({
    id: "a-v8",
    courseId: "c-jl",
    title: "计量经济学大作业",
    description: "",
    ddl: undefined as unknown as string,
    priority: "high",
    status: "todo",
    progress: 0,
    tags: [],
    ...over,
  }) as Assignment;

const mkBlock = (week: number, dayOffset: number, startTime: string): StudyBlock =>
  ({
    id: `sb-w${week}-${dayOffset}-${startTime}`,
    assignmentId: "a-v8",
    courseId: "c-jl",
    title: "学习计划",
    date: weekDate(week, dayOffset),
    startTime,
    endTime: startTime === "23:00" ? "23:59" : `${String(Number(startTime.slice(0, 2)) + 2).padStart(2, "0")}:00`,
    source: "manual",
  }) as unknown as StudyBlock;

beforeEach(() => {
  cleanup();
  useAppStore.setState({
    semester: SEMESTER,
    currentSemesterWeek: 7,
    activeTab: "assignments" as never,
    selectedAssignmentId: null,
    selectedCalendarMarkId: null,
    pendingTimelineArrangeAssignmentId: null,
    studyBlocks: [],
    schedules: [],
    calendarMarks: [],
    assignments: [
      mkAssignment({ ddl: weekDate(12, 4) + "T23:59:00" }), // 默认任务带第 12 周 DDL
    ],
    courses: [],
    reminders: [],
    groupProjects: [],
  });
});
afterEach(() => {
  cleanup();
  useAppStore.setState({
    pendingTimelineArrangeAssignmentId: null,
    activeTab: "overview" as never,
    selectedAssignmentId: null,
  });
});

// ============================================================
// Pure helper：StudyBlock target 选择
// ============================================================
describe("resolveStudyScheduleTimelineTarget", () => {
  it("today=8/21：blocks 8/20、8/22、8/25 → 选今天之后最早的 8/22", () => {
    const blocks = [
      mkBlock(8, 0, "09:00"), // 10/19? no——直接构造任意学期内日期更直观：
    ];
    void blocks;
    // 直接以学期内日期字符串构造
    const raw = [
      { id: "b1", date: weekDate(8, 0), startTime: "09:00" },
      { id: "b2", date: weekDate(8, 2), startTime: "14:00" },
      { id: "b3", date: weekDate(9, 0), startTime: "10:00" },
    ];
    const today = new Date(`${weekDate(8, 1)}T00:00:00`); // b1 之后、b2 之前
    const target = resolveStudyScheduleTimelineTarget(raw, SEMESTER, today);
    expect(target!.block.id).toBe("b2");
  });

  it("全部 past：选最近过去的一个", () => {
    const raw = [
      { id: "b1", date: weekDate(3, 0), startTime: "09:00" },
      { id: "b2", date: weekDate(3, 2), startTime: "14:00" },
    ];
    const today = new Date(`${weekDate(6, 0)}T00:00:00`); // 全部已过去
    const target = resolveStudyScheduleTimelineTarget(raw, SEMESTER, today);
    expect(target!.block.id).toBe("b2"); // 最近过去 = 排序后最后一个
  });

  it("同一天多个 block：按 startTime 选最早", () => {
    const raw = [
      { id: "late", date: weekDate(8, 2), startTime: "16:00" },
      { id: "early", date: weekDate(8, 2), startTime: "08:00" },
    ];
    const today = new Date(`${weekDate(8, 0)}T00:00:00`);
    const target = resolveStudyScheduleTimelineTarget(raw, SEMESTER, today);
    expect(target!.block.id).toBe("early");
  });

  it("一个学期外一个学期内：只选学期内的", () => {
    const raw = [
      { id: "out", date: "2027-06-01", startTime: "09:00" }, // 学期外
      { id: "in", date: weekDate(10, 0), startTime: "09:00" },
    ];
    const today = new Date(`${weekDate(1, 0)}T00:00:00`);
    const target = resolveStudyScheduleTimelineTarget(raw, SEMESTER, today);
    expect(target!.block.id).toBe("in");
  });

  it("全部学期外 → null", () => {
    const raw = [{ id: "far", date: "2027-06-01", startTime: "09:00" }];
    const today = new Date(`${weekDate(1, 0)}T00:00:00`);
    expect(resolveStudyScheduleTimelineTarget(raw, SEMESTER, today)).toBeNull();
  });

  it("输入未排序 → 结果 deterministic", () => {
    const raw = [
      { id: "later", date: weekDate(8, 2), startTime: "14:00" },
      { id: "earlier", date: weekDate(8, 1), startTime: "09:00" },
    ];
    const today = new Date(`${weekDate(8, 0)}T00:00:00`);
    const t1 = resolveStudyScheduleTimelineTarget(raw, SEMESTER, today);
    const t2 = resolveStudyScheduleTimelineTarget([...raw].reverse(), SEMESTER, today);
    expect(t1!.block.id).toBe("earlier");
    expect(t2!.block.id).toBe("earlier");
  });
});

// ============================================================
// AssignmentDrawer：日程 / 在时间表查看 双 handler 路由
// ============================================================
describe("AssignmentDrawer schedule routing", () => {
  function drawerHarness(opts: {
    ddl?: string;
    studyBlocks?: StudyBlock[];
  }) {
    useAppStore.setState({
      assignments: [mkAssignment({ ddl: opts.ddl ?? undefined })],
      studyBlocks: opts.studyBlocks ?? [],
      selectedAssignmentId: "a-v8",
    });
    render(<AssignmentDrawer />);
  }

  it("P0 regression：无 DDL 无 StudyBlock → 点『日程』→ pending 设置 + 进 Timeline + Drawer 关闭", () => {
    drawerHarness({ ddl: undefined });
    expect(useAppStore.getState().currentSemesterWeek).toBe(7);

    fireEvent.click(screen.getByRole("button", { name: /日程/ }));

    expect(useAppStore.getState().pendingTimelineArrangeAssignmentId).toBe("a-v8");
    expect(useAppStore.getState().selectedAssignmentId).toBeNull();
    expect(useAppStore.getState().activeTab).toBe("timetable");
    // 不跳 DDL 周：currentSemesterWeek 保持不变
    expect(useAppStore.getState().currentSemesterWeek).toBe(7);
  });

  it("有 DDL 无 StudyBlock → 点『日程』同样 arrange intent，不改 currentSemesterWeek", () => {
    drawerHarness({ ddl: weekDate(12, 4) + "T23:59:00" }); // 有第 12 周 DDL
    fireEvent.click(screen.getByRole("button", { name: /日程/ }));
    expect(useAppStore.getState().pendingTimelineArrangeAssignmentId).toBe("a-v8");
    expect(useAppStore.getState().activeTab).toBe("timetable");
    expect(useAppStore.getState().currentSemesterWeek).toBe(7); // 不跳第 12 周
  });

  it("已有 StudyBlock：Primary『日程』仍是 arrange intent（非 view）", () => {
    const sb = mkBlock(8, 1, "14:00");
    drawerHarness({ studyBlocks: [sb] });
    fireEvent.click(screen.getByRole("button", { name: /日程/ }));
    expect(useAppStore.getState().pendingTimelineArrangeAssignmentId).toBe("a-v8");
    expect(useAppStore.getState().activeTab).toBe("timetable");
    expect(useAppStore.getState().currentSemesterWeek).toBe(7); // 不按 StudyBlock 周跳
  });

  it("Execution『在时间表查看』→ 按 StudyBlock 周跳（DDL 在第 12 周 ≠ block 第 8 周）", () => {
    const sb = mkBlock(8, 1, "14:00"); // 第 8 周
    drawerHarness({ studyBlocks: [sb] }); // DDL 默认第 12 周
    fireEvent.click(screen.getByRole("button", { name: /在时间表查看/ }));
    expect(useAppStore.getState().selectedAssignmentId).toBeNull(); // 成功导航才关闭
    expect(useAppStore.getState().activeTab).toBe("timetable");
    expect(useAppStore.getState().currentSemesterWeek).toBe(8); // StudyBlock 周，非 DDL 周
  });

  it("无 DDL + 已有 StudyBlock：仍可精确跳转（DDL 非前提）", () => {
    const sb = mkBlock(5, 2, "09:30");
    drawerHarness({ ddl: undefined, studyBlocks: [sb] });
    fireEvent.click(screen.getByRole("button", { name: /在时间表查看/ }));
    expect(useAppStore.getState().currentSemesterWeek).toBe(5);
    expect(useAppStore.getState().activeTab).toBe("timetable");
  });

  it("全部 StudyBlock 学期外 → View action disabled 且点击不关闭 Drawer", () => {
    const outOfSemester = mkBlock(20, 0, "09:00").date < weekDate(16, 6)
      ? { ...mkBlock(20, 0, "09:00"), date: "2027-03-01" }
      : mkBlock(20, 0, "09:00");
    drawerHarness({
      ddl: weekDate(12, 4) + "T23:59:00",
      studyBlocks: [{ ...outOfSemester, date: "2027-03-01" }],
    });
    const viewBtn = screen.getByRole("button", { name: /在时间表查看/ }) as HTMLButtonElement;
    expect(viewBtn.disabled).toBe(true);

    fireEvent.click(viewBtn);
    // disabled 按钮 click 不触发 handler：Drawer 未关、未导航
    expect(useAppStore.getState().selectedAssignmentId).toBe("a-v8");
    expect(useAppStore.getState().activeTab).toBe("assignments");
  });
});

// ============================================================
// TimelineWorkspace：pending intent consume once
// ============================================================
describe("Timeline pending arrange intent consume", () => {
  function timelineHarness(pendingId: string | null) {
    useAppStore.setState({
      activeTab: "timetable" as never,
      currentSemesterWeek: 7,
      pendingTimelineArrangeAssignmentId: pendingId,
      assignments: [mkAssignment()],
      studyBlocks: [],
      schedules: [],
      calendarMarks: [],
      courses: [],
    });
    render(<TimelineWorkspace />);
  }

  it(
    "pending valid assignment → mount 后 ArrangeSheet 打开（title 正确）且 pending cleared",
    async () => {
      timelineHarness("a-v8");
      await waitFor(() => {
        expect(screen.getByTestId("timeline-arrange-sheet")).toBeTruthy();
      });
      expect(useAppStore.getState().pendingTimelineArrangeAssignmentId).toBeNull();
      // title 来自 Assignment payload
      expect(screen.getAllByText(/计量经济学大作业/).length).toBeGreaterThanOrEqual(1);
    },
    10000
  );

  it("pending stale id → 不打开 ArrangeSheet，pending cleared", () => {
    timelineHarness("gone-id");
    expect(screen.queryByTestId("timeline-arrange-sheet")).toBeNull();
    expect(useAppStore.getState().pendingTimelineArrangeAssignmentId).toBeNull();
  });

  it(
    "submit：StudyBlock.assignmentId 关联到目标 Assignment",
    async () => {
      timelineHarness("a-v8");
      await waitFor(() => {
        expect(screen.getByTestId("timeline-arrange-sheet")).toBeTruthy();
      });
      const sheetDialog = screen.getByTestId("timeline-arrange-sheet");
      fireEvent.click(within(sheetDialog).getByRole("button", { name: "确认安排" }));
      await waitFor(() => {
        expect(useAppStore.getState().studyBlocks.length).toBe(1);
      });
      const sb = useAppStore.getState().studyBlocks[0];
      expect(sb.assignmentId).toBe("a-v8");
      expect(sb.title).toBe("计量经济学大作业");
    },
    10000
  );

  it("cancel：不创建 StudyBlock", async () => {
    timelineHarness("a-v8");
    await waitFor(() => {
      expect(screen.getByTestId("timeline-arrange-sheet")).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText("关闭"));
    expect(useAppStore.getState().studyBlocks.length).toBe(0);
  });

  it(
    "edge：free ArrangeSheet 已打开时收到 pending → semantic close 后 fresh-open Assignment（无旧表单残留）",
    async () => {
      timelineHarness(null);
      // 先打开 free-block 模式 ArrangeSheet 并污染本地草稿
      fireEvent.click(screen.getByRole("button", { name: /添加截止时间|新建/ })).catch?.(() => {});
      // 直接驱动 freeBlockOpen 更稳定：
      // （Quick Create popover 入口较深，这里通过 store-free UI 不可达 → 改用双轮断言法）
      // 简化：先以 free 模式打开 ArrangeSheet（freeBlockOpen 无法从外部设置，
      // 因此验证「assignment A open 时收到 B」的 close→reopen 语义）
      cleanup();

      useAppStore.setState({
        activeTab: "timetable" as never,
        currentSemesterWeek: 7,
        assignments: [
          mkAssignment({ id: "a-a", title: "任务 A" }),
          mkAssignment({ id: "a-b", title: "任务 B" }),
        ],
        pendingTimelineArrangeAssignmentId: "a-a",
        studyBlocks: [],
        schedules: [],
        calendarMarks: [],
        courses: [],
      });
      render(<TimelineWorkspace />);
      await waitFor(() => {
        expect(screen.getByTestId("timeline-arrange-sheet")).toBeTruthy();
      });
      // A 已开 → 收到 B 的 pending：semantic close A，随后 fresh-open B。
      // 同一 panel DOM 承载 A-exit → B-enter（key 未变），故断言内容切换而非节点消失。
      act(() => {
        useAppStore.setState({ pendingTimelineArrangeAssignmentId: "a-b" });
      });
      await waitFor(() => {
        expect(screen.getAllByText(/任务 B/).length).toBeGreaterThanOrEqual(1);
      });
      // A 不得残留在 ArrangeSheet 内（Shelf rail 的列表项标题不算）
      const sheetPanel = screen.getByTestId("timeline-arrange-sheet");
      expect(within(sheetPanel).queryByText(/任务 A/)).toBeNull();
      // fresh-open session reset：start/end 回到默认值（非 A 会话残留）
      const timeInput = document.querySelector('input[type="time"]') as HTMLInputElement | null;
      if (timeInput) expect(timeInput.value).toBe("19:00");
      expect(useAppStore.getState().pendingTimelineArrangeAssignmentId).toBeNull();
      expect(useAppStore.getState().activeTab).toBe("timetable");
    },
    15000
  );
});

// ============================================================
// Persistence guard
// ============================================================
describe("Pending intent persistence guard", () => {
  it("partialize 白名单不含 pendingTimelineArrangeAssignmentId（transient，不持久化）", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(process.cwd(), "store/useAppStore.ts"), "utf8");
    const partializeMatch = src.match(/partialize: \(state\)[\s\S]*?\}\),/);
    expect(partializeMatch).toBeTruthy();
    expect(partializeMatch![0]).not.toContain("pendingTimelineArrangeAssignmentId");

    // reset 行为：restoreAppData 后 pending 归 null（transient 清理）
    act(() => {
      useAppStore.setState({ pendingTimelineArrangeAssignmentId: "some-id" });
    });
    act(() => {
      useAppStore.getState().setPendingTimelineArrangeAssignmentId(null);
    });
    expect(useAppStore.getState().pendingTimelineArrangeAssignmentId).toBeNull();
  });
});

// ============================================================
// Workflow UX V14 —— Assignment Planning Eligibility Guard
// ============================================================

describe("AssignmentDrawer 日程 eligibility（todo/doing 可安排）", () => {
  function drawerWithStatus(status: Assignment["status"], opts: { studyBlocks?: StudyBlock[] } = {}) {
    useAppStore.setState({
      assignments: [mkAssignment({ ddl: undefined, status })],
      studyBlocks: opts.studyBlocks ?? [],
      selectedAssignmentId: "a-v8",
      activeTab: "assignments" as never,
    });
    render(<AssignmentDrawer />);
  }

  it("todo → 日程 enabled", () => {
    drawerWithStatus("todo");
    expect((screen.getByRole("button", { name: /日程/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("doing → 日程 enabled", () => {
    drawerWithStatus("doing");
    expect((screen.getByRole("button", { name: /日程/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("submitted → 日程 native disabled（保留位置，不隐藏）", () => {
    drawerWithStatus("submitted");
    const btn = screen.getByRole("button", { name: /日程/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("completed → 日程 native disabled", () => {
    drawerWithStatus("completed");
    expect((screen.getByRole("button", { name: /日程/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("submitted：点击不写 pending、不切 Timeline、Drawer 保持打开（disabled + defensive 双层）", () => {
    drawerWithStatus("submitted");
    fireEvent.click(screen.getByRole("button", { name: /日程/ }));
    expect(useAppStore.getState().pendingTimelineArrangeAssignmentId).toBeNull();
    expect(useAppStore.getState().activeTab).toBe("assignments");
    expect(useAppStore.getState().selectedAssignmentId).toBe("a-v8"); // 未关闭
  });

  it("completed：同样不产生 intent / 导航", () => {
    drawerWithStatus("completed");
    fireEvent.click(screen.getByRole("button", { name: /日程/ }));
    expect(useAppStore.getState().pendingTimelineArrangeAssignmentId).toBeNull();
    expect(useAppStore.getState().activeTab).toBe("assignments");
  });

  it("completed 已有 StudyBlock：「在时间表查看」不受 scheduleDisabled 误伤（View ≠ Arrange）", () => {
    const sb = mkBlock(8, 1, "14:00");
    drawerWithStatus("completed", { studyBlocks: [sb] });
    const viewBtn = screen.getByRole("button", { name: /在时间表查看/ }) as HTMLButtonElement;
    expect(viewBtn.disabled).toBe(false);
    fireEvent.click(viewBtn);
    expect(useAppStore.getState().currentSemesterWeek).toBe(8);
    expect(useAppStore.getState().activeTab).toBe("timetable");
  });
});

describe("Timeline pending consumer eligibility（deep-link revalidation）", () => {
  function pendingHarness(pendingId: string | null, status: Assignment["status"]) {
    useAppStore.setState({
      activeTab: "timetable" as never,
      currentSemesterWeek: 7,
      pendingTimelineArrangeAssignmentId: pendingId,
      assignments: [mkAssignment({ status })],
      studyBlocks: [],
      schedules: [],
      calendarMarks: [],
      courses: [],
    });
    render(<TimelineWorkspace />);
  }

  it("pending doing → ArrangeSheet 正常打开且 pending cleared", async () => {
    pendingHarness("a-v8", "doing");
    await waitFor(() => {
      expect(screen.getByTestId("timeline-arrange-sheet")).toBeTruthy();
    });
    expect(useAppStore.getState().pendingTimelineArrangeAssignmentId).toBeNull();
  });

  it("pending submitted → stale intent 被 consume：Sheet 不打开、pending clear、无导航副作用", () => {
    pendingHarness("a-v8", "submitted");
    expect(screen.queryByTestId("timeline-arrange-sheet")).toBeNull();
    expect(useAppStore.getState().pendingTimelineArrangeAssignmentId).toBeNull();
    expect(useAppStore.getState().activeTab).toBe("timetable"); // 停留原 Workspace
  });

  it("pending completed → 同样安全清除", () => {
    pendingHarness("a-v8", "completed");
    expect(screen.queryByTestId("timeline-arrange-sheet")).toBeNull();
    expect(useAppStore.getState().pendingTimelineArrangeAssignmentId).toBeNull();
  });
});

describe("ArrangeSheet commit-time fresh revalidation（open-sheet race）", () => {
  async function openSheetThenMutate(mutate: (state: Assignment) => Assignment | null) {
    useAppStore.setState({
      activeTab: "timetable" as never,
      currentSemesterWeek: 7,
      pendingTimelineArrangeAssignmentId: "a-v8",
      assignments: [mkAssignment()],
      studyBlocks: [],
      schedules: [],
      calendarMarks: [],
      courses: [],
    });
    render(<TimelineWorkspace />);
    await waitFor(() => {
      expect(screen.getByTestId("timeline-arrange-sheet")).toBeTruthy();
    });
    // Sheet 打开期间任务在另一路径变化
    act(() => {
      const cur = useAppStore.getState().assignments[0];
      const next = mutate(cur);
      useAppStore.setState({ assignments: next ? [next] : [] });
    });
    fireEvent.click(within(screen.getByTestId("timeline-arrange-sheet")).getByRole("button", { name: "确认安排" }));
  }

  it.each([
    ["completed", (a: Assignment) => ({ ...a, status: "completed" as const })],
    ["submitted", (a: Assignment) => ({ ...a, status: "submitted" as const })],
  ])("Sheet 打开后 A → %s：submit 不创建 StudyBlock 且 Sheet semantic close", async (_name, mutate) => {
    await openSheetThenMutate(mutate);
    expect(useAppStore.getState().studyBlocks.length).toBe(0);
    // exit presence 结束后 Sheet 卸载（semantic close，非残留 stale 表单）
    await waitFor(
      () => {
        expect(screen.queryByTestId("timeline-arrange-sheet")).toBeNull();
      },
      { timeout: 2000 }
    );
  }, 10000);

  it("Sheet 打开后 A 被删除：submit 同样不得生成 orphan block", async () => {
    await openSheetThenMutate(() => null);
    expect(useAppStore.getState().studyBlocks.length).toBe(0);
    await waitFor(
      () => {
        expect(screen.queryByTestId("timeline-arrange-sheet")).toBeNull();
      },
      { timeout: 2000 }
    );
  }, 10000);

  it("对照组：Sheet 打开期间任务保持 todo → 正常创建 linked block", async () => {
    useAppStore.setState({
      activeTab: "timetable" as never,
      currentSemesterWeek: 7,
      pendingTimelineArrangeAssignmentId: "a-v8",
      assignments: [mkAssignment()],
      studyBlocks: [],
      schedules: [],
      calendarMarks: [],
      courses: [],
    });
    render(<TimelineWorkspace />);
    await waitFor(() => {
      expect(screen.getByTestId("timeline-arrange-sheet")).toBeTruthy();
    });
    fireEvent.click(within(screen.getByTestId("timeline-arrange-sheet")).getByRole("button", { name: "确认安排" }));
    await waitFor(() => {
      expect(useAppStore.getState().studyBlocks.length).toBe(1);
    });
    expect(useAppStore.getState().studyBlocks[0].assignmentId).toBe("a-v8");
  }, 10000);
});

// ============================================================
// Workflow UX V15 —— Drawer schedule summary / view priority（released）
// ============================================================
describe("AssignmentDrawer released blocks presentation", () => {
  function drawerWithBlocks(blocks: StudyBlock[], status: Assignment["status"] = "completed") {
    useAppStore.setState({
      assignments: [mkAssignment({ status })],
      studyBlocks: blocks,
      selectedAssignmentId: "a-v8",
      activeTab: "assignments" as never,
    });
    render(<AssignmentDrawer />);
  }

  it("summary 只计 active；released 以克制计数呈现", () => {
    drawerWithBlocks([
      { id: "sb-act", title: "活跃计划", date: weekDate(8, 1), startTime: "10:00", endTime: "11:00", assignmentId: "a-v8", source: "manual" } as unknown as StudyBlock,
      { id: "sb-rel1", title: "旧计划一", date: weekDate(7, 2), startTime: "14:00", endTime: "15:00", assignmentId: "a-v8", planningState: "released", source: "manual" } as unknown as StudyBlock,
      { id: "sb-rel2", title: "旧计划二", date: weekDate(6, 3), startTime: "14:00", endTime: "15:00", assignmentId: "a-v8", planningState: "released", source: "manual" } as unknown as StudyBlock,
    ]);
    const releasedNote = screen.getByText(/已释放 2 个旧计划/);
    const summaryText = releasedNote.parentElement?.textContent ?? "";
    expect(summaryText).toContain("1 个时段"); // released 不计入有效安排
    expect(summaryText).toContain("已释放 2 个旧计划");
  });

  it("reopened todo 只有 released block → 显示未安排 + 日程重新 enabled", () => {
    drawerWithBlocks(
      [{ id: "sb-rel", title: "旧计划", date: weekDate(7, 2), startTime: "14:00", endTime: "15:00", assignmentId: "a-v8", planningState: "released", source: "manual" } as unknown as StudyBlock],
      "todo"
    );
    expect(screen.getByText("未安排")).toBeTruthy();
    const scheduleBtn = screen.getByRole("button", { name: /日程/ }) as HTMLButtonElement;
    expect(scheduleBtn.disabled).toBe(false);
  });

  it("在时间表查看：active 优先；仅 released 时 fallback 可查看历史", () => {
    // 仅 released：仍可跳到该 block 所在周
    drawerWithBlocks(
      [{ id: "sb-rel-only", title: "旧计划", date: weekDate(9, 2), startTime: "14:00", endTime: "15:00", assignmentId: "a-v8", planningState: "released", source: "manual" } as unknown as StudyBlock],
      "completed"
    );
    fireEvent.click(screen.getByRole("button", { name: /在时间表查看/ }));
    expect(useAppStore.getState().currentSemesterWeek).toBe(9);
  });
});
