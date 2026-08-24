// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, cleanup, fireEvent, act } from "@testing-library/react";

vi.mock("@/hooks/useKiroHandoff", () => ({
  useKiroHandoff: () => ({ openForGroupProject: vi.fn(), openForWeek: vi.fn() }),
}));
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

import { ReminderRuntime } from "@/components/reminders/ReminderRuntime";
import { useAppStore } from "@/store/useAppStore";
import type { Assignment, Reminder, Semester } from "@/types";

/**
 * Workflow UX V15 —— Terminal → Release：Store boundary 行为锁定。
 * 所有 eligible → terminal 入口（status / update / progress=100 / last subtask）
 * 在同一 set 内 release 未来 blocks + 清理 scheduled reminder；
 * terminal→active 不恢复；recurrence child 不继承 transfer。
 */

const NOW_BASE = new Date("2026-03-10T12:00:00").getTime();
// 相对 now 的「未来」block：当天 16:00–17:00；过去：09:00–10:00
const FUTURE = { startTime: "16:00", endTime: "17:00" };

const mkA = (over: Partial<Assignment> = {}): Assignment =>
  ({ id: "a-1", courseId: "c1", title: "任务一", description: "", ddl: "", priority: "medium", status: "todo", progress: 0, tags: [], ...over }) as Assignment;

const SEMESTER: Semester = { id: "s1", name: "x", startDate: "2026-03-09", totalWeeks: 16 };

function seed(opts?: {
  status?: Assignment["status"];
  subtasks?: Assignment["subtasks"];
  extraReminder?: Reminder;
  assignment?: Partial<Assignment>;
}) {
  const prefs = useAppStore.getState().preferences;
  useAppStore.setState({
    courses: [],
    assignments: [
      mkA({
        status: opts?.status ?? "todo",
        subtasks: opts?.subtasks,
        ddl: `2026-03-11T23:59:00`,
        ...opts?.assignment,
      }),
    ],
    schedules: [],
    calendarMarks: [],
    groupProjects: [],
    scheduleOccurrenceOverrides: [],
    semester: SEMESTER,
    currentSemesterWeek: 1,
    activeTab: "timetable" as never,
    selectedAssignmentId: null,
    selectedCourseId: null,
    selectedCalendarMarkId: null,
    pendingTimelineArrangeAssignmentId: null,
    pendingFocusCompletionFollowUp: null,
    pendingGroupTaskTarget: null,
    focusSessions: [],
    studyBlocks: [
      { id: "sb-future", title: "未来计划", date: "2026-03-10", ...FUTURE, assignmentId: "a-1", source: "manual" as const },
      { id: "sb-past", title: "历史计划", date: "2026-03-10", startTime: "08:00", endTime: "09:00", assignmentId: "a-1", source: "manual" as const },
    ],
    reminders: opts?.extraReminder ? [opts.extraReminder] : [],
    preferences: { ...prefs },
  });
}

const futureBlock = () => useAppStore.getState().studyBlocks.find((b) => b.id === "sb-future")!;
const pastBlock = () => useAppStore.getState().studyBlocks.find((b) => b.id === "sb-past")!;

beforeEach(async () => {
  cleanup();
  vi.useFakeTimers({ now: NOW_BASE });
  // persist hydrate 先于 seed（否则 rehydrate 会覆盖测试种子）
  await act(async () => {
    await useAppStore.persist.rehydrate();
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("updateAssignmentStatus → release lifecycle", () => {
  it.each([
    ["submitted"],
    ["completed"],
  ] as const)("todo → %s：future released、past 保持、scheduled reminder 清理（原子）", (terminal) => {
    seed({
      extraReminder: {
        id: "r-sb", targetType: "studyBlock", targetId: "sb-future",
        timingMode: "relative", offsetMinutes: 30, triggerAt: "2026-03-10T15:30:00",
        status: "scheduled" as never, source: "manual" as never, title: "学习提醒",
        createdAt: "", updatedAt: "",
      } as unknown as Reminder,
    });
    act(() => {
      useAppStore.getState().updateAssignmentStatus("a-1", terminal);
    });
    const s = useAppStore.getState();
    expect(futureBlock().planningState).toBe("released");
    expect(pastBlock().planningState).toBeUndefined(); // 历史证据保持
    // 同一 set：无 intermediate state
    expect(s.assignments.find((a) => a.id === "a-1")!.status).toBe(terminal);
    expect(s.reminders.some((r) => r.id === "r-sb")).toBe(false);
  });

  it("submitted → completed：不重复 release（幂等），已 released 保持", () => {
    seed();
    act(() => {
      useAppStore.getState().updateAssignmentStatus("a-1", "submitted"); // 先触发一次 release
    });
    expect(futureBlock().planningState).toBe("released");
    act(() => {
      useAppStore.getState().updateAssignmentStatus("a-1", "completed");
    });
    expect(futureBlock().planningState).toBe("released"); // 不变
  });

  it.each([
    ["completed", "todo"],
    ["submitted", "doing"],
  ] as const)("terminal → active：%s → %s 不自动恢复 released block", (from, to) => {
    seed();
    act(() => {
      useAppStore.getState().updateAssignmentStatus("a-1", from); // 先释放
    });
    expect(futureBlock().planningState).toBe("released");
    act(() => {
      useAppStore.getState().updateAssignmentStatus("a-1", to);
    });
    expect(futureBlock().planningState).toBe("released"); // reopen ≠ restore
  });
});

describe("所有 completion 路径最终一致", () => {
  it("updateAssignment（Full Editor 保存 completed）→ release", () => {
    seed();
    act(() => {
      const cur = useAppStore.getState().assignments[0];
      useAppStore.getState().updateAssignment({ ...cur, status: "completed", progress: 100 });
    });
    expect(futureBlock().planningState).toBe("released");
  });

  it("updateAssignmentProgress = 100 → release", () => {
    seed();
    act(() => {
      useAppStore.getState().updateAssignmentProgress("a-1", 100);
    });
    expect(futureBlock().planningState).toBe("released");
  });

  it("toggle 最后一个 subtask → completed → release", () => {
    seed({
      subtasks: [
        { id: "st-1", title: "子任务一", completed: false },
      ],
    });
    act(() => {
      useAppStore.getState().toggleSubtask("a-1", "st-1");
    });
    const a = useAppStore.getState().assignments.find((x) => x.id === "a-1")!;
    expect(a.status).toBe("completed");
    expect(futureBlock().planningState).toBe("released");
  });
});

describe("Recurrence：parent 完成释放自身计划，child 不继承", () => {
  it("weekly parent completed：spawn child（child 无 parent 的 block）；parent future block released 且 assignmentId 不迁移", () => {
    seed({
      assignment: { recurrence: "weekly" as never, ddl: "2026-03-13T23:59:00" },
    });
    act(() => {
      useAppStore.getState().updateAssignmentStatus("a-1", "completed");
    });
    const s = useAppStore.getState();
    const child = s.assignments.find((a) => a.recurrenceParentId === "a-1");
    expect(child).toBeTruthy();
    const releasedParentBlock = s.studyBlocks.find((b) => b.id === "sb-future")!;
    expect(releasedParentBlock.planningState).toBe("released");
    expect(releasedParentBlock.assignmentId).toBe("a-1"); // 禁止隐式迁移给 child
    // 重复 completion：不再 spawn 第二个 child
    act(() => {
      useAppStore.getState().updateAssignmentStatus("a-1", "todo");
      useAppStore.getState().updateAssignmentStatus("a-1", "completed");
    });
    const children = useAppStore.getState().assignments.filter((a) => a.recurrenceParentId === "a-1");
    expect(children).toHaveLength(1);
  });
});

describe("Reminder write boundary + Runtime final guard", () => {
  it("released StudyBlock：addReminder relative → null；absolute → null", () => {
    seed();
    act(() => {
      useAppStore.getState().updateAssignmentStatus("a-1", "completed");
    });
    const rel = useAppStore.getState().addReminder({
      targetType: "studyBlock", targetId: "sb-future", title: "相对提醒",
      timingMode: "relative", offsetMinutes: 30, source: "manual" } as never);
    expect(rel).toBeNull();
    const abs = useAppStore.getState().addReminder({
      targetType: "studyBlock", targetId: "sb-future", title: "绝对提醒",
      timingMode: "absolute", triggerAt: "2026-03-10T15:00:00", source: "manual" } as never);
    expect(abs).toBeNull();
  });

  it("Runtime 遇到 legacy scheduled reminder（target=released block）→ skip 不 deliver", async () => {
    // 正常路径：todo → completed 触发 release + reminder cleanup
    seed();
    act(() => {
      useAppStore.getState().updateAssignmentStatus("a-1", "completed");
    });
    expect(useAppStore.getState().reminders).toHaveLength(0);
    // 模拟 race / legacy 残留：cleanup 之后又出现一条指向 released block 的 scheduled
    const legacy = {
      id: "r-legacy", targetType: "studyBlock", targetId: "sb-future",
      timingMode: "relative", offsetMinutes: -60, triggerAt: "2026-03-10T11:30:00",
      status: "scheduled" as never, source: "manual" as never, title: "遗留提醒",
      createdAt: "", updatedAt: "",
    } as unknown as Reminder;
    act(() => {
      useAppStore.setState({ reminders: [legacy] });
    });
    render(<ReminderRuntime />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    const after = useAppStore.getState().reminders.find((r) => r.id === "r-legacy");
    expect(after?.status).toBe("skipped");
  }, 20000);
});

describe("Persistence / backup", () => {
  it("restoreAppData 对 backup 数据执行 legacy reconciliation；released 字段 roundtrip 保持", () => {
    seed({ status: "todo" });
    const backup = {
      userProfile: useAppStore.getState().userProfile,
      semester: SEMESTER,
      courses: [],
      schedules: [],
      assignments: [{ ...mkA({ status: "completed" }) }],
      calendarMarks: [],
      groupProjects: [],
      studyBlocks: [
        { id: "bk-future", title: "备份未来", date: "2026-03-10", startTime: "20:00", endTime: "21:00", assignmentId: "a-1", source: "manual" },
        { id: "bk-released", title: "已释放", date: "2026-03-10", startTime: "21:00", endTime: "22:00", assignmentId: "a-1", planningState: "released", source: "manual" },
      ],
      reminders: [],
      focusSessions: [],
      preferences: useAppStore.getState().preferences,
    } as never;
    act(() => {
      useAppStore.getState().restoreAppData(backup);
    });
    const blocks = useAppStore.getState().studyBlocks;
    expect(blocks.find((b) => b.id === "bk-future")!.planningState).toBe("released"); // reconcile
    expect(blocks.find((b) => b.id === "bk-released")!.planningState).toBe("released"); // roundtrip 保持
  });
});
