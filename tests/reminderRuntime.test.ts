import { describe, it, expect } from "vitest";
import { Reminder } from "@/types";
import {
  getDueScheduledReminders,
  getNextScheduledReminder,
  getReminderTimerDelay,
  REMINDER_TIMER_MAX_DELAY_MS,
} from "@/lib/reminders/reminderScheduler";
import { getReminderDeliverySubtitle } from "@/lib/reminders/reminderPresentation";

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

describe("getNextScheduledReminder", () => {
  it("1. 3 个 future reminder → 返回最早一个", () => {
    const reminders = [
      mkReminder("a", "2026-08-10T15:00:00"),
      mkReminder("b", "2026-08-10T13:30:00"),
      mkReminder("c", "2026-08-11T09:00:00"),
    ];
    expect(getNextScheduledReminder(reminders, NOW)?.id).toBe("b");
  });

  it("2. fired / skipped 不会进入 next scheduled", () => {
    const reminders = [
      mkReminder("fired", "2026-08-10T13:00:00", { status: "fired" }),
      mkReminder("skipped", "2026-08-10T13:00:00", { status: "skipped" }),
      mkReminder("next", "2026-08-10T14:00:00"),
    ];
    expect(getNextScheduledReminder(reminders, NOW)?.id).toBe("next");
  });

  it("已过期（triggerAt <= now）的 scheduled 不进入 next（留给 due / resume）", () => {
    const reminders = [mkReminder("due", "2026-08-10T11:00:00"), mkReminder("future", "2026-08-10T13:00:00")];
    expect(getNextScheduledReminder(reminders, NOW)?.id).toBe("future");
  });

  it("无 future → null；不 mutate 原数组", () => {
    const reminders = [mkReminder("past", "2026-08-10T10:00:00")];
    const copy = [...reminders];
    expect(getNextScheduledReminder(reminders, NOW)).toBeNull();
    expect(reminders).toEqual(copy);
  });
});

describe("getDueScheduledReminders", () => {
  it("3. 只返回 scheduled && triggerAt <= now", () => {
    const reminders = [
      mkReminder("due1", "2026-08-10T11:00:00"),
      mkReminder("exact", "2026-08-10T12:00:00"),
      mkReminder("future", "2026-08-10T13:00:00"),
      mkReminder("fired", "2026-08-10T10:00:00", { status: "fired" }),
      mkReminder("skipped", "2026-08-10T10:30:00", { status: "skipped" }),
    ];
    expect(getDueScheduledReminders(reminders, NOW).map((r) => r.id).sort()).toEqual(["due1", "exact"]);
  });
});

describe("getReminderTimerDelay", () => {
  it("4. future > 24h → clamp 到 REMINDER_TIMER_MAX_DELAY_MS（24h wake-up）", () => {
    const far = "2026-09-01T12:00:00";
    expect(getReminderTimerDelay(far, NOW)).toBe(REMINDER_TIMER_MAX_DELAY_MS);
  });

  it("24h 内 → 精确毫秒；已过期 → 0；非法 → null", () => {
    const in2h = "2026-08-10T14:00:00";
    expect(getReminderTimerDelay(in2h, NOW)).toBe(2 * 60 * 60 * 1000);
    expect(getReminderTimerDelay("2026-08-10T11:00:00", NOW)).toBe(0);
    expect(getReminderTimerDelay("bad", NOW)).toBeNull();
  });

  it("8. 本地墙钟毫秒差值 = 绝对 epoch 差（无 UTC 转换影响）", () => {
    const trigger = "2026-08-10T23:59:00";
    const expected = new Date(2026, 7, 10, 23, 59).getTime() - new Date(2026, 7, 10, 12, 0).getTime();
    expect(getReminderTimerDelay(trigger, NOW)).toBe(expected);
  });
});

describe("getReminderDeliverySubtitle", () => {
  it("5. Assignment relative -60 → 距离截止时间还有 1 小时", () => {
    expect(
      getReminderDeliverySubtitle(
        mkReminder("r", "2026-08-15T22:00:00", { targetType: "assignment", targetId: "a1", timingMode: "relative", offsetMinutes: -60 })
      )
    ).toBe("距离截止时间还有 1 小时");
  });

  it("Assignment offset 0 → 任务截止时间已到；-1440 → 1 天；-10 → 10 分钟", () => {
    const base = { targetType: "assignment" as const, targetId: "a1", timingMode: "relative" as const };
    expect(getReminderDeliverySubtitle(mkReminder("a", "t", { ...base, offsetMinutes: 0 }))).toBe("任务截止时间已到");
    expect(getReminderDeliverySubtitle(mkReminder("b", "t", { ...base, offsetMinutes: -1440 }))).toBe("距离截止时间还有 1 天");
    expect(getReminderDeliverySubtitle(mkReminder("c", "t", { ...base, offsetMinutes: -10 }))).toBe("距离截止时间还有 10 分钟");
  });

  it("StudyBlock / CalendarMark 文案", () => {
    expect(
      getReminderDeliverySubtitle(mkReminder("s", "t", { targetType: "studyBlock", targetId: "b1", timingMode: "relative", offsetMinutes: -30 }))
    ).toBe("学习计划即将开始");
    expect(
      getReminderDeliverySubtitle(mkReminder("c", "t", { targetType: "calendarMark", targetId: "cm1", timingMode: "relative", offsetMinutes: 0 }))
    ).toBe("日程时间已到");
  });

  it("6. Standalone note 优先；无 note → 提醒时间已到", () => {
    expect(getReminderDeliverySubtitle(mkReminder("s1", "t", { note: "记得交材料" }))).toBe("记得交材料");
    expect(getReminderDeliverySubtitle(mkReminder("s2", "t"))).toBe("提醒时间已到");
  });
});
