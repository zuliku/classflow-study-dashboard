import { describe, it, expect } from "vitest";
import { Reminder } from "@/types";
import {
  formatReminderCenterTime,
  getReminderCenterGroups,
  hasUnreadFiredReminders,
} from "@/lib/reminders/reminderCenterView";

const NOW = "2026-08-10T12:00:00";

function mkReminder(id: string, triggerAt: string, patch: Partial<Reminder> = {}): Reminder {
  return {
    id,
    title: id,
    targetType: "standalone",
    timingMode: "absolute",
    triggerAt,
    status: "scheduled",
    source: "manual",
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

describe("hasUnreadFiredReminders", () => {
  it("1. fired && !readAt → unread true", () => {
    expect(
      hasUnreadFiredReminders([
        mkReminder("r", NOW, { status: "fired", firedAt: NOW }),
        mkReminder("s", NOW),
      ])
    ).toBe(true);
  });

  it("2. fired + readAt → unread false；scheduled/skipped 不算 unread", () => {
    expect(
      hasUnreadFiredReminders([
        mkReminder("r", NOW, { status: "fired", firedAt: NOW, readAt: NOW }),
        mkReminder("s", NOW),
        mkReminder("k", NOW, { status: "skipped" }),
      ])
    ).toBe(false);
    expect(hasUnreadFiredReminders([])).toBe(false);
  });
});

describe("getReminderCenterGroups", () => {
  it("3. scheduled → upcoming，triggerAt 升序", () => {
    const reminders = [
      mkReminder("late", "2026-08-10T18:00:00"),
      mkReminder("early", "2026-08-10T13:00:00"),
    ];
    expect(getReminderCenterGroups(reminders).upcoming.map((r) => r.id)).toEqual(["early", "late"]);
  });

  it("4. fired/skipped → history，最近优先（按 triggerAt 降序）", () => {
    const reminders = [
      mkReminder("old-fired", "2026-08-08T10:00:00", { status: "fired", firedAt: NOW }),
      mkReminder("new-fired", "2026-08-09T10:00:00", { status: "fired", firedAt: NOW }),
      mkReminder("skipped", "2026-08-07T10:00:00", { status: "skipped" }),
    ];
    const { history } = getReminderCenterGroups(reminders);
    expect(history.map((r) => r.id)).toEqual(["new-fired", "old-fired", "skipped"]);
  });

  it("已到期的 scheduled 仍属于 upcoming（保持 scheduled 语义，不做 policy 推断）", () => {
    const reminders = [mkReminder("due", "2026-08-10T11:00:00")];
    const { upcoming, history } = getReminderCenterGroups(reminders);
    expect(upcoming.map((r) => r.id)).toEqual(["due"]);
    expect(history).toHaveLength(0);
  });
});

describe("formatReminderCenterTime", () => {
  it("5. 今天 → 今天 23:00", () => {
    expect(formatReminderCenterTime("2026-08-10T23:00:00", NOW)).toBe("今天 23:00");
  });

  it("6. 明天 → 明天 08:30", () => {
    expect(formatReminderCenterTime("2026-08-11T08:30:00", NOW)).toBe("明天 08:30");
  });

  it("7. 其他日期 → 8月15日 20:00", () => {
    expect(formatReminderCenterTime("2026-08-15T20:00:00", NOW)).toBe("8月15日 20:00");
  });

  it("8. invalid triggerAt → 安全 fallback（原字符串或空文案，不 crash）", () => {
    const out = formatReminderCenterTime("not-a-date", NOW);
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });
});
