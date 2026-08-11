import { describe, it, expect, vi, beforeEach } from "vitest";
import { Assignment, Reminder } from "@/types";
import { KiroWriteApi } from "@/lib/ai/tools/write/types";
import { KIRO_WRITE_TOOLS } from "@/lib/ai/tools/write/registry";

/**
 * Task 7G-B：Kiro Reminder Agent Tools（真实 Store + 真实 Executor）。
 * 覆盖：list_reminders 语义 / create relative+absolute / validation / duplicate / past guard /
 * update（relative→absolute、fired 拒绝）/ delete Undo（相同 ID 恢复）。
 */

const KEY = "classflow-storage-v2";

function dayOffset(offset: number, hour = 23, minute = 59): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(hour)}:${p(minute)}:00`;
}

function seedState(extra?: { reminders?: unknown[] }) {
  const state = {
    userProfile: { name: "测试", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
    semester: { id: "s", name: "测试学期", startDate: "2026-01-01", totalWeeks: 16 },
    courses: [{ id: "c1", name: "统计学", code: "STAT", teacher: "", classroom: "", credit: 3, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [] }],
    schedules: [],
    assignments: [
      { id: "a1", courseId: "c1", title: "统计学作业", description: "", ddl: dayOffset(5), priority: "medium", status: "todo", progress: 0, tags: [] },
      { id: "a-done", courseId: "c1", title: "已完成任务", description: "", ddl: dayOffset(3), priority: "medium", status: "completed", progress: 100, tags: [] },
      { id: "a-noddl", courseId: "c1", title: "无截止任务", description: "", priority: "medium", status: "todo", progress: 0, tags: [] },
    ],
    calendarMarks: [{ id: "cm1", date: dayOffset(5).slice(0, 10), type: "ddl", title: "统计学作业", sourceId: "a1" }],
    groupProjects: [],
    studyBlocks: [],
    assignmentTimeSlice: "all",
    preferences: {
      showWeekends: true, ddlWarningDays: 3, defaultDDLTime: "23:59",
      enableScheduleDirectManipulation: true, enableDDLDirectManipulation: true, motionPreference: "system",
      startupView: "overview", defaultTaskPriority: "medium", defaultTaskStatus: "todo",
      enableSingleKeyShortcuts: true, contentDensity: "comfortable",
    },
    reminders: extra?.reminders,
  };
  localStorage.setItem(KEY, JSON.stringify({ version: 5, state }));
}

async function freshModules() {
  vi.resetModules();
  const storeMod = await import("@/store/useAppStore");
  const readMod = await import("@/lib/ai/tools/read/executor");
  const writeMod = await import("@/lib/ai/tools/write/executor");
  return { store: storeMod.useAppStore, read: readMod, write: writeMod };
}

function buildApi(store: { getState: () => any }, undos: Map<string, () => void>): KiroWriteApi {
  const s = () => store.getState();
  return {
    getState: s,
    addAssignment: (a) => store.getState().addAssignment(a),
    updateAssignment: (a) => store.getState().updateAssignment(a),
    updateAssignmentPatch: (id, patch) => store.getState().updateAssignmentPatch(id, patch),
    deleteAssignment: (id) => store.getState().deleteAssignment(id),
    restoreAssignment: (snapshot) => store.getState().restoreAssignment(snapshot),
    updateAssignmentStatus: (id, status) => store.getState().updateAssignmentStatus(id, status),
    updateAssignmentPriority: (id, priority) => store.getState().updateAssignmentPriority(id, priority),
    updateAssignmentProgress: (id, progress) => store.getState().updateAssignmentProgress(id, progress),
    toggleSubtask: (id, subtaskId) => store.getState().toggleSubtask(id, subtaskId),
    addScheduleSlot: (sl) => store.getState().addScheduleSlot(sl),
    updateSchedule: (sc) => store.getState().updateSchedule(sc),
    deleteSchedule: (id) => store.getState().deleteSchedule(id),
    restoreSchedule: (sc) => store.getState().restoreSchedule(sc),
    excludeWeekFromSchedule: (id, week) => store.getState().excludeWeekFromSchedule(id, week),
    addCourseWithSchedule: (c, slots) => store.getState().addCourseWithSchedule(c, slots),
    updateCourse: (c) => store.getState().updateCourse(c),
    addGroupProject: (p) => store.getState().addGroupProject(p),
    updateGroupProject: (id, patch) => store.getState().updateGroupProject(id, patch),
    deleteGroupProject: (id) => store.getState().deleteGroupProject(id),
    addGroupMember: (id, m) => store.getState().addGroupMember(id, m),
    updateGroupMember: (id, m) => store.getState().updateGroupMember(id, m),
    deleteGroupMember: (id, memberId) => store.getState().deleteGroupMember(id, memberId),
    addGroupTask: (id, t) => store.getState().addGroupTask(id, t),
    updateGroupTask: (id, t) => store.getState().updateGroupTask(id, t),
    deleteGroupTask: (id, taskId) => store.getState().deleteGroupTask(id, taskId),
    toggleGroupTask: (id, taskId) => store.getState().toggleGroupTask(id, taskId),
    addReminder: (input) => store.getState().addReminder(input),
    updateReminder: (id, patch) => store.getState().updateReminder(id, patch),
    deleteReminder: (id) => store.getState().deleteReminder(id),
    restoreReminder: (r) => store.getState().restoreReminder(r),
    reconcileTargetReminders: (targetType, targetId) => store.getState().reconcileTargetReminders(targetType, targetId),
    startFocusSession: (input) => store.getState().startFocusSession(input),
    pauseFocusSession: (now) => store.getState().pauseFocusSession(now),
    resumeFocusSession: (now) => store.getState().resumeFocusSession(now),
    finishFocusSession: (now) => store.getState().finishFocusSession(now),
    pushToast: () => {},
    registerUndo: (toolCallId, undo) => undos.set(toolCallId, undo),
  };
}

function seedReminder(patch: Partial<Reminder>): Reminder {
  return {
    id: "r1",
    title: "统计学作业",
    targetType: "assignment",
    targetId: "a1",
    timingMode: "relative",
    offsetMinutes: -60,
    // 与 a1 DDL（23:59）一致的解析结果：23:59 - 60min
    triggerAt: dayOffset(5, 22, 59),
    status: "scheduled",
    source: "manual",
    createdAt: "2026-08-10T12:00:00",
    updatedAt: "2026-08-10T12:00:00",
    ...patch,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("list_reminders", () => {
  it("1. 默认只返回 scheduled，triggerAt 升序（最早在前）", async () => {
    seedState({
      reminders: [
        seedReminder({ id: "late", triggerAt: dayOffset(5, 23, 0), offsetMinutes: 0 }),
        seedReminder({ id: "early", triggerAt: dayOffset(5, 22, 0) }),
        seedReminder({ id: "fired", status: "fired", firedAt: "2026-08-10T12:00:00" }),
        seedReminder({ id: "skipped", status: "skipped" }),
      ],
    });
    const { store, read } = await freshModules();
    const r = read.executeKiroReadTool("list_reminders", {}, store.getState()) as { ok: true; data: { id: string }[] };
    expect(r.ok).toBe(true);
    expect(r.data.map((x) => x.id)).toEqual(["early", "late"]);
  });

  it("2. targetId / status filter 正确；scheduled 升序、fired/skipped 最近优先", async () => {
    seedState({
      reminders: [
        seedReminder({ id: "mine", triggerAt: dayOffset(5, 22, 0) }),
        seedReminder({ id: "other", targetId: "a2", triggerAt: dayOffset(5, 21, 0) }),
        seedReminder({ id: "old-fired", status: "fired", firedAt: "2026-08-10T12:00:00", triggerAt: dayOffset(0, 9, 0) }),
        seedReminder({ id: "new-fired", status: "fired", firedAt: "2026-08-10T12:00:00", triggerAt: dayOffset(0, 10, 0) }),
      ],
    });
    const { store, read } = await freshModules();
    const mine = read.executeKiroReadTool("list_reminders", { targetId: "a1" }, store.getState()) as { ok: true; data: { id: string }[] };
    expect(mine.data.map((x) => x.id)).toEqual(["mine"]);
    const fired = read.executeKiroReadTool("list_reminders", { status: "fired" }, store.getState()) as { ok: true; data: { id: string }[] };
    expect(fired.data.map((x) => x.id)).toEqual(["new-fired", "old-fired"]);
  });
});

describe("create_reminder", () => {
  it("3. standalone absolute：source=kiro、triggerAt 正确；Undo 删除", async () => {
    seedState();
    const { store, write } = await freshModules();
    const undos = new Map<string, () => void>();
    const api = buildApi(store, undos);
    const target = dayOffset(2, 20, 0);
    const r = write.executeKiroWriteTool("create_reminder", { title: "交材料", timingMode: "absolute", triggerAt: target }, api, "c1") as { ok: true; data: { id: string } };
    expect(r.ok).toBe(true);
    const created = store.getState().reminders.find((x: Reminder) => x.id === r.data.id)!;
    expect(created.source).toBe("kiro");
    expect(created.targetType).toBe("standalone");
    expect(created.triggerAt).toBe(target);
    undos.get("c1")!();
    expect(store.getState().reminders.find((x: Reminder) => x.id === r.data.id)).toBeUndefined();
  });

  it("4. assignment relative -60：triggerAt = DDL - 60min（无 UTC 漂移）", async () => {
    seedState();
    const { store, write } = await freshModules();
    const undos = new Map<string, () => void>();
    const api = buildApi(store, undos);
    const r = write.executeKiroWriteTool("create_reminder", { title: "统计学作业", targetType: "assignment", targetId: "a1", timingMode: "relative", offsetMinutes: -60 }, api, "c1") as { ok: true; data: { id: string } };
    expect(r.ok).toBe(true);
    const created = store.getState().reminders.find((x: Reminder) => x.id === r.data.id)!;
    // DDL 23:59 - 60min = 22:59（本地墙钟，无 UTC 漂移）
    expect(created.triggerAt).toBe(dayOffset(5, 22, 59));
    expect(created.targetId).toBe("a1");
  });

  it("5. relative target 不存在 / Assignment 无 DDL → fail，不产生 mutation", async () => {
    seedState();
    const { store, write } = await freshModules();
    const api = buildApi(store, new Map());
    const before = store.getState().reminders.length;
    const missing = write.executeKiroWriteTool("create_reminder", { title: "x", targetType: "assignment", targetId: "ghost", timingMode: "relative", offsetMinutes: -60 }, api, "c1") as { ok: false; code: string };
    expect(missing.ok).toBe(false);
    expect(missing.code).toBe("NOT_FOUND");
    const noDdl = write.executeKiroWriteTool("create_reminder", { title: "x", targetType: "assignment", targetId: "a-noddl", timingMode: "relative", offsetMinutes: -60 }, api, "c1") as { ok: false; code: string };
    expect(noDdl.ok).toBe(false);
    expect(noDdl.code).toBe("INVALID_INPUT");
    expect(store.getState().reminders.length).toBe(before);
  });

  it("6. 过去的 absolute / relative → fail，不创建", async () => {
    seedState();
    const { store, write } = await freshModules();
    const api = buildApi(store, new Map());
    const before = store.getState().reminders.length;
    const pastAbs = write.executeKiroWriteTool("create_reminder", { title: "x", timingMode: "absolute", triggerAt: dayOffset(-1, 9, 0) }, api, "c1") as { ok: false };
    expect(pastAbs.ok).toBe(false);
    // 已完成任务的 relative → fail
    const done = write.executeKiroWriteTool("create_reminder", { title: "x", targetType: "assignment", targetId: "a-done", timingMode: "relative", offsetMinutes: 0 }, api, "c1") as { ok: false; code: string };
    expect(done.ok).toBe(false);
    expect(done.code).toBe("INVALID_INPUT");
    expect(store.getState().reminders.length).toBe(before);
  });

  it("7. duplicate relative -60 → fail；absolute 可单独存在", async () => {
    seedState({ reminders: [seedReminder({})] });
    const { store, write } = await freshModules();
    const api = buildApi(store, new Map());
    const dup = write.executeKiroWriteTool("create_reminder", { title: "统计学作业", targetType: "assignment", targetId: "a1", timingMode: "relative", offsetMinutes: -60 }, api, "c1") as { ok: false; code: string };
    expect(dup.ok).toBe(false);
    expect(dup.code).toBe("INVALID_INPUT");
    const abs = write.executeKiroWriteTool("create_reminder", { title: "统计学作业", targetType: "assignment", targetId: "a1", timingMode: "absolute", triggerAt: dayOffset(5, 20, 0) }, api, "c1") as { ok: true };
    expect(abs.ok).toBe(true);
    expect(store.getState().reminders).toHaveLength(2);
  });
});

describe("update_reminder / delete_reminder", () => {
  it("8. relative → absolute：成功；offset 清除；triggerAt 用用户时间；Undo 恢复原 relative", async () => {
    seedState({ reminders: [seedReminder({})] });
    const { store, write } = await freshModules();
    const undos = new Map<string, () => void>();
    const api = buildApi(store, undos);
    const targetAbs = dayOffset(3, 9, 0);
    const r = write.executeKiroWriteTool("update_reminder", { reminderId: "r1", timingMode: "absolute", triggerAt: targetAbs }, api, "c1") as { ok: true };
    expect(r.ok).toBe(true);
    const updated = store.getState().reminders.find((x: Reminder) => x.id === "r1")!;
    expect(updated.timingMode).toBe("absolute");
    expect(updated.offsetMinutes).toBeUndefined();
    expect(updated.triggerAt).toBe(targetAbs);
    undos.get("c1")!();
    const restored = store.getState().reminders.find((x: Reminder) => x.id === "r1")!;
    expect(restored.timingMode).toBe("relative");
    expect(restored.offsetMinutes).toBe(-60);
    expect(restored.triggerAt).toBe(dayOffset(5, 22, 59));
  });

  it("9. update fired reminder → fail（历史提醒不重新激活）", async () => {
    seedState({ reminders: [seedReminder({ status: "fired", firedAt: "2026-08-10T12:00:00" })] });
    const { store, write } = await freshModules();
    const api = buildApi(store, new Map());
    const r = write.executeKiroWriteTool("update_reminder", { reminderId: "r1", timingMode: "absolute", triggerAt: dayOffset(2, 9, 0) }, api, "c1") as { ok: false; code: string };
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INVALID_INPUT");
    expect(store.getState().reminders[0].status).toBe("fired");
  });

  it("10. delete scheduled + Undo：恢复相同 ID / triggerAt / targetId / status", async () => {
    seedState({ reminders: [seedReminder({ status: "scheduled" })] });
    const { store, write } = await freshModules();
    const undos = new Map<string, () => void>();
    const api = buildApi(store, undos);
    const before = store.getState().reminders[0];
    const r = write.executeKiroWriteTool("delete_reminder", { reminderId: "r1" }, api, "c1") as { ok: true };
    expect(r.ok).toBe(true);
    expect(store.getState().reminders.find((x: Reminder) => x.id === "r1")).toBeUndefined();
    undos.get("c1")!();
    const restored = store.getState().reminders.find((x: Reminder) => x.id === "r1")!;
    expect(restored).toBeTruthy();
    expect(restored.id).toBe(before.id);
    expect(restored.triggerAt).toBe(before.triggerAt);
    expect(restored.targetId).toBe(before.targetId);
    expect(restored.status).toBe(before.status);
    expect(restored.readAt).toBe(before.readAt);
  });

  it("11. fired / skipped reminder cannot be deleted and no Undo is registered", async () => {
    seedState({
      reminders: [
        seedReminder({ id: "r-fired", status: "fired", firedAt: "2026-08-10T12:00:00" }),
        seedReminder({ id: "r-skipped", status: "skipped" }),
      ],
    });
    const { store, write } = await freshModules();
    const undos = new Map<string, () => void>();
    const api = buildApi(store, undos);

    const before = store.getState().reminders.map((x: Reminder) => ({ ...x }));

    const fired = write.executeKiroWriteTool("delete_reminder", { reminderId: "r-fired" }, api, "delete-fired") as {
      ok: false;
      code: string;
      message: string;
    };
    const skipped = write.executeKiroWriteTool("delete_reminder", { reminderId: "r-skipped" }, api, "delete-skipped") as {
      ok: false;
      code: string;
      message: string;
    };

    expect(fired.ok).toBe(false);
    expect(fired.code).toBe("INVALID_INPUT");
    expect(skipped.ok).toBe(false);
    expect(skipped.code).toBe("INVALID_INPUT");
    // 失败：不 mutation、不注册 Undo
    expect(store.getState().reminders).toEqual(before);
    expect(undos.has("delete-fired")).toBe(false);
    expect(undos.has("delete-skipped")).toBe(false);
  });
});

describe("delete_reminder contract", () => {
  it("description only requires list_reminders when reminderId is not uniquely known", () => {
    const description = String(KIRO_WRITE_TOOLS.delete_reminder.description ?? "");
    expect(description).toContain("没有唯一 reminderId");
    expect(description).toContain("list_reminders");
    expect(description).not.toContain("删除前必须用 list_reminders");
  });
});
