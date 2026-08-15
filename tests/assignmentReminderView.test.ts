import { describe, it, expect } from "vitest";
import { Assignment, Reminder } from "@/types";
import {
  ASSIGNMENT_REMINDER_PRESETS,
  formatAssignmentReminderLabel,
  getAssignmentPresetAvailability,
  getAssignmentScheduledReminders,
  hasAssignmentReminderDuplicate,
} from "@/lib/reminders/assignmentReminderView";

const NOW = "2026-08-10T12:00:00";

function mkAssignment(patch: Partial<Assignment>): Assignment {
  return {
    id: "a1",
    courseId: "c1",
    title: "周作业",
    description: "",
    priority: "medium",
    status: "todo",
    progress: 0,
    tags: [],
    ...patch,
  };
}

function mkReminder(id: string, patch: Partial<Reminder>): Reminder {
  return {
    id,
    title: "周作业",
    targetType: "assignment",
    targetId: "a1",
    timingMode: "relative",
    offsetMinutes: -60,
    triggerAt: "2026-08-15T22:00:00",
    status: "scheduled",
    source: "manual",
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

describe("ASSIGNMENT_REMINDER_PRESETS", () => {
  it("1. 固定四个 preset offsets：[0, -10, -60, -1440]", () => {
    expect(ASSIGNMENT_REMINDER_PRESETS.map((p) => p.offsetMinutes)).toEqual([0, -10, -60, -1440]);
  });
});

describe("getAssignmentPresetAvailability", () => {
  it("2. Assignment 无 DDL → 四个 relative 全 disabled（reason no-ddl）", () => {
    const result = getAssignmentPresetAvailability(mkAssignment({}), [], NOW);
    expect(result.every((r) => r.available === false && r.reason === "no-ddl")).toBe(true);
  });

  it("3. DDL 距现在 30 分钟 → 提前 1 小时 disabled（past）；到期时 enabled", () => {
    const assignment = mkAssignment({ ddl: "2026-08-10T12:30:00" });
    const result = getAssignmentPresetAvailability(assignment, [], NOW);
    const byOffset = Object.fromEntries(result.map((r) => [r.offsetMinutes, r]));
    expect(byOffset[-60].available).toBe(false);
    expect(byOffset[-60].reason).toBe("past");
    expect(byOffset[0].available).toBe(true);
  });

  it("4. 已有 relative -60 → duplicate true（该 preset disabled）", () => {
    const reminders = [mkReminder("r1", { offsetMinutes: -60 })];
    const assignment = mkAssignment({ ddl: "2026-08-15T23:00:00" });
    const result = getAssignmentPresetAvailability(assignment, reminders, NOW);
    const byOffset = Object.fromEntries(result.map((r) => [r.offsetMinutes, r]));
    expect(byOffset[-60].available).toBe(false);
    expect(byOffset[-60].reason).toBe("duplicate");
    expect(byOffset[-10].available).toBe(true);
  });

  it("6. 编辑时 exclude 当前 id → 不视为 duplicate", () => {
    const reminders = [mkReminder("r1", { offsetMinutes: -60 })];
    const assignment = mkAssignment({ ddl: "2026-08-15T23:00:00" });
    const result = getAssignmentPresetAvailability(assignment, reminders, NOW, "r1");
    const byOffset = Object.fromEntries(result.map((r) => [r.offsetMinutes, r]));
    expect(byOffset[-60].available).toBe(true);
  });
});

describe("hasAssignmentReminderDuplicate", () => {
  it("5. 已有 absolute 20:00 → 相同 triggerAt duplicate true；不同时间 false", () => {
    const reminders = [mkReminder("r1", { timingMode: "absolute", offsetMinutes: undefined, triggerAt: "2026-08-15T20:00:00" })];
    expect(
      hasAssignmentReminderDuplicate(reminders, "a1", { timingMode: "absolute", triggerAt: "2026-08-15T20:00:00" })
    ).toBe(true);
    expect(
      hasAssignmentReminderDuplicate(reminders, "a1", { timingMode: "absolute", triggerAt: "2026-08-15T21:00:00" })
    ).toBe(false);
  });

  it("P3 fix 1：relative 与 absolute 最终 triggerAt 相同 → 视为重复（同实际通知时刻）", () => {
    // relative -60 的 triggerAt（最终时刻）22:00；absolute 同时刻 → duplicate
    const reminders = [mkReminder("r1", { timingMode: "relative", offsetMinutes: -60, triggerAt: "2026-08-15T22:00:00" })];
    expect(
      hasAssignmentReminderDuplicate(reminders, "a1", { timingMode: "absolute", triggerAt: "2026-08-15T22:00:00" })
    ).toBe(true);
    // 不同最终时刻 → 不重复
    expect(
      hasAssignmentReminderDuplicate(reminders, "a1", { timingMode: "absolute", triggerAt: "2026-08-15T23:00:00" })
    ).toBe(false);
  });

  it("P3 fix 1：relative vs relative：anchor+offset 解析后的最终时刻相同 → 重复", () => {
    const reminders = [mkReminder("r1", { timingMode: "relative", offsetMinutes: 0, triggerAt: "2026-08-15T22:00:00" })];
    // schedule：anchor 23:00 + offset -60 → 最终 22:00，与 r1 的 22:00 相同
    expect(
      hasAssignmentReminderDuplicate(reminders, "a1", { timingMode: "relative", offsetMinutes: -60, triggerAt: "2026-08-15T23:00:00" })
    ).toBe(true);
  });
});

describe("getAssignmentScheduledReminders", () => {
  it("7. 只返回当前 Assignment 的 scheduled Reminder，按 triggerAt 升序", () => {
    const reminders = [
      mkReminder("late", { offsetMinutes: -10, triggerAt: "2026-08-15T22:50:00" }),
      mkReminder("other", { targetId: "a2", triggerAt: "2026-08-15T10:00:00" }),
      mkReminder("fired", { status: "fired", firedAt: NOW, triggerAt: "2026-08-15T09:00:00" }),
      mkReminder("early", { offsetMinutes: -1440, triggerAt: "2026-08-14T23:00:00" }),
    ];
    expect(getAssignmentScheduledReminders(reminders, "a1").map((r) => r.id)).toEqual(["early", "late"]);
  });
});

describe("formatAssignmentReminderLabel", () => {
  it("8. relative -60 → 提前 1 小时；absolute → 自定义时间；其他 offset 优雅 fallback", () => {
    expect(formatAssignmentReminderLabel(mkReminder("a", { offsetMinutes: 0 }))).toBe("到期时");
    expect(formatAssignmentReminderLabel(mkReminder("b", { offsetMinutes: -60 }))).toBe("提前 1 小时");
    expect(formatAssignmentReminderLabel(mkReminder("c", { offsetMinutes: -1440 }))).toBe("提前 1 天");
    expect(formatAssignmentReminderLabel(mkReminder("d", { offsetMinutes: -120 }))).toBe("提前 2 小时");
    expect(
      formatAssignmentReminderLabel(mkReminder("e", { timingMode: "absolute", offsetMinutes: undefined, triggerAt: "2026-08-15T20:00:00" }))
    ).toBe("自定义时间");
  });
});
