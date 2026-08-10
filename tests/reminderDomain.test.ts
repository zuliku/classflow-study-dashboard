import { describe, it, expect } from "vitest";
import { Reminder } from "@/types";
import {
  evaluateMissedReminder,
  getReminderTargetAnchor,
  normalizeReminder,
  reconcileTargetReminders,
  resolveReminderTriggerAt,
} from "@/lib/reminders/reminderDomain";

const NOW = "2026-08-10T12:00:00";

function mkReminder(patch: Partial<Reminder>): Reminder {
  return {
    id: "r1",
    title: "提前提醒",
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

describe("resolveReminderTriggerAt", () => {
  it("1. Assignment relative -60：DDL 23:00 → 22:00", () => {
    expect(
      resolveReminderTriggerAt({ timingMode: "relative", triggerAt: "2026-08-15T23:00:00", offsetMinutes: -60 })
    ).toBe("2026-08-15T22:00:00");
  });

  it("2. DDL 改变 → relative 跟随新 anchor", () => {
    const reminders = [mkReminder({})];
    const out = reconcileTargetReminders(
      reminders,
      "assignment",
      "a1",
      "2026-08-18T20:00:00",
      NOW
    );
    expect(out[0].triggerAt).toBe("2026-08-18T19:00:00");
  });

  it("3. absolute reminder：target 改变后 triggerAt 不变", () => {
    const reminders = [mkReminder({ timingMode: "absolute", triggerAt: "2026-08-20T09:30:00" })];
    const out = reconcileTargetReminders(reminders, "assignment", "a1", "2026-08-18T20:00:00", NOW);
    expect(out[0].triggerAt).toBe("2026-08-20T09:30:00");
  });

  it("4. StudyBlock relative anchor = date + startTime", () => {
    expect(
      getReminderTargetAnchor("studyBlock", { date: "2026-08-12", startTime: "19:00" })
    ).toBe("2026-08-12T19:00:00");
    expect(
      resolveReminderTriggerAt({ timingMode: "relative", triggerAt: "2026-08-12T19:00:00", offsetMinutes: -30 })
    ).toBe("2026-08-12T18:30:00");
  });

  it("12. 本地墙钟：跨日期分钟运算无 UTC 漂移", () => {
    expect(
      resolveReminderTriggerAt({ timingMode: "relative", triggerAt: "2026-08-15T00:30:00", offsetMinutes: -60 })
    ).toBe("2026-08-14T23:30:00");
    expect(
      resolveReminderTriggerAt({ timingMode: "relative", triggerAt: "2026-08-15T23:00:00", offsetMinutes: 1440 })
    ).toBe("2026-08-16T23:00:00");
  });
});

describe("getReminderTargetAnchor", () => {
  it("5. 无 startTime 的 CalendarMark → 无合法 anchor（relative invalid）", () => {
    expect(getReminderTargetAnchor("calendarMark", { date: "2026-08-15" })).toBeNull();
    expect(getReminderTargetAnchor("calendarMark", { date: "2026-08-15", startTime: "10:00" })).toBe("2026-08-15T10:00:00");
  });

  it("assignment 无有效 DDL → 无 anchor；standalone → 恒 null", () => {
    expect(getReminderTargetAnchor("assignment", {})).toBeNull();
    expect(getReminderTargetAnchor("standalone", {})).toBeNull();
  });
});

describe("normalizeReminder", () => {
  it("6. standalone + relative → invalid（null）", () => {
    const raw = mkReminder({ targetType: "standalone", targetId: undefined, timingMode: "relative", offsetMinutes: -10 });
    expect(normalizeReminder(raw)).toBeNull();
  });

  it("6b. standalone absolute 合法；带 targetId 的 standalone → invalid", () => {
    expect(normalizeReminder(mkReminder({ targetType: "standalone", targetId: undefined, timingMode: "absolute", offsetMinutes: undefined }))).not.toBeNull();
    expect(normalizeReminder(mkReminder({ targetType: "standalone", targetId: "x", timingMode: "absolute", offsetMinutes: undefined }))).toBeNull();
  });

  it("11. 非法字段 → null（空 title / 非法 triggerAt / relative 无 offset / non-standalone 无 targetId）", () => {
    expect(normalizeReminder(mkReminder({ title: "  " }))).toBeNull();
    expect(normalizeReminder(mkReminder({ triggerAt: "not-a-date" }))).toBeNull();
    expect(normalizeReminder(mkReminder({ offsetMinutes: undefined }))).toBeNull();
    expect(normalizeReminder(mkReminder({ targetId: undefined }))).toBeNull();
    expect(normalizeReminder(mkReminder({ timingMode: "weird" as Reminder["timingMode"] }))).toBeNull();
    expect(normalizeReminder(mkReminder({ status: "weird" as Reminder["status"] }))).toBeNull();
  });
});

describe("evaluateMissedReminder", () => {
  const overdue = mkReminder({ triggerAt: "2026-08-10T09:00:00" }); // now 12:00 → overdue 3h

  it("7. policy deliver → deliver", () => {
    expect(evaluateMissedReminder({ reminder: overdue, now: NOW, policy: "deliver", windowHours: 6 })).toBe("deliver");
  });

  it("8. recent-only：6h 内 → deliver", () => {
    expect(evaluateMissedReminder({ reminder: overdue, now: NOW, policy: "recent-only", windowHours: 6 })).toBe("deliver");
  });

  it("9. recent-only：超过 6h → skip", () => {
    const old = mkReminder({ triggerAt: "2026-08-10T05:00:00" }); // 7h ago
    expect(evaluateMissedReminder({ reminder: old, now: NOW, policy: "recent-only", windowHours: 6 })).toBe("skip");
  });

  it("10. policy skip → skip", () => {
    expect(evaluateMissedReminder({ reminder: overdue, now: NOW, policy: "skip", windowHours: 6 })).toBe("skip");
  });

  it("未到时间 / 非 scheduled → pending", () => {
    const future = mkReminder({ triggerAt: "2026-08-10T15:00:00" });
    expect(evaluateMissedReminder({ reminder: future, now: NOW, policy: "deliver", windowHours: 6 })).toBe("pending");
    expect(evaluateMissedReminder({ reminder: { ...overdue, status: "fired" }, now: NOW, policy: "deliver", windowHours: 6 })).toBe("pending");
  });
});

describe("reconcileTargetReminders", () => {
  it("anchor 移除（DDL 删除）→ scheduled relative 移除；absolute / fired 保留", () => {
    const reminders = [
      mkReminder({ id: "rel", triggerAt: "2026-08-15T22:00:00" }),
      mkReminder({ id: "abs", timingMode: "absolute", offsetMinutes: undefined, triggerAt: "2026-08-20T09:30:00" }),
      mkReminder({ id: "fired", status: "fired", firedAt: NOW }),
    ];
    const out = reconcileTargetReminders(reminders, "assignment", "a1", null, NOW);
    expect(out.map((r) => r.id)).toEqual(["abs", "fired"]);
  });

  it("只影响指定 target 的 relative reminders", () => {
    const reminders = [
      mkReminder({ id: "mine", targetId: "a1", triggerAt: "2026-08-15T22:00:00" }),
      mkReminder({ id: "other", targetId: "a2", triggerAt: "2026-08-15T22:00:00" }),
    ];
    const out = reconcileTargetReminders(reminders, "assignment", "a1", "2026-08-18T20:00:00", NOW);
    expect(out.find((r) => r.id === "mine")!.triggerAt).toBe("2026-08-18T19:00:00");
    expect(out.find((r) => r.id === "other")!.triggerAt).toBe("2026-08-15T22:00:00");
  });
});
