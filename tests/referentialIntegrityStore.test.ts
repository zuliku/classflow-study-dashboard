import { describe, it, expect, vi, beforeEach } from "vitest";
import { Assignment, Reminder, StudyBlock } from "@/types";

/**
 * Task 7G-C：Store 级引用完整性（deleteAssignment 完整级联 + Undo；deleteCourse 完整级联无 Undo）。
 */

const KEY = "classflow-storage-v2";

function seedState() {
  const state = {
    userProfile: { name: "测试", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
    semester: { id: "s", name: "测试学期", startDate: "2026-01-01", totalWeeks: 16 },
    courses: [
      { id: "c1", name: "统计学", code: "STAT", teacher: "", classroom: "", credit: 3, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [] },
      { id: "c2", name: "英语", code: "EN", teacher: "", classroom: "", credit: 2, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [] },
    ],
    schedules: [
      { id: "s1", courseId: "c1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "", weeks: "1-16周" },
    ],
    assignments: [
      { id: "a1", courseId: "c1", title: "统计学作业", description: "", ddl: "2026-08-15T23:59:00", priority: "medium", status: "todo", progress: 0, tags: [] },
      { id: "a2", courseId: "c2", title: "英语作业", description: "", priority: "medium", status: "todo", progress: 0, tags: [] },
    ],
    calendarMarks: [
      { id: "cm1", date: "2026-08-15", type: "ddl", title: "统计学作业", sourceId: "a1" },
    ],
    groupProjects: [],
    studyBlocks: [
      { id: "b1", title: "统计学学习", date: "2026-08-14", startTime: "19:00", endTime: "20:00", assignmentId: "a1", courseId: "c1", source: "manual" },
      { id: "b2", title: "英语学习", date: "2026-08-14", startTime: "20:00", endTime: "21:00", courseId: "c2", source: "manual" },
    ],
    assignmentTimeSlice: "all",
    preferences: {
      showWeekends: true, ddlWarningDays: 3, defaultDDLTime: "23:59",
      enableScheduleDirectManipulation: true, enableDDLDirectManipulation: true, motionPreference: "system",
      startupView: "overview", defaultTaskPriority: "medium", defaultTaskStatus: "todo",
      enableSingleKeyShortcuts: true, contentDensity: "comfortable",
    },
    reminders: [
      { id: "r-assign", title: "统计学作业", targetType: "assignment", targetId: "a1", timingMode: "relative", offsetMinutes: -60, triggerAt: "2026-08-15T22:59:00", status: "scheduled", source: "manual", createdAt: "2026-08-10T12:00:00", updatedAt: "2026-08-10T12:00:00" },
      { id: "r-block", title: "学习提醒", targetType: "studyBlock", targetId: "b1", timingMode: "relative", offsetMinutes: -10, triggerAt: "2026-08-14T18:50:00", status: "fired", firedAt: "2026-08-14T18:50:00", readAt: "2026-08-14T19:00:00", source: "manual", createdAt: "2026-08-10T12:00:00", updatedAt: "2026-08-10T12:00:00" },
      { id: "r-mark", title: "截止提醒", targetType: "calendarMark", targetId: "cm1", timingMode: "absolute", triggerAt: "2026-08-15T20:00:00", status: "skipped", source: "manual", createdAt: "2026-08-10T12:00:00", updatedAt: "2026-08-10T12:00:00" },
      { id: "r-standalone", title: "交材料", targetType: "standalone", timingMode: "absolute", triggerAt: "2026-08-20T09:00:00", status: "scheduled", source: "manual", createdAt: "2026-08-10T12:00:00", updatedAt: "2026-08-10T12:00:00" },
      { id: "r-other", title: "英语提醒", targetType: "assignment", targetId: "a2", timingMode: "absolute", triggerAt: "2026-08-20T10:00:00", status: "scheduled", source: "manual", createdAt: "2026-08-10T12:00:00", updatedAt: "2026-08-10T12:00:00" },
    ],
  };
  localStorage.setItem(KEY, JSON.stringify({ version: 5, state }));
}

async function freshStore() {
  vi.resetModules();
  const mod = await import("@/store/useAppStore");
  return mod.useAppStore;
}

beforeEach(() => {
  localStorage.clear();
});

describe("deleteAssignment 完整级联 + Undo", () => {
  it("删除后：Assignment / DDL mark / StudyBlocks / 三类 Reminder 全消失；standalone 与 unrelated 保留", async () => {
    seedState();
    const store = await freshStore();
    const snapshot = store.getState().deleteAssignment("a1");
    expect(snapshot).not.toBeNull();

    const s = store.getState();
    expect(s.assignments.find((a: Assignment) => a.id === "a1")).toBeUndefined();
    expect(s.calendarMarks.find((m: any) => m.id === "cm1")).toBeUndefined();
    expect(s.studyBlocks.find((b: StudyBlock) => b.id === "b1")).toBeUndefined();
    for (const id of ["r-assign", "r-block", "r-mark"]) {
      expect(s.reminders.find((r: Reminder) => r.id === id)).toBeUndefined();
    }
    expect(s.reminders.find((r: Reminder) => r.id === "r-standalone")).toBeTruthy();
    expect(s.reminders.find((r: Reminder) => r.id === "r-other")).toBeTruthy();
    expect(s.studyBlocks.find((b: StudyBlock) => b.id === "b2")).toBeTruthy();
  });

  it("Undo 恢复全部：原 ID / triggerAt / status / firedAt / readAt / createdAt / updatedAt / StudyBlock 时间 / mark sourceId", async () => {
    seedState();
    const store = await freshStore();
    const snapshot = store.getState().deleteAssignment("a1")!;
    const rBlockBefore = snapshot.reminders.find((r) => r.id === "r-block")!;

    store.getState().restoreAssignment(snapshot);
    const s = store.getState();
    expect(s.assignments.find((a: Assignment) => a.id === "a1")).toBeTruthy();
    expect(s.calendarMarks.find((m: any) => m.id === "cm1")!.sourceId).toBe("a1");
    const b1 = s.studyBlocks.find((b: StudyBlock) => b.id === "b1")!;
    expect(b1.date).toBe("2026-08-14");
    expect(b1.startTime).toBe("19:00");
    const rb = s.reminders.find((r: Reminder) => r.id === "r-block")!;
    expect(rb.triggerAt).toBe(rBlockBefore.triggerAt);
    expect(rb.status).toBe(rBlockBefore.status);
    expect(rb.firedAt).toBe(rBlockBefore.firedAt);
    expect(rb.readAt).toBe(rBlockBefore.readAt);
    expect(rb.createdAt).toBe(rBlockBefore.createdAt);
    expect(rb.updatedAt).toBe(rBlockBefore.updatedAt);
    expect(s.reminders.find((r: Reminder) => r.id === "r-assign")).toBeTruthy();
    expect(s.reminders.find((r: Reminder) => r.id === "r-mark")).toBeTruthy();

    // Repeated restore：不重复
    store.getState().restoreAssignment(snapshot);
    expect(s.assignments.filter((a: Assignment) => a.id === "a1")).toHaveLength(1);
    expect(store.getState().reminders.filter((r: Reminder) => r.id === "r-assign")).toHaveLength(1);
  });
});

describe("deleteCourse 完整级联（无 Undo）", () => {
  it("删除 c1：course / schedule / assignment / DDL mark / direct+assignment StudyBlocks / affected reminders 全消失；c2 / standalone 保留", async () => {
    seedState();
    const store = await freshStore();
    store.getState().deleteCourse("c1");

    const s = store.getState();
    expect(s.courses.find((c: any) => c.id === "c1")).toBeUndefined();
    expect(s.schedules.find((x: any) => x.id === "s1")).toBeUndefined();
    expect(s.assignments.find((a: Assignment) => a.id === "a1")).toBeUndefined();
    expect(s.calendarMarks.find((m: any) => m.id === "cm1")).toBeUndefined();
    expect(s.studyBlocks.find((b: StudyBlock) => b.id === "b1")).toBeUndefined();
    for (const id of ["r-assign", "r-block", "r-mark"]) {
      expect(s.reminders.find((r: Reminder) => r.id === id)).toBeUndefined();
    }
    // b2 属于 c2：保留
    expect(s.studyBlocks.find((b: StudyBlock) => b.id === "b2")).toBeTruthy();
    expect(s.courses.find((c: any) => c.id === "c2")).toBeTruthy();
    expect(s.assignments.find((a: Assignment) => a.id === "a2")).toBeTruthy();
    expect(s.reminders.find((r: Reminder) => r.id === "r-standalone")).toBeTruthy();
    expect(s.reminders.find((r: Reminder) => r.id === "r-other")).toBeTruthy();
  });
});

// ============================================================
// Undo 窗口并发删除：parent Course 已删 → restore 必须拒绝（不产生 orphan 引用）
// 复现：删除 Assignment → 6s 撤销窗口内删除其 Course → 点击「撤销」。
// 历史 bug：restore 原样插回，产生 courseId 悬空引用。
// ============================================================
describe("restore referential validation (undo-window course delete)", () => {
  it("Assignment：Course 已删 → restore 拒绝插回；无 courseId 的任务不受影响", async () => {
    seedState();
    const store = await freshStore();
    const snapshot = store.getState().deleteAssignment("a1")!;
    // 撤销窗口内：课程被删除
    store.getState().deleteCourse("c1");

    store.getState().restoreAssignment(snapshot);
    const s = store.getState();
    // 不凭空重建 orphan assignment
    expect(s.assignments.find((a: Assignment) => a.id === "a1")).toBeUndefined();
    // 关联 blocks / marks / reminders 也不得恢复成孤儿
    expect(s.studyBlocks.find((b: StudyBlock) => b.id === "b1")).toBeUndefined();
    expect(s.calendarMarks.find((m: any) => m.id === "cm1")).toBeUndefined();

    // 对照组：无 courseId 的 standalone snapshot 正常恢复
    seedState();
    const store2 = await freshStore();
    const snap2 = store2.getState().deleteAssignment("a2")!;
    store2.getState().restoreAssignment(snap2);
    expect(store2.getState().assignments.find((a: Assignment) => a.id === "a2")).toBeTruthy();
  });

  it("Schedule：Course 已删 → restoreSchedule 拒绝插回", async () => {
    seedState();
    const store = await freshStore();
    const schedule = store.getState().schedules.find((x: any) => x.id === "s1")!;
    store.getState().deleteSchedule("s1");
    // 撤销窗口内：课程被删除
    store.getState().deleteCourse("c1");

    store.getState().restoreSchedule(schedule);
    expect(store.getState().schedules.find((x: any) => x.id === "s1")).toBeUndefined();

    // 对照组：课程仍在时正常恢复
    store.getState().restoreSchedule(schedule);
    expect(store.getState().schedules.find((x: any) => x.id === "s1")).toBeUndefined(); // 课程已删，仍拒绝
  });

  it("Schedule 对照：课程存在时 restoreSchedule 正常恢复（原行为不回归）", async () => {
    seedState();
    const store = await freshStore();
    const schedule = store.getState().schedules.find((x: any) => x.id === "s1")!;
    store.getState().deleteSchedule("s1");
    store.getState().restoreSchedule(schedule);
    expect(store.getState().schedules.find((x: any) => x.id === "s1")).toBeTruthy();
  });
});
