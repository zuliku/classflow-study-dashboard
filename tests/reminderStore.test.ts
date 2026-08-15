import { describe, it, expect, vi, beforeEach } from "vitest";
import { Assignment, Reminder } from "@/types";

/**
 * Task 7G-A1：Reminder Store 关键链路（真实 Store，seed localStorage）。
 */

const KEY = "classflow-storage-v2";

function seedState(extra?: { reminders?: unknown[]; assignments?: unknown[] }) {
  const state = {
    userProfile: { name: "测试", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
    semester: { id: "s", name: "测试学期", startDate: "2026-01-01", totalWeeks: 16 },
    courses: [{ id: "c1", name: "统计学", code: "STAT", teacher: "", classroom: "", credit: 3, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [] }],
    schedules: [],
    assignments: extra?.assignments ?? [
      // ddl 用过去时间：避免 P2 hydrate backfill 依赖真实时钟生成 auto（保持断言确定）
      { id: "a1", courseId: "c1", title: "周作业", description: "", ddl: "2020-08-15T23:00:00", priority: "medium", status: "todo", progress: 0, tags: [], recurrence: "weekly", recurrenceSeriesId: "rs_1" },
    ],
    calendarMarks: [{ id: "cm1", date: "2020-08-15", type: "ddl", title: "周作业", sourceId: "a1" }],
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

async function freshStore() {
  vi.resetModules();
  const mod = await import("@/store/useAppStore");
  return mod.useAppStore;
}

const mkInput = (patch: Partial<Omit<Reminder, "id" | "status" | "firedAt" | "readAt" | "createdAt" | "updatedAt">>) => ({
  title: "提前提醒",
  targetType: "assignment" as const,
  targetId: "a1",
  timingMode: "relative" as const,
  offsetMinutes: -60,
  triggerAt: "",
  source: "manual" as const,
  ...patch,
});

beforeEach(() => {
  localStorage.clear();
});

describe("Reminder Store 关键链路", () => {
  it("1. addReminder（relative）→ 按当前 DDL 解析 triggerAt 并进入 reminders（持久化）", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addReminder(mkInput({}));
    expect(id).toBeTruthy();
    const r = store.getState().reminders.find((x: Reminder) => x.id === id)!;
    expect(r.triggerAt).toBe("2020-08-15T22:00:00");
    expect(r.status).toBe("scheduled");
    expect(JSON.parse(localStorage.getItem(KEY)!).state.reminders).toHaveLength(1);
  });

  it("2. DDL 修改 → relative 跟随；absolute 不变", async () => {
    seedState();
    const store = await freshStore();
    store.getState().addReminder(mkInput({})); // relative -60
    store.getState().addReminder(mkInput({ timingMode: "absolute", offsetMinutes: undefined, triggerAt: "2026-08-20T09:30:00" }));

    const a = store.getState().assignments.find((x: Assignment) => x.id === "a1")!;
    store.getState().updateAssignment({ ...a, ddl: "2026-08-18T20:00:00" });

    const reminders = store.getState().reminders;
    // P2：DDL 变化 → 只精确匹配 manual relative（auto 会被按默认重建，不参与本断言）
    expect(reminders.find((r: Reminder) => r.timingMode === "relative" && r.source === "manual")!.triggerAt).toBe("2026-08-18T19:00:00");
    expect(reminders.find((r: Reminder) => r.timingMode === "absolute")!.triggerAt).toBe("2026-08-20T09:30:00");
  });

  it("3. 删除 target → 关联 Reminder 一并删除（无 orphan）", async () => {
    seedState();
    const store = await freshStore();
    store.getState().addReminder(mkInput({}));
    store.getState().addReminder(mkInput({ targetType: "standalone", targetId: undefined, timingMode: "absolute", offsetMinutes: undefined, triggerAt: "2026-08-20T09:00:00" }));
    store.getState().deleteAssignment("a1");
    const reminders = store.getState().reminders;
    expect(reminders.filter((r: Reminder) => r.targetType === "assignment")).toHaveLength(0);
    expect(reminders.filter((r: Reminder) => r.targetType === "standalone")).toHaveLength(1);
  });

  it("4. 旧 persisted data 无 reminders → hydrate []", async () => {
    seedState({ reminders: undefined });
    const store = await freshStore();
    expect(store.getState().reminders).toEqual([]);
  });

  it("5. Assignment completed → scheduled reminders 清除；fired 历史保留", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addReminder(mkInput({}))!;
    store.getState().markReminderFired(id, "2026-08-15T22:00:00");
    store.getState().addReminder(mkInput({ offsetMinutes: 0 })); // 第二个 scheduled

    store.getState().updateAssignmentStatus("a1", "completed");

    const reminders = store.getState().reminders;
    expect(reminders.filter((r: Reminder) => r.status === "scheduled")).toHaveLength(0);
    expect(reminders.filter((r: Reminder) => r.status === "fired")).toHaveLength(1);
  });

  it("5b. relative 创建时 target 无合法 anchor → 创建失败（不 fallback absolute）", async () => {
    seedState({ assignments: [{ id: "a1", courseId: "c1", title: "无DDL", description: "", priority: "medium", status: "todo", progress: 0, tags: [] }] });
    const store = await freshStore();
    const id = store.getState().addReminder(mkInput({}));
    expect(id).toBeNull();
    expect(store.getState().reminders).toHaveLength(0);
  });

  it("6. reconcileTargetReminders：DDL 删除 → scheduled relative 移除，absolute 保留", async () => {
    seedState();
    const store = await freshStore();
    store.getState().addReminder(mkInput({}));
    store.getState().addReminder(mkInput({ timingMode: "absolute", offsetMinutes: undefined, triggerAt: "2026-08-20T09:30:00" }));
    const a = store.getState().assignments.find((x: Assignment) => x.id === "a1")!;
    store.getState().updateAssignment({ ...a, ddl: undefined });
    const reminders = store.getState().reminders;
    expect(reminders.filter((r: Reminder) => r.timingMode === "relative")).toHaveLength(0);
    expect(reminders.filter((r: Reminder) => r.timingMode === "absolute")).toHaveLength(1);
  });
});
