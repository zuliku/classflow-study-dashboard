// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "@testing-library/react";

/**
 * Undo 完整性回归（稳定性审计 Round3）：
 *
 * BUG-031: restoreSchedule 无 id 去重 → toast 撤销双击（140ms 退出窗口）插入重复 schedule
 * BUG-032: deleteSchedule 级联删除 cancel/move override 但不进快照 → 撤销静默丢失 override
 * BUG-033: restoreScheduleOccurrenceOverride 无 parent 校验 → dangling baseScheduleId/courseId
 * BUG-034: restoreReminder（Kiro delete_reminder undo）无 target 校验 → orphan reminder
 * BUG-035: restoreAssignment/restoreSchedule 的 History enqueue 先于 dedupe → 双击产生重复事件
 */

const KEY = "classflow-storage-v2";

function seedState() {
  const state = {
    userProfile: { name: "t", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
    semester: { id: "s", name: "S", startDate: "2026-08-03", totalWeeks: 16 },
    courses: [
      { id: "c1", name: "统计学", code: "STAT", teacher: "", classroom: "", credit: 3, description: "", materials: [] },
      { id: "c2", name: "英语", code: "EN", teacher: "", classroom: "", credit: 2, description: "", materials: [] },
    ],
    schedules: [
      { id: "s1", courseId: "c1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "", weeks: "1-16周" },
      { id: "s2", courseId: "c1", dayOfWeek: 3, startTime: "08:00", endTime: "09:40", location: "", weeks: "1-16周" },
    ],
    assignments: [],
    calendarMarks: [
      { id: "cm-r", date: "2026-09-01", type: "exam", title: "考试R" },
    ],
    groupProjects: [],
    studyBlocks: [],
    assignmentTimeSlice: "all",
    preferences: {
      showWeekends: true, ddlWarningDays: 3, defaultDDLTime: "23:59",
      enableScheduleDirectManipulation: true, enableDDLDirectManipulation: true, motionPreference: "system",
      startupView: "overview", defaultTaskPriority: "medium", defaultTaskStatus: "todo",
      enableSingleKeyShortcuts: true, contentDensity: "comfortable",
    },
    reminders: [],
    scheduleOccurrenceOverrides: [
      { id: "o-move", kind: "move", courseId: "c1", baseScheduleId: "s1", week: 6, dayOfWeek: 4, startTime: "18:00", endTime: "19:40", location: "B101", source: "manual" },
    ],
  };
  localStorage.setItem(KEY, JSON.stringify({ version: 8, state }));
}

async function freshStore() {
  vi.resetModules();
  const mod = await import("@/store/useAppStore");
  return mod.useAppStore;
}

beforeEach(() => {
  localStorage.clear();
});

describe("schedule delete/undo snapshot integrity", () => {
  it("deleteSchedule 返回含被级联 override 的完整快照；撤销恢复两者（原 ID）", async () => {
    seedState();
    const store = await freshStore();
    const snap = store.getState().deleteSchedule("s1");
    expect(snap).not.toBeNull();
    expect(snap!.schedule.id).toBe("s1");
    expect(snap!.removedOverrides.map((o) => o.id)).toEqual(["o-move"]);
    expect(store.getState().scheduleOccurrenceOverrides).toHaveLength(0);

    act(() => { store.getState().restoreSchedule(snap!.schedule, undefined, snap!.removedOverrides); });
    const s = store.getState();
    expect(s.schedules.find((x) => x.id === "s1")).toBeTruthy();
    expect(s.scheduleOccurrenceOverrides.find((o) => o.id === "o-move")!.baseScheduleId).toBe("s1");
  });

  it("双击撤销：第二次调用整体 no-op（不产生重复实体）", async () => {
    seedState();
    const store = await freshStore();
    const snap = store.getState().deleteSchedule("s1")!;
    const run = () =>
      act(() => { store.getState().restoreSchedule(snap.schedule, undefined, snap.removedOverrides); });
    run(); run(); run();

    const s = store.getState();
    expect(s.schedules.filter((x) => x.id === "s1")).toHaveLength(1);
    expect(s.scheduleOccurrenceOverrides.filter((o) => o.id === "o-move")).toHaveLength(1);
  });
});

describe("override / reminder restore referential guards", () => {
  it("BUG-033: base schedule 已删 → restoreScheduleOccurrenceOverride 拒绝插入", async () => {
    seedState();
    const store = await freshStore();
    // 删除 s1（其 move override 被级联删除），随后删除整个 course c1
    const snap = store.getState().deleteSchedule("s1")!;
    act(() => { store.getState().deleteCourse("c1"); });

    act(() => { store.getState().restoreScheduleOccurrenceOverride({ ...snap.removedOverrides[0] }); });
    expect(
      store.getState().scheduleOccurrenceOverrides.find((o) => o.id === "o-move")
    ).toBeUndefined();

    // 对照组：base 存在时正常恢复
    seedState();
    const store2 = await freshStore();
    act(() => {
      store2.getState().restoreScheduleOccurrenceOverride({
        id: "o-x", kind: "cancel", courseId: "c1", baseScheduleId: "s1", week: 2, source: "manual",
      } as never);
    });
    expect(store2.getState().scheduleOccurrenceOverrides.some((o) => o.id === "o-x")).toBe(true);
  });

  it("BUG-034: target 已删除 → restoreReminder 拒绝插入 orphan", async () => {
    seedState();
    const store = await freshStore();
    act(() => {
      store.setState({
        assignments: [{ id: "a1", courseId: "", title: "任务A", description: "", ddl: "2026-09-01T23:59:00", priority: "medium", status: "doing", progress: 0, tags: [] }],
        reminders: [],
      });
    });

    const orphanReminder = {
      id: "r-orphan", title: "提醒", targetType: "assignment" as const, targetId: "a-gone",
      timingMode: "absolute" as const, triggerAt: "2026-08-31T10:00:00", status: "scheduled" as const,
      source: "manual" as const, createdAt: "2026-08-20T00:00:00", updatedAt: "2026-08-20T00:00:00",
    };
    act(() => { store.getState().restoreReminder(orphanReminder as never); });
    expect(store.getState().reminders.find((r) => r.id === "r-orphan")).toBeUndefined();

    // 对照组：target 存在 → 正常恢复
    const alive = { ...orphanReminder, id: "r-alive", targetId: "a1" };
    act(() => { store.getState().restoreReminder(alive as never); });
    expect(store.getState().reminders.find((r) => r.id === "r-alive")).toBeTruthy();
  });
});
