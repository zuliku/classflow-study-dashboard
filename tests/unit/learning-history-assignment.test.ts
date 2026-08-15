import { describe, it, expect, beforeEach, vi } from "vitest";
import { Assignment } from "@/types";
import { deriveAssignmentTransitionEvents } from "@/lib/history/assignmentEvents";
import { resolveLearningMutationContext } from "@/lib/history/recorder";
import { countLearningHistoryEvents, clearLearningHistoryStorage } from "@/lib/history/store";
import { flushLearningHistoryQueue } from "@/lib/history/recorder";
import { executeKiroWriteTool } from "@/lib/ai/tools/write/executor";

const SEMESTER = { id: "sem1", name: "测试学期", startDate: "2026-08-10", totalWeeks: 16 };
const ENV = { semester: SEMESTER };
const CTX = resolveLearningMutationContext({ source: "manual" });

function mkA(patch: Partial<Assignment>): Assignment {
  return {
    id: "a1",
    courseId: "c1",
    title: "任务",
    description: "",
    priority: "medium",
    status: "todo",
    progress: 0,
    tags: [],
    ...patch,
  } as Assignment;
}

function typesOf(events: ReturnType<typeof deriveAssignmentTransitionEvents>): string[] {
  return events.map((e) => e.type);
}

beforeEach(async () => {
  await clearLearningHistoryStorage();
});

describe("Assignment History Events（纯函数）", () => {
  it("todo → doing：只 status_changed", () => {
    const events = deriveAssignmentTransitionEvents({
      before: mkA({ status: "todo" }),
      after: mkA({ status: "doing", progress: 20 }),
      context: CTX,
      completionTrigger: "status",
      environment: ENV,
    });
    expect(typesOf(events)).toEqual(["assignment.status_changed"]);
    expect((events[0] as { data: { from: string; to: string } }).data).toEqual({
      from: "todo",
      to: "doing",
    });
  });

  it("doing → completed：status_changed + completed", () => {
    const events = deriveAssignmentTransitionEvents({
      before: mkA({ status: "doing" }),
      after: mkA({ status: "completed", progress: 100 }),
      context: CTX,
      completionTrigger: "progress",
      environment: ENV,
    });
    expect(typesOf(events)).toEqual(["assignment.status_changed", "assignment.completed"]);
    expect((events[1] as { data: { completionTrigger: string; previousStatus: string } }).data).toEqual({
      previousStatus: "doing",
      completionTrigger: "progress",
    });
  });

  it("completed → doing：status_changed + reopened", () => {
    const events = deriveAssignmentTransitionEvents({
      before: mkA({ status: "completed", progress: 100 }),
      after: mkA({ status: "doing", progress: 50 }),
      context: CTX,
      completionTrigger: "status",
      environment: ENV,
    });
    expect(typesOf(events)).toEqual(["assignment.status_changed", "assignment.reopened"]);
    expect((events[1] as { data: { from: string; to: string } }).data).toEqual({
      from: "completed",
      to: "doing",
    });
  });

  it("DDL / estimate / priority 变化分别记录", () => {
    const events = deriveAssignmentTransitionEvents({
      before: mkA({ ddl: "2026-08-20T10:00:00", estimatedMinutes: 60, priority: "medium" }),
      after: mkA({ ddl: "2026-08-21T10:00:00", estimatedMinutes: 90, priority: "high" }),
      context: CTX,
      completionTrigger: "update",
      environment: ENV,
    });
    expect(typesOf(events)).toEqual([
      "assignment.deadline_changed",
      "assignment.estimate_changed",
      "assignment.priority_changed",
    ]);
  });

  it("progress 变化但状态不变 → 无历史；完全 no-op → 0 events", () => {
    const noStatus = deriveAssignmentTransitionEvents({
      before: mkA({ status: "doing", progress: 30 }),
      after: mkA({ status: "doing", progress: 40 }),
      context: CTX,
      completionTrigger: "progress",
      environment: ENV,
    });
    expect(noStatus).toHaveLength(0);
    const noop = deriveAssignmentTransitionEvents({
      before: mkA({ status: "doing", priority: "high", ddl: "2026-08-20T10:00:00", estimatedMinutes: 60 }),
      after: mkA({ status: "doing", priority: "high", ddl: "2026-08-20T10:00:00", estimatedMinutes: 60 }),
      context: CTX,
      completionTrigger: "update",
      environment: ENV,
    });
    expect(noop).toHaveLength(0);
  });
});

const KEY = "classflow-storage-v2";

function seedState() {
  const state = {
    userProfile: { name: "测试", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
    semester: { id: "s", name: "测试学期", startDate: "2026-08-10", totalWeeks: 16 },
    courses: [{ id: "c1", name: "统计学", code: "STAT101", teacher: "", classroom: "", credit: 3, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [] }],
    schedules: [],
    assignments: [],
    calendarMarks: [],
    groupProjects: [],
    studyBlocks: [],
    assignmentTimeSlice: "all",
    preferences: {
      showWeekends: true, ddlWarningDays: 3, defaultDDLTime: "23:59",
      enableScheduleDirectManipulation: true, enableDDLDirectManipulation: true, motionPreference: "system",
      startupView: "overview", defaultTaskPriority: "medium", defaultTaskStatus: "todo",
      enableSingleKeyShortcuts: true, contentDensity: "comfortable",
      defaultTaskWorkspaceView: "focus", defaultDeadlineReminderMinutes: 1440,
    },
    reminders: [],
    focusSessions: [],
  };
  localStorage.setItem(KEY, JSON.stringify({ version: 6, state }));
}

async function freshStore() {
  vi.resetModules();
  const mod = await import("@/store/useAppStore");
  return mod.useAppStore;
}

describe("Store Integration（真实 store → IndexedDB）", () => {
  it("addAssignment → assignment.created source=manual", async () => {
    seedState();
    const store = await freshStore();
    store.getState().addAssignment({
      courseId: "c1", title: "新任务", description: "", priority: "medium", status: "todo", progress: 0, tags: [],
    });
    await (await import("@/lib/history/recorder")).flushLearningHistoryQueue();
    expect(await countLearningHistoryEvents()).toBe(1);
    const { getLearningHistoryEvent } = await import("@/lib/history/store");
    // 通过 count 验证后按 occurredAt 查询第一条
    const db = await import("@/lib/history/store").then((m) => m.openLearningHistoryDB());
    const events = await new Promise<{ source: string; type: string }[]>((resolve, reject) => {
      const tx = db.transaction("events", "readonly");
      const req = tx.objectStore("events").index("occurredAt").getAll();
      req.onsuccess = () => resolve(req.result as { source: string; type: string }[]);
      req.onerror = () => reject(req.error);
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("assignment.created");
    expect(events[0].source).toBe("manual");
  });

  it("Kiro integration：executeKiroWriteTool 创建任务 → source=kiro", async () => {
    seedState();
    const store = await freshStore();
    const undos = new Map<string, () => void>();
    const kiro = { source: "kiro" as const };
    const api = {
      getState: () => store.getState(),
      addAssignment: (a: Omit<Assignment, "id">) => store.getState().addAssignment(a, kiro),
      updateAssignment: (a: Assignment) => store.getState().updateAssignment(a, kiro),
      registerUndo: (id: string, undo: () => void) => undos.set(id, undo),
    } as unknown as Parameters<typeof executeKiroWriteTool>[2];
    executeKiroWriteTool(
      "create_assignment",
      { courseId: "c1", title: "Kiro 创建任务", priority: "medium", status: "todo", description: "" },
      api,
      "tc1"
    );
    await (await import("@/lib/history/recorder")).flushLearningHistoryQueue();
    const db = await import("@/lib/history/store").then((m) => m.openLearningHistoryDB());
    const events = await new Promise<{ source: string; type: string }[]>((resolve, reject) => {
      const tx = db.transaction("events", "readonly");
      const req = tx.objectStore("events").index("occurredAt").getAll();
      req.onsuccess = () => resolve(req.result as { source: string; type: string }[]);
      req.onerror = () => reject(req.error);
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("assignment.created");
    expect(events[0].source).toBe("kiro");
  });
});
