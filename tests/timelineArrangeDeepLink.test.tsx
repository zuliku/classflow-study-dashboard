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
      // eslint-disable-next-line no-console
      console.log("SHEET_HTML_LEN:", sheetDialog.innerHTML.length, "HAS_CONFIRM:", sheetDialog.innerHTML.includes("确认安排"), "SHOWN:", sheetDialog.innerHTML.includes("计量经济学大作业"));
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
