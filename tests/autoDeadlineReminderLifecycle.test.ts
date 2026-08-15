import { describe, it, expect, vi, beforeEach } from "vitest";
import { Assignment, CalendarMark, Reminder } from "@/types";

/**
 * P2：Automatic Deadline Reminder Lifecycle + Persistence（真实 Store）。
 * 覆盖 spec §4-§23 的核心不变量：创建/修改/删除 DDL、状态切换、重复任务、
 * 独立 CalendarMark、linked mark 防重复、manual 并存/suppression、opt-out/custom、
 * global preference 重算、fired/skipped immutable、hydrate/backfill/restore 幂等。
 */

const KEY = "classflow-storage-v2";

/** 相对 today 的天偏移（本地墙钟） */
function dayOffset(offset: number, hour = 10, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(hour, minute, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

/** 距 now 指定分钟数的本地墙钟（用于「接近 DDL」场景） */
function minutesFromNow(minutes: number): string {
  const d = new Date(Date.now() + minutes * 60000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fullPreferences(patch: Record<string, unknown> = {}) {
  return {
    showWeekends: true,
    ddlWarningDays: 3,
    defaultDDLTime: "23:59",
    enableScheduleDirectManipulation: true,
    enableDDLDirectManipulation: true,
    motionPreference: "system",
    startupView: "overview",
    defaultTaskPriority: "medium",
    defaultTaskStatus: "todo",
    enableSingleKeyShortcuts: true,
    contentDensity: "comfortable",
    defaultTaskWorkspaceView: "focus",
    defaultDeadlineReminderMinutes: 1440,
    ...patch,
  };
}

function seedState(extra?: {
  assignments?: unknown[];
  calendarMarks?: unknown[];
  reminders?: unknown[];
  preferences?: unknown;
}) {
  const state = {
    userProfile: { name: "测试", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
    semester: { id: "s", name: "测试学期", startDate: "2026-01-01", totalWeeks: 16 },
    courses: [{ id: "c1", name: "统计学", code: "STAT", teacher: "", classroom: "", credit: 3, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [] }],
    schedules: [],
    assignments: extra?.assignments ?? [],
    calendarMarks: extra?.calendarMarks ?? [],
    groupProjects: [],
    studyBlocks: [],
    assignmentTimeSlice: "all",
    preferences: fullPreferences(extra?.preferences as Record<string, unknown> | undefined),
    reminders: extra?.reminders ?? [],
  };
  localStorage.setItem(KEY, JSON.stringify({ version: 6, state }));
}

async function freshStore() {
  vi.resetModules();
  const mod = await import("@/store/useAppStore");
  return mod.useAppStore;
}

function mkAssignment(patch: Partial<Assignment>): Omit<Assignment, "id"> {
  return {
    courseId: "c1",
    title: "自动提醒测试任务",
    description: "",
    priority: "medium",
    status: "todo",
    progress: 0,
    tags: [],
    ...patch,
  } as Omit<Assignment, "id">;
}

function scheduledAutos(reminders: Reminder[], targetType: string, targetId: string): Reminder[] {
  return reminders.filter(
    (r) => r.targetType === targetType && r.targetId === targetId && r.source === "auto" && r.status === "scheduled"
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe("Assignment 自动提醒生命周期", () => {
  it("1. addAssignment 未来 DDL → 恰好 1 条 auto（linked mark 不产生第二条）", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: dayOffset(5) }));
    const reminders = store.getState().reminders;
    const autos = scheduledAutos(reminders, "assignment", id);
    expect(autos).toHaveLength(1);
    expect(autos[0].source).toBe("auto");
    expect(autos[0].timingMode).toBe("relative");
    expect(autos[0].offsetMinutes).toBe(-1440);
    expect(autos[0].triggerAt).toBe(dayOffset(4, 10, 0));
    // linked CalendarMark 存在但不产生第二条 auto（calendarMark target 无 auto）
    expect(scheduledAutos(reminders, "calendarMark", store.getState().calendarMarks[0].id)).toHaveLength(0);
    // 全仓只有 1 条 auto
    expect(reminders.filter((r) => r.source === "auto" && r.status === "scheduled")).toHaveLength(1);
  });

  it("2. addAssignment 无 DDL → 无 auto", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({}));
    expect(scheduledAutos(store.getState().reminders, "assignment", id)).toHaveLength(0);
  });

  it("3. addAssignment 过去 DDL → 无 auto", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: dayOffset(-1) }));
    expect(scheduledAutos(store.getState().reminders, "assignment", id)).toHaveLength(0);
  });

  it("4. addAssignment 接近 DDL（剩 3 小时）→ 降级为 1 小时", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: minutesFromNow(180) }));
    const autos = scheduledAutos(store.getState().reminders, "assignment", id);
    expect(autos).toHaveLength(1);
    expect(autos[0].offsetMinutes).toBe(-60);
  });

  it("6. DDL 从无 → 有 → 生成 auto", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({}));
    expect(scheduledAutos(store.getState().reminders, "assignment", id)).toHaveLength(0);
    const a = store.getState().assignments.find((x: Assignment) => x.id === id)!;
    store.getState().updateAssignment({ ...a, ddl: dayOffset(5) });
    expect(scheduledAutos(store.getState().reminders, "assignment", id)).toHaveLength(1);
  });

  it("7. DDL 延后 → auto 按全局默认重新计算（不机械保持降级 offset）", async () => {
    seedState();
    const store = await freshStore();
    // 接近 DDL（剩 3 小时）→ 降级 1h
    const id = store.getState().addAssignment(mkAssignment({ ddl: minutesFromNow(180) }));
    expect(scheduledAutos(store.getState().reminders, "assignment", id)[0].offsetMinutes).toBe(-60);
    // 延后 10 天 → 恢复默认 1d
    const a = store.getState().assignments.find((x: Assignment) => x.id === id)!;
    store.getState().updateAssignment({ ...a, ddl: dayOffset(10) });
    const autos = scheduledAutos(store.getState().reminders, "assignment", id);
    expect(autos).toHaveLength(1);
    expect(autos[0].offsetMinutes).toBe(-1440);
  });

  it("8. DDL 删除 → scheduled auto 移除；历史保留", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: dayOffset(5) }));
    const auto = scheduledAutos(store.getState().reminders, "assignment", id)[0];
    store.getState().markReminderFired(auto.id, auto.triggerAt); // 制造一条历史
    store.getState().updateAssignment({ ...store.getState().assignments.find((x: Assignment) => x.id === id)!, ddl: dayOffset(8) });
    const auto2 = scheduledAutos(store.getState().reminders, "assignment", id)[0];
    store.getState().updateAssignment({ ...store.getState().assignments.find((x: Assignment) => x.id === id)!, ddl: undefined });
    expect(scheduledAutos(store.getState().reminders, "assignment", id)).toHaveLength(0);
    // fired 历史保留
    expect(store.getState().reminders.filter((r: Reminder) => r.source === "auto" && r.status === "fired")).toHaveLength(1);
    expect(store.getState().reminders.some((r: Reminder) => r.id === auto2.id)).toBe(false);
  });

  it("9. opted-out Assignment：DDL 修改不生成 auto", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: dayOffset(5) }));
    // 用户删除 auto → opt-out
    const auto = scheduledAutos(store.getState().reminders, "assignment", id)[0];
    store.getState().deleteReminderByUser(auto.id);
    expect(store.getState().assignments.find((x: Assignment) => x.id === id)!.autoReminderDisabled).toBe(true);
    // DDL 变化 → 不重建
    const a = store.getState().assignments.find((x: Assignment) => x.id === id)!;
    store.getState().updateAssignment({ ...a, ddl: dayOffset(10) });
    expect(scheduledAutos(store.getState().reminders, "assignment", id)).toHaveLength(0);
  });

  it("10. todo/doing → submitted：scheduled auto 移除", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: dayOffset(5) }));
    expect(scheduledAutos(store.getState().reminders, "assignment", id)).toHaveLength(1);
    store.getState().updateAssignmentStatus(id, "submitted");
    expect(scheduledAutos(store.getState().reminders, "assignment", id)).toHaveLength(0);
  });

  it("11. submitted → todo（eligible）→ 按当前默认重建", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: dayOffset(5) }));
    store.getState().updateAssignmentStatus(id, "submitted");
    expect(scheduledAutos(store.getState().reminders, "assignment", id)).toHaveLength(0);
    store.getState().updateAssignmentStatus(id, "todo");
    const autos = scheduledAutos(store.getState().reminders, "assignment", id);
    expect(autos).toHaveLength(1);
    expect(autos[0].offsetMinutes).toBe(-1440);
  });

  it("12. submitted → todo 不 rebuild（opt-out）", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: dayOffset(5), autoReminderDisabled: true }));
    expect(scheduledAutos(store.getState().reminders, "assignment", id)).toHaveLength(0);
    store.getState().updateAssignmentStatus(id, "submitted");
    store.getState().updateAssignmentStatus(id, "todo");
    expect(scheduledAutos(store.getState().reminders, "assignment", id)).toHaveLength(0);
  });

  it("13. completed：保留既有 manual semantics（scheduled 全清，fired 保留）", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: dayOffset(5) }));
    const manualId = store.getState().addReminder({
      title: "手动提醒",
      targetType: "assignment",
      targetId: id,
      timingMode: "relative",
      offsetMinutes: -60,
      triggerAt: "",
      source: "manual",
    })!;
    store.getState().markReminderFired(manualId, dayOffset(5, 9, 0));
    store.getState().updateAssignmentStatus(id, "completed");
    const reminders = store.getState().reminders.filter((r: Reminder) => r.targetType === "assignment" && r.targetId === id);
    expect(reminders.filter((r: Reminder) => r.status === "scheduled")).toHaveLength(0);
    expect(reminders.filter((r: Reminder) => r.status === "fired")).toHaveLength(1);
  });

  it("14. recurring child 获得自己的 auto（一次）", async () => {
    seedState();
    const store = await freshStore();
    const parentId = store.getState().addAssignment(
      mkAssignment({ ddl: dayOffset(5), recurrence: "weekly", recurrenceSeriesId: "rs1" })
    );
    store.getState().updateAssignmentStatus(parentId, "completed");
    const child = store.getState().assignments.find((a: Assignment) => a.recurrenceParentId === parentId)!;
    expect(child).toBeTruthy();
    expect(child.ddl).toBeTruthy();
    const autos = scheduledAutos(store.getState().reminders, "assignment", child.id);
    expect(autos).toHaveLength(1);
    // 幂等：再次 reconcile（如 reload 语义）不增加
    store.getState().setDefaultDeadlineReminderMinutes(1440);
    expect(scheduledAutos(store.getState().reminders, "assignment", child.id)).toHaveLength(1);
  });
});

describe("独立 CalendarMark 自动提醒", () => {
  it("15. addCalendarMark 独立 ddl → auto", async () => {
    seedState();
    const store = await freshStore();
    const markId = store.getState().addCalendarMark({
      date: dayOffset(5).slice(0, 10),
      type: "ddl",
      title: "交报告",
    });
    const autos = scheduledAutos(store.getState().reminders, "calendarMark", markId);
    expect(autos).toHaveLength(1);
    expect(autos[0].offsetMinutes).toBe(-1440);
  });

  it("16. 无 startTime 的独立 ddl mark 使用 defaultDDLTime（23:59）且不 mutate mark", async () => {
    seedState();
    const store = await freshStore();
    const markId = store.getState().addCalendarMark({
      date: dayOffset(5).slice(0, 10),
      type: "ddl",
      title: "交报告",
    });
    const autos = scheduledAutos(store.getState().reminders, "calendarMark", markId);
    expect(autos[0].triggerAt).toBe(dayOffset(4, 23, 59));
    const mark = store.getState().calendarMarks.find((m: CalendarMark) => m.id === markId)!;
    expect(mark.startTime).toBeUndefined();
  });

  it("17. linked mark（sourceId=assignment.id）→ 不产生 auto", async () => {
    seedState({
      assignments: [{ id: "a1", courseId: "c1", title: "任务", description: "", ddl: dayOffset(5), priority: "medium", status: "todo", progress: 0, tags: [] }],
      calendarMarks: [{ id: "cm1", date: dayOffset(5).slice(0, 10), type: "ddl", title: "任务", sourceId: "a1" }],
    });
    const store = await freshStore();
    expect(scheduledAutos(store.getState().reminders, "calendarMark", "cm1")).toHaveLength(0);
    expect(scheduledAutos(store.getState().reminders, "assignment", "a1")).toHaveLength(1);
  });

  it("18. 日期/时间修改 → 重新计算（updateCalendarMark 不存在 → 通过全量 reconcile 保证）", async () => {
    seedState();
    const store = await freshStore();
    const markId = store.getState().addCalendarMark({
      date: dayOffset(5).slice(0, 10),
      type: "ddl",
      title: "交报告",
      startTime: "10:00",
    });
    const first = scheduledAutos(store.getState().reminders, "calendarMark", markId)[0];
    expect(first.triggerAt).toBe(dayOffset(4, 10, 0));
    // 模拟「date 修改」后的全量 reconcile（P2 无独立 mutation；hydrate 语义相同）
    const mark = store.getState().calendarMarks.find((m: CalendarMark) => m.id === markId)!;
    const moved = { ...mark, date: dayOffset(8).slice(0, 10) };
        seedState({
      calendarMarks: [moved],
      assignments: store.getState().assignments,
      reminders: store.getState().reminders,
      preferences: store.getState().preferences,
    });
            const store2 = await freshStore();
        const autos = scheduledAutos(store2.getState().reminders, "calendarMark", markId);
    expect(autos).toHaveLength(1);
    expect(autos[0].triggerAt).toBe(dayOffset(7, 10, 0));
  });

  it("19. type 非 ddl 的 mark → 无 auto", async () => {
    seedState();
    const store = await freshStore();
    const markId = store.getState().addCalendarMark({ date: dayOffset(5).slice(0, 10), type: "activity", title: "活动" });
    expect(scheduledAutos(store.getState().reminders, "calendarMark", markId)).toHaveLength(0);
  });

  it("21. 删除 target → scheduled auto 清理", async () => {
    seedState();
    const store = await freshStore();
    const markId = store.getState().addCalendarMark({ date: dayOffset(5).slice(0, 10), type: "ddl", title: "交报告" });
    expect(scheduledAutos(store.getState().reminders, "calendarMark", markId)).toHaveLength(1);
    store.getState().deleteCalendarMark(markId);
    expect(scheduledAutos(store.getState().reminders, "calendarMark", markId)).toHaveLength(0);
  });
});

describe("manual / Kiro coexist 与 suppression", () => {
  it("22. 不同 trigger 的 manual + auto 并存", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: dayOffset(5) }));
    const manualId = store.getState().addReminder({
      title: "手动提前 3 小时",
      targetType: "assignment",
      targetId: id,
      timingMode: "relative",
      offsetMinutes: -180,
      triggerAt: "",
      source: "manual",
    })!;
    expect(scheduledAutos(store.getState().reminders, "assignment", id)).toHaveLength(1);
    expect(store.getState().reminders.find((r: Reminder) => r.id === manualId)).toBeTruthy();
  });

  it("23. 相同 trigger 的 manual 抑制 auto 创建（创建时已存在 manual）", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: dayOffset(5) }));
    // 先手动建一条与默认 auto 相同 trigger 的 manual（同 triggerAt）
    store.getState().addReminder({
      title: "手动 1 天",
      targetType: "assignment",
      targetId: id,
      timingMode: "relative",
      offsetMinutes: -1440,
      triggerAt: "",
      source: "manual",
    });
    // 触发一次全量 reconcile（等价于任何 mutation 后的统一入口）
    store.getState().setDefaultDeadlineReminderMinutes(1440);
    expect(scheduledAutos(store.getState().reminders, "assignment", id)).toHaveLength(0);
    // 不设置 opt-out
    expect(store.getState().assignments.find((a: Assignment) => a.id === id)!.autoReminderDisabled).toBeUndefined();
  });

  it("24. 已存在 auto 后新增同 trigger manual → reconcile 后移除 auto（只保留非 auto）", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: dayOffset(5) }));
    expect(scheduledAutos(store.getState().reminders, "assignment", id)).toHaveLength(1);
    store.getState().addReminder({
      title: "手动同点",
      targetType: "assignment",
      targetId: id,
      timingMode: "relative",
      offsetMinutes: -1440,
      triggerAt: "",
      source: "manual",
    });
    store.getState().setDefaultDeadlineReminderMinutes(1440); // 触发 reconcile
    expect(scheduledAutos(store.getState().reminders, "assignment", id)).toHaveLength(0);
    const nonAuto = store.getState().reminders.filter(
      (r: Reminder) => r.targetType === "assignment" && r.targetId === id && r.source === "manual" && r.status === "scheduled"
    );
    expect(nonAuto).toHaveLength(1);
    expect(store.getState().assignments.find((a: Assignment) => a.id === id)!.autoReminderDisabled).toBeUndefined();
  });

  it("25. 删除同 trigger manual（未 opt-out）→ 后续 reconcile 恢复 auto", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: dayOffset(5) }));
    const manualId = store.getState().addReminder({
      title: "手动同点",
      targetType: "assignment",
      targetId: id,
      timingMode: "relative",
      offsetMinutes: -1440,
      triggerAt: "",
      source: "manual",
    })!;
    store.getState().setDefaultDeadlineReminderMinutes(1440);
    expect(scheduledAutos(store.getState().reminders, "assignment", id)).toHaveLength(0);
    store.getState().deleteReminder(manualId); // 内部删除（或用户删除 manual 无 opt-out 影响）
    store.getState().setDefaultDeadlineReminderMinutes(1440);
    expect(scheduledAutos(store.getState().reminders, "assignment", id)).toHaveLength(1);
  });
});

describe("opt-out / custom / re-enable", () => {
  it("26. 用户删除 auto → opt-out（autoReminderDisabled=true）+ 无 scheduled auto", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: dayOffset(5) }));
    const auto = scheduledAutos(store.getState().reminders, "assignment", id)[0];
    store.getState().deleteReminderByUser(auto.id);
    expect(store.getState().assignments.find((a: Assignment) => a.id === id)!.autoReminderDisabled).toBe(true);
    expect(scheduledAutos(store.getState().reminders, "assignment", id)).toHaveLength(0);
  });

  it("27. DDL 修改后仍不重建（opt-out 持久）", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: dayOffset(5) }));
    const auto = scheduledAutos(store.getState().reminders, "assignment", id)[0];
    store.getState().deleteReminderByUser(auto.id);
    const a = store.getState().assignments.find((x: Assignment) => x.id === id)!;
    store.getState().updateAssignment({ ...a, ddl: dayOffset(9) });
    expect(scheduledAutos(store.getState().reminders, "assignment", id)).toHaveLength(0);
  });

  it("28. global preference 修改后仍不重建（opt-out）", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: dayOffset(5) }));
    const auto = scheduledAutos(store.getState().reminders, "assignment", id)[0];
    store.getState().deleteReminderByUser(auto.id);
    store.getState().setDefaultDeadlineReminderMinutes(4320);
    expect(scheduledAutos(store.getState().reminders, "assignment", id)).toHaveLength(0);
  });

  it("29. 显式 re-enable → 按当前 policy 重新生成（不恢复旧 snapshot）", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: dayOffset(5) }));
    const auto = scheduledAutos(store.getState().reminders, "assignment", id)[0];
    store.getState().deleteReminderByUser(auto.id);
    // 期间 DDL 变化
    const a = store.getState().assignments.find((x: Assignment) => x.id === id)!;
    store.getState().updateAssignment({ ...a, ddl: dayOffset(8) });
    store.getState().enableAutomaticReminderForTarget("assignment", id);
    expect(store.getState().assignments.find((x: Assignment) => x.id === id)!.autoReminderDisabled).toBeUndefined();
    const autos = scheduledAutos(store.getState().reminders, "assignment", id);
    expect(autos).toHaveLength(1);
    expect(autos[0].triggerAt).toBe(dayOffset(7, 10, 0)); // 按新 DDL + 默认 1d
  });

  it("30. 用户编辑 auto → source=manual + target opt-out（同一 ID in place）", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: dayOffset(5) }));
    const auto = scheduledAutos(store.getState().reminders, "assignment", id)[0];
    store.getState().updateReminderByUser(auto.id, { offsetMinutes: -60, triggerAt: dayOffset(5, 9, 0) });
    const edited = store.getState().reminders.find((r: Reminder) => r.id === auto.id)!;
    expect(edited.source).toBe("manual");
    expect(edited.offsetMinutes).toBe(-60);
    expect(store.getState().assignments.find((a: Assignment) => a.id === id)!.autoReminderDisabled).toBe(true);
  });

  it("31. custom（manual）不受 global preference 修改影响", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: dayOffset(5) }));
    const manualId = store.getState().addReminder({
      title: "手动 3 小时",
      targetType: "assignment",
      targetId: id,
      timingMode: "relative",
      offsetMinutes: -180,
      triggerAt: "",
      source: "manual",
    })!;
    store.getState().setDefaultDeadlineReminderMinutes(4320);
    const manual = store.getState().reminders.find((r: Reminder) => r.id === manualId)!;
    expect(manual.offsetMinutes).toBe(-180);
    expect(manual.source).toBe("manual");
  });
});

describe("global preference 重算", () => {
  it("32. 1d → 3d：eligible 的 scheduled auto 移动", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: dayOffset(10) }));
    const before = scheduledAutos(store.getState().reminders, "assignment", id)[0];
    expect(before.offsetMinutes).toBe(-1440);
    store.getState().setDefaultDeadlineReminderMinutes(4320);
    const after = scheduledAutos(store.getState().reminders, "assignment", id);
    expect(after).toHaveLength(1);
    expect(after[0].offsetMinutes).toBe(-4320);
    expect(after[0].triggerAt).toBe(dayOffset(7, 10, 0));
    expect(store.getState().preferences.defaultDeadlineReminderMinutes).toBe(4320);
  });

  it("33. 只更新 source=auto（manual 不动）", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: dayOffset(10) }));
    const manualId = store.getState().addReminder({
      title: "手动 1 天",
      targetType: "assignment",
      targetId: id,
      timingMode: "relative",
      offsetMinutes: -1440,
      triggerAt: "",
      source: "manual",
    })!;
    store.getState().setDefaultDeadlineReminderMinutes(4320);
    const manual = store.getState().reminders.find((r: Reminder) => r.id === manualId)!;
    expect(manual.offsetMinutes).toBe(-1440);
  });

  it("34. fired/skipped 历史 immutable（preference 变化不动历史）", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: dayOffset(5) }));
    const auto = scheduledAutos(store.getState().reminders, "assignment", id)[0];
    const firedAt = auto.triggerAt;
    store.getState().markReminderFired(auto.id, firedAt);
    store.getState().setDefaultDeadlineReminderMinutes(4320);
    const fired = store.getState().reminders.find((r: Reminder) => r.id === auto.id)!;
    expect(fired.status).toBe("fired");
    expect(fired.triggerAt).toBe(firedAt);
    expect(fired.offsetMinutes).toBe(-1440);
  });

  it("35. 同 anchor 已 fired → preference 变化不重建（不重复提醒）；past due 不复活", async () => {
    seedState();
    const store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: dayOffset(5) }));
    const auto = scheduledAutos(store.getState().reminders, "assignment", id)[0];
    store.getState().markReminderFired(auto.id, auto.triggerAt);
    store.getState().setDefaultDeadlineReminderMinutes(4320);
    // 同 anchor 已处理 → 不再生成第二条
    expect(scheduledAutos(store.getState().reminders, "assignment", id)).toHaveLength(0);
  });

  it("非法 minutes → sanitize 回落 1440 并重算", async () => {
    seedState();
    const store = await freshStore();
    store.getState().setDefaultDeadlineReminderMinutes(999);
    expect(store.getState().preferences.defaultDeadlineReminderMinutes).toBe(1440);
  });
});

describe("persistence / hydrate / backup", () => {
  it("36. 旧 persisted state（无新字段）安全迁移：defaultDeadlineReminderMinutes=1440、无 auto", async () => {
    // version 5 旧格式（无 preferences.defaultDeadlineReminderMinutes / autoReminderDisabled）
    const legacy = {
      userProfile: { name: "旧", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
      semester: { id: "s", name: "旧学期", startDate: "2026-01-01", totalWeeks: 16 },
      courses: [{ id: "c1", name: "课", code: "C", teacher: "", classroom: "", credit: 3, bgHex: "#E3E6E0", borderHex: "#D0D5CC", textHex: "#313032", description: "", materials: [] }],
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
      },
    };
    localStorage.setItem(KEY, JSON.stringify({ version: 5, state: legacy }));
    const store = await freshStore();
    expect(store.getState().preferences.defaultDeadlineReminderMinutes).toBe(1440);
    expect(store.getState().reminders).toEqual([]);
  });

  it("37. 新 auto source 跨 reload 持久化", async () => {
    seedState();
    let store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: dayOffset(5) }));
    const auto = scheduledAutos(store.getState().reminders, "assignment", id)[0];
    store = await freshStore(); // reload
    const persisted = store.getState().reminders.find((r: Reminder) => r.id === auto.id);
    expect(persisted).toBeTruthy();
    expect(persisted!.source).toBe("auto");
  });

  it("38. opt-out 跨 reload 持久化", async () => {
    seedState();
    let store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: dayOffset(5) }));
    const auto = scheduledAutos(store.getState().reminders, "assignment", id)[0];
    store.getState().deleteReminderByUser(auto.id);
    store = await freshStore();
    expect(store.getState().assignments.find((a: Assignment) => a.id === id)!.autoReminderDisabled).toBe(true);
    expect(scheduledAutos(store.getState().reminders, "assignment", id)).toHaveLength(0);
  });

  it("39. preference 跨 reload 持久化", async () => {
    seedState();
    let store = await freshStore();
    store.getState().setDefaultDeadlineReminderMinutes(10080);
    store = await freshStore();
    expect(store.getState().preferences.defaultDeadlineReminderMinutes).toBe(10080);
  });

  it("40+41. backfill：已有未来 DDL 的 Assignment 与独立 DDL mark hydrate 即补 auto", async () => {
    seedState({
      assignments: [{ id: "a1", courseId: "c1", title: "旧任务", description: "", ddl: dayOffset(5), priority: "medium", status: "todo", progress: 0, tags: [] }],
      calendarMarks: [{ id: "cm1", date: dayOffset(6).slice(0, 10), type: "ddl", title: "独立 DDL" }],
    });
    const store = await freshStore();
    expect(scheduledAutos(store.getState().reminders, "assignment", "a1")).toHaveLength(1);
    expect(scheduledAutos(store.getState().reminders, "calendarMark", "cm1")).toHaveLength(1);
  });

  it("42. linked mark backfill 去重（只 1 条 assignment auto）", async () => {
    seedState({
      assignments: [{ id: "a1", courseId: "c1", title: "任务", description: "", ddl: dayOffset(5), priority: "medium", status: "todo", progress: 0, tags: [] }],
      calendarMarks: [{ id: "cm1", date: dayOffset(5).slice(0, 10), type: "ddl", title: "任务", sourceId: "a1" }],
    });
    const store = await freshStore();
    expect(store.getState().reminders.filter((r: Reminder) => r.source === "auto" && r.status === "scheduled")).toHaveLength(1);
  });

  it("43. migration/backfill 幂等：重复 hydrate 不增加 auto", async () => {
    seedState({
      assignments: [{ id: "a1", courseId: "c1", title: "任务", description: "", ddl: dayOffset(5), priority: "medium", status: "todo", progress: 0, tags: [] }],
    });
    let store = await freshStore();
    const count1 = store.getState().reminders.filter((r: Reminder) => r.source === "auto" && r.status === "scheduled").length;
    store = await freshStore();
    const count2 = store.getState().reminders.filter((r: Reminder) => r.source === "auto" && r.status === "scheduled").length;
    expect(count1).toBe(1);
    expect(count2).toBe(1);
  });

  it("44+45. 备份 round-trip：restore 保留 auto 语义 + 幂等 reconcile（不重复）", async () => {
    seedState();
    let store = await freshStore();
    const id = store.getState().addAssignment(mkAssignment({ ddl: dayOffset(5) }));
    const auto = scheduledAutos(store.getState().reminders, "assignment", id)[0];
    const backupData = {
      userProfile: store.getState().userProfile,
      semester: store.getState().semester,
      courses: store.getState().courses,
      schedules: store.getState().schedules,
      assignments: store.getState().assignments,
      calendarMarks: store.getState().calendarMarks,
      groupProjects: store.getState().groupProjects,
      studyBlocks: store.getState().studyBlocks,
      preferences: store.getState().preferences,
      reminders: store.getState().reminders,
      focusSessions: store.getState().focusSessions,
    };
    store = await freshStore();
    store.getState().restoreAppData(backupData);
    const restored = store.getState().reminders.find((r: Reminder) => r.id === auto.id);
    expect(restored).toBeTruthy();
    expect(restored!.source).toBe("auto");
    expect(scheduledAutos(store.getState().reminders, "assignment", id)).toHaveLength(1);
    // 再次 restore（重复导入）不重复
    store.getState().restoreAppData(backupData);
    expect(scheduledAutos(store.getState().reminders, "assignment", id)).toHaveLength(1);
  });
});
