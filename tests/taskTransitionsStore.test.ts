// @vitest-environment jsdom
/**
 * Phase 0 P0-03：transitionTask / undo / reopen / recurrence 的 Store 边界。
 * 只验证新命令；旧 UI 路径尚未切换。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useAppStore } from "@/store/useAppStore";
import type { Assignment, FocusSession, Reminder, Semester, StudyBlock } from "@/types";

const NOW_BASE = new Date(2026, 10, 6, 15, 0, 0).getTime(); // 2026-11-06 15:00 本地
const SEMESTER: Semester = { id: "s1", name: "测试学期", startDate: "2026-09-01", totalWeeks: 16 };

function task(patch: Partial<Assignment> = {}): Assignment {
  return {
    id: "a1",
    courseId: "c1",
    title: "计量作业",
    description: "",
    ddl: "2026-11-09T23:59:00",
    estimatedMinutes: 240,
    priority: "high",
    status: "doing",
    progress: 40,
    tags: [],
    submissionRequired: true,
    subtasks: [{ id: "st1", title: "收集数据", completed: false }],
    ...patch,
  };
}

function block(
  id: string,
  startTime: string,
  endTime: string,
  patch: Partial<StudyBlock> = {}
): StudyBlock {
  return {
    id,
    title: id,
    date: "2026-11-06",
    startTime,
    endTime,
    assignmentId: "a1",
    courseId: "c1",
    source: "manual",
    ...patch,
  };
}

function reminder(
  id: string,
  targetType: Reminder["targetType"],
  targetId: string,
  patch: Partial<Reminder> = {}
): Reminder {
  return {
    id,
    title: id,
    targetType,
    targetId,
    timingMode: "absolute",
    triggerAt: "2026-11-06T18:00:00",
    status: "scheduled",
    source: "manual",
    createdAt: "2026-11-01T10:00:00",
    updatedAt: "2026-11-01T10:00:00",
    ...patch,
  };
}

function seed(patch: {
  assignments?: Assignment[];
  studyBlocks?: StudyBlock[];
  reminders?: Reminder[];
  focusSessions?: FocusSession[];
} = {}) {
  const prefs = useAppStore.getState().preferences;
  useAppStore.setState({
    courses: [],
    schedules: [],
    calendarMarks: [],
    groupProjects: [],
    scheduleOccurrenceOverrides: [],
    semester: SEMESTER,
    currentSemesterWeek: 1,
    assignments: patch.assignments ?? [task()],
    studyBlocks: patch.studyBlocks ?? [
      block("b-past", "09:00", "10:00"),
      block("b-future", "16:00", "17:00"),
      block("b-released", "18:00", "19:00", { planningState: "released", releasedBy: "legacy" }),
    ],
    reminders: patch.reminders ?? [
      reminder("r-man", "assignment", "a1"),
      reminder("r-auto", "assignment", "a1", { source: "auto", triggerAt: "2026-11-06T19:00:00" }),
      reminder("r-block", "studyBlock", "b-future", { triggerAt: "2026-11-06T15:30:00" }),
      reminder("r-fired", "assignment", "a1", { status: "fired", firedAt: "2026-11-06T10:00:00" }),
    ],
    focusSessions: patch.focusSessions ?? [],
    preferences: { ...prefs },
    selectedAssignmentId: null,
    selectedCourseId: null,
    selectedCalendarMarkId: null,
    pendingTimelineArrangeAssignmentId: null,
    pendingFocusCompletionFollowUp: null,
    pendingGroupTaskTarget: null,
  });
}

const getTask = (id = "a1") => useAppStore.getState().assignments.find((a) => a.id === id)!;
const getBlock = (id: string) => useAppStore.getState().studyBlocks.find((b) => b.id === id)!;
const getReminder = (id: string) => useAppStore.getState().reminders.find((r) => r.id === id);

beforeEach(async () => {
  localStorage.clear();
  vi.useFakeTimers({ now: NOW_BASE });
  // @ts-expect-error — persist 存在于 store
  await useAppStore.persist.rehydrate();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("previewTaskTransition", () => {
  it("统计未来 blocks / reminders / 子任务，不写状态", () => {
    seed();
    const preview = useAppStore.getState().previewTaskTransition("a1", "submitted", "tt1")!;
    expect(preview.blockers).toEqual([]);
    expect(preview.sideEffects.releaseStudyBlocks.ids).toEqual(["b-future"]);
    expect(preview.sideEffects.releaseStudyBlocks.minutes).toBe(60);
    expect(preview.sideEffects.cancelReminders.count).toBe(3);
    expect(preview.sideEffects.cancelReminders.manualCount).toBe(2);
    expect(preview.sideEffects.cancelReminders.autoCount).toBe(1);
    expect(preview.sideEffects.incompleteSubtasks.count).toBe(1);
    expect(getTask().status).toBe("doing");
    expect(getBlock("b-future").planningState).toBeUndefined();
  });

  it("active focus 在任务上 → focus-running blocker", () => {
    seed({
      focusSessions: [
        {
          id: "f1",
          plannedMinutes: 25,
          startedAt: NOW_BASE - 5 * 60_000,
          accumulatedActiveMs: 5 * 60_000,
          status: "running",
          assignmentId: "a1",
          source: "manual",
          createdAt: NOW_BASE - 5 * 60_000,
          updatedAt: NOW_BASE,
        },
      ],
    });
    const preview = useAppStore.getState().previewTaskTransition("a1", "completed", "tt1")!;
    expect(preview.blockers).toContain("focus-running");
    const result = useAppStore.getState().transitionTask("a1", "completed", {
      transitionId: "tt1",
      source: "ui",
    });
    expect(result).toMatchObject({ ok: false, blocker: "focus-running" });
    expect(getTask().status).toBe("doing");
  });
});

describe("transitionTask", () => {
  it("submitted：释放未来 block、取消 manual、删除 auto、写账本", () => {
    seed();
    const result = useAppStore.getState().transitionTask("a1", "submitted", {
      transitionId: "tt1",
      source: "ui",
    });
    expect(result.ok).toBe(true);

    const s = useAppStore.getState();
    const a = getTask();
    expect(a.status).toBe("submitted");
    expect(a.submittedAt).toBe("2026-11-06T15:00:00");
    expect(a.completedAt).toBeUndefined();
    expect(a.lastTerminalTransition?.id).toBe("tt1");
    expect(a.lastTerminalTransition?.releasedStudyBlockIds).toEqual(["b-future"]);
    expect(a.lastTerminalTransition?.cancelledReminderIds.sort()).toEqual(["r-block", "r-man"]);

    expect(getBlock("b-future").planningState).toBe("released");
    expect(getBlock("b-future").releasedBy).toBe("task-submitted");
    expect(getBlock("b-future").releasedByTaskId).toBe("a1");
    expect(getBlock("b-future").releasedAt).toBe("2026-11-06T15:00:00");
    expect(getBlock("b-past").planningState).toBeUndefined();

    expect(getReminder("r-man")?.status).toBe("cancelled");
    expect(getReminder("r-man")?.cancelledReason).toBe("task-submitted");
    expect(getReminder("r-block")?.status).toBe("cancelled");
    expect(getReminder("r-block")?.cancelledReason).toBe("study-block-released");
    expect(getReminder("r-auto")).toBeUndefined();
    expect(getReminder("r-fired")?.status).toBe("fired");
    expect(s.studyBlocks.find((b) => b.id === "b-released")?.planningState).toBe("released");
  });

  it("同一 transitionId 重试幂等；不同 transitionId 对已 submitted 拒绝", () => {
    seed();
    const store = useAppStore.getState();
    const r1 = store.transitionTask("a1", "submitted", { transitionId: "tt1", source: "ui" });
    const childCount = useAppStore.getState().assignments.length;
    const r2 = useAppStore.getState().transitionTask("a1", "submitted", {
      transitionId: "tt1",
      source: "ui",
    });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(useAppStore.getState().assignments.length).toBe(childCount);

    const r3 = useAppStore.getState().transitionTask("a1", "submitted", {
      transitionId: "tt2",
      source: "ui",
    });
    expect(r3).toMatchObject({ ok: false, blocker: "already-completed" });
  });

  it("undo 恢复状态、未来 block、manual/kiro reminders", () => {
    seed();
    useAppStore.getState().transitionTask("a1", "submitted", { transitionId: "tt1", source: "ui" });
    const undo = useAppStore.getState().undoTaskTransition("a1", "tt1");
    expect(undo.ok).toBe(true);
    expect(undo.restoredStudyBlockIds).toEqual(["b-future"]);
    expect(undo.restoredReminderIds.sort()).toEqual(["r-block", "r-man"]);

    expect(getTask().status).toBe("doing");
    expect(getTask().submittedAt).toBeUndefined();
    expect(getTask().lastTerminalTransition).toBeUndefined();
    expect(getBlock("b-future").planningState).toBeUndefined();
    expect(getBlock("b-future").releasedBy).toBeUndefined();
    expect(getReminder("r-man")?.status).toBe("scheduled");
    expect(getReminder("r-block")?.status).toBe("scheduled");
  });

  it("reopen 可选择不恢复 plans/reminders", () => {
    seed();
    useAppStore.getState().transitionTask("a1", "submitted", { transitionId: "tt1", source: "ui" });
    const preview = useAppStore.getState().previewTaskReopen("a1")!;
    expect(preview.fromStatus).toBe("submitted");
    expect(preview.toStatus).toBe("doing");
    expect(preview.restorableStudyBlocks.map((b) => b.id)).toEqual(["b-future"]);
    expect(preview.restorableReminders.map((r) => r.id).sort()).toEqual(["r-block", "r-man"]);

    const result = useAppStore.getState().reopenTask("a1", {
      restoreStudyBlocks: false,
      restoreReminders: false,
      deletePristineRecurrence: false,
      source: "ui",
    });
    expect(result.ok).toBe(true);
    expect(result.restoredStudyBlockIds).toEqual([]);
    expect(result.restoredReminderIds).toEqual([]);
    expect(getTask().status).toBe("doing");
    expect(getBlock("b-future").planningState).toBe("released");
    expect(getReminder("r-man")?.status).toBe("cancelled");
  });
});

describe("recurrence V2 in transition", () => {
  it("submitted 生成下一次；completed 不重复；undo completed 删除 pristine child", () => {
    seed({
      assignments: [
        task({
          id: "a-rec",
          ddl: "2026-11-02T23:59:00",
          recurrence: "weekly",
          recurrenceSeriesId: "rs1",
          status: "todo",
          submissionRequired: true,
        }),
      ],
      studyBlocks: [],
      reminders: [],
    });

    const r1 = useAppStore.getState().transitionTask("a-rec", "submitted", {
      transitionId: "tt1",
      source: "ui",
    });
    expect(r1.ok).toBe(true);
    const parentAfterSubmit = getTask("a-rec");
    expect(parentAfterSubmit.recurrenceSpawnedAt).toBe("2026-11-06T15:00:00");
    const child = useAppStore.getState().assignments.find((a) => a.recurrenceParentId === "a-rec")!;
    expect(child.ddl).toBe("2026-11-09T23:59:00");
    expect(child.recurrenceSeriesId).toBe("rs1");
    expect(child.submissionRequired).toBe(true);

    useAppStore.getState().transitionTask("a-rec", "completed", {
      transitionId: "tt2",
      source: "ui",
    });
    expect(useAppStore.getState().assignments.filter((a) => a.recurrenceParentId === "a-rec")).toHaveLength(1);
    expect(getTask("a-rec").lastTerminalTransition?.generatedRecurrenceId).toBe(child.id);

    const undo = useAppStore.getState().undoTaskTransition("a-rec", "tt2");
    expect(undo.ok).toBe(true);
    expect(undo.deletedRecurrenceId).toBe(child.id);
    // 该任务 terminal 前是 todo → reopen 恢复 todo（不是固定 doing）
    expect(getTask("a-rec").status).toBe("todo");
    expect(getTask("a-rec").recurrenceSpawnedAt).toBeUndefined();
    expect(useAppStore.getState().assignments.some((a) => a.id === child.id)).toBe(false);
  });

  it("child 已有 StudyBlock 时 undo 保留 child", () => {
    seed({
      assignments: [
        task({
          id: "a-rec",
          ddl: "2026-11-02T23:59:00",
          recurrence: "weekly",
          recurrenceSeriesId: "rs1",
          status: "todo",
        }),
      ],
      studyBlocks: [],
      reminders: [],
    });
    useAppStore.getState().transitionTask("a-rec", "submitted", { transitionId: "tt1", source: "ui" });
    const child = useAppStore.getState().assignments.find((a) => a.recurrenceParentId === "a-rec")!;
    useAppStore.setState((state) => ({
      studyBlocks: [
        ...state.studyBlocks,
        {
          id: "b-child",
          title: "child 计划",
          date: "2026-11-10",
          startTime: "10:00",
          endTime: "11:00",
          assignmentId: child.id,
          source: "manual",
        },
      ],
    }));

    const undo = useAppStore.getState().undoTaskTransition("a-rec", "tt1");
    expect(undo.ok).toBe(true);
    expect(undo.deletedRecurrenceId).toBeUndefined();
    expect(useAppStore.getState().assignments.some((a) => a.id === child.id)).toBe(true);
    expect(getTask("a-rec").recurrenceSpawnedAt).toBe("2026-11-06T15:00:00");
  });
});

describe("updateTaskFields / setTaskDoDate", () => {
  it("active 可设 doDate；closed 不可改 planning 字段", () => {
    seed();
    useAppStore.getState().setTaskDoDate("a1", "2026-11-06");
    expect(getTask().doDate).toBe("2026-11-06");

    useAppStore.getState().transitionTask("a1", "submitted", { transitionId: "tt1", source: "ui" });
    useAppStore.getState().setTaskDoDate("a1", "2026-11-08");
    expect(getTask().doDate).toBe("2026-11-06"); // closed → no-op

    useAppStore.getState().updateTaskFields("a1", { ddl: "2026-12-01T23:59:00", title: "改名" });
    expect(getTask().ddl).toBe("2026-11-09T23:59:00");
    expect(getTask().title).toBe("改名");
  });
});
