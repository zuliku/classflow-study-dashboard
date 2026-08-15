import { describe, it, expect, vi, beforeEach } from "vitest";
import { FocusSession } from "@/types";
import { KiroWriteApi } from "@/lib/ai/tools/write/types";

/**
 * Task 5：Kiro × Focus Tools（真实 Store + 真实 Executor）。
 */

const KEY = "classflow-storage-v2";
const T0 = 1_000_000;

function seedState(extra?: { focusSessions?: unknown[] }) {
  const state = {
    userProfile: { name: "测试", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
    semester: { id: "s", name: "测试学期", startDate: "2026-01-01", totalWeeks: 16 },
    courses: [{ id: "c1", name: "统计学", code: "STAT", teacher: "", classroom: "", credit: 3, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [] }],
    schedules: [],
    assignments: [
      { id: "a1", courseId: "c1", title: "统计学作业", description: "", priority: "medium", status: "todo", progress: 0, tags: [] },
    ],
    calendarMarks: [],
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
    focusSessions: extra?.focusSessions,
  };
  localStorage.setItem(KEY, JSON.stringify({ version: 6, state }));
}

async function freshModules() {
  vi.resetModules();
  const storeMod = await import("@/store/useAppStore");
  const readMod = await import("@/lib/ai/tools/read/executor");
  const writeMod = await import("@/lib/ai/tools/write/executor");
  return { store: storeMod.useAppStore, read: readMod, write: writeMod };
}

function buildApi(store: { getState: () => any }): KiroWriteApi {
  const s = () => store.getState();
  return {
    getState: s,
    addAssignmentWithId: (a, id) => id,
    addScheduleOccurrenceOverride: () => ({ ok: true, id: "occ_t" }),
    addScheduleOccurrenceOverrideWithId: (o, id) => ({ ok: true, id }),
    deleteScheduleOccurrenceOverride: () => null,
    restoreScheduleOccurrenceOverride: () => {},
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
    registerUndo: () => {},
  };
}

function mkSession(patch: Partial<FocusSession>): FocusSession {
  return {
    id: "f1",
    plannedMinutes: 30,
    startedAt: T0,
    accumulatedActiveMs: 0,
    status: "running",
    source: "manual",
    createdAt: T0,
    updatedAt: T0,
    ...patch,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("get_focus_status", () => {
  it("inactive → { active: false }", async () => {
    seedState();
    const { store, read } = await freshModules();
    const r = read.executeKiroReadTool("get_focus_status", {}, store.getState()) as { ok: true; data: { active: boolean } };
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ active: false });
  });

  it("active → 时间事实来自 deriveFocusClock（elapsed/remaining 不手算）", async () => {
    const started = Date.now() - 300_000; // 5 分钟前开始
    seedState({ focusSessions: [mkSession({ activeStartedAt: started })] });
    const { store, read } = await freshModules();
    const r = read.executeKiroReadTool("get_focus_status", {}, store.getState()) as {
      ok: true;
      data: { active: boolean; status: string; plannedMinutes: number; elapsedActiveMs: number; remainingMs: number; assignmentTitle?: string };
    };
    expect(r.ok).toBe(true);
    expect(r.data.active).toBe(true);
    expect(r.data.status).toBe("running");
    expect(r.data.plannedMinutes).toBe(30);
    // elapsed ≥ 300s（真实 Date.now()），remaining = plannedMs - elapsed（恒 ≥ 0）
    expect(r.data.elapsedActiveMs).toBeGreaterThanOrEqual(300_000);
    expect(r.data.remainingMs).toBe(30 * 60_000 - r.data.elapsedActiveMs);
    expect(r.data.remainingMs).toBeGreaterThanOrEqual(0);
  });
});

describe("start_focus_session", () => {
  it("start success：source=kiro、assignment 关联快照、canUndo=false", async () => {
    seedState();
    const { store, write } = await freshModules();
    const api = buildApi(store);
    const r = write.executeKiroWriteTool(
      "start_focus_session",
      { plannedMinutes: 25, assignmentId: "a1", note: "写作业" },
      api,
      "c1"
    ) as { ok: true; data: { id: string }; action: { canUndo: boolean; entityType: string; after?: { source?: string } } };
    expect(r.ok).toBe(true);
    const session = store.getState().focusSessions.find((s: FocusSession) => s.id === r.data.id)!;
    expect(session.source).toBe("kiro");
    expect(session.assignmentId).toBe("a1");
    expect(session.courseId).toBe("c1");
    expect(session.assignmentTitleSnapshot).toBe("统计学作业");
    expect(session.courseNameSnapshot).toBe("统计学");
    expect(session.note).toBe("写作业");
    expect(r.action.canUndo).toBe(false);
    expect(r.action.entityType).toBe("focus-session");
  });

  it("already active → FOCUS_SESSION_ALREADY_ACTIVE", async () => {
    seedState({ focusSessions: [mkSession({})] });
    const { store, write } = await freshModules();
    const api = buildApi(store);
    const r = write.executeKiroWriteTool("start_focus_session", { plannedMinutes: 25 }, api, "c1") as { ok: false; code: string };
    expect(r.ok).toBe(false);
    expect(r.code).toBe("FOCUS_SESSION_ALREADY_ACTIVE");
  });

  it("invalid target → FOCUS_TARGET_NOT_FOUND；Assignment/Course mismatch → FOCUS_TARGET_MISMATCH", async () => {
    seedState();
    const { store, write } = await freshModules();
    const api = buildApi(store);
    const missing = write.executeKiroWriteTool("start_focus_session", { plannedMinutes: 25, assignmentId: "ghost" }, api, "c1") as { ok: false; code: string };
    expect(missing.ok).toBe(false);
    expect(missing.code).toBe("FOCUS_TARGET_NOT_FOUND");
    const mismatch = write.executeKiroWriteTool("start_focus_session", { plannedMinutes: 25, assignmentId: "a1", courseId: "c-other" }, api, "c1") as { ok: false; code: string };
    expect(mismatch.ok).toBe(false);
    expect(mismatch.code).toBe("FOCUS_TARGET_MISMATCH");
  });

  it("invalid duration → 工具 schema 拒绝（INVALID_INPUT）", async () => {
    seedState();
    const { store, write } = await freshModules();
    const api = buildApi(store);
    const r = write.executeKiroWriteTool("start_focus_session", { plannedMinutes: 241 }, api, "c1") as { ok: false; code: string };
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INVALID_INPUT");
  });
});

describe("pause / resume / finish", () => {
  it("pause → resume → finish：finish 结算真实 active 时长（暂停不计入）", async () => {
    seedState({ focusSessions: [mkSession({ activeStartedAt: T0 })] });
    const { store, write } = await freshModules();
    const api = buildApi(store);
    const paused = write.executeKiroWriteTool("pause_focus_session", {}, api, "c1") as { ok: true };
    expect(paused.ok).toBe(true);
    expect(store.getState().focusSessions[0].status).toBe("paused");
    // 暂停很久后 resume
    const resumed = write.executeKiroWriteTool("resume_focus_session", {}, api, "c1") as { ok: true };
    expect(resumed.ok).toBe(true);
    expect(store.getState().focusSessions[0].status).toBe("running");
    const finished = write.executeKiroWriteTool("finish_focus_session", {}, api, "c1") as { ok: true; action: { canUndo: boolean } };
    expect(finished.ok).toBe(true);
    const session = store.getState().focusSessions[0];
    expect(session.status).toBe("completed");
    expect(session.endReason).toBe("manual");
    expect(session.actualActiveMs).toBeGreaterThan(0);
    expect(finished.action.canUndo).toBe(false);
  });

  it("无 active → pause/finish 为 NO_ACTIVE_FOCUS_SESSION；resume 为 FOCUS_NOT_PAUSED", async () => {
    seedState();
    const { store, write } = await freshModules();
    const api = buildApi(store);
    for (const tool of ["pause_focus_session", "finish_focus_session"]) {
      const r = write.executeKiroWriteTool(tool, {}, api, "c1") as { ok: false; code: string };
      expect(r.ok).toBe(false);
      expect(r.code).toBe("NO_ACTIVE_FOCUS_SESSION");
    }
    const resume = write.executeKiroWriteTool("resume_focus_session", {}, api, "c1") as { ok: false; code: string };
    expect(resume.ok).toBe(false);
    expect(resume.code).toBe("FOCUS_NOT_PAUSED");
  });
});
