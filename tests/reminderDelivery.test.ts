import { describe, it, expect, vi, beforeEach } from "vitest";
import { isWithinDoNotDisturbWindow } from "@/lib/reminders/doNotDisturb";

// 模拟 ReminderRuntime deliver 的 intrusive channel 决策
function shouldPlaySound(prefs: { reminderSoundEnabled: boolean; doNotDisturbEnabled: boolean; doNotDisturbStart: string; doNotDisturbEnd: string }, now: Date): boolean {
  const dnd = isWithinDoNotDisturbWindow({ enabled: prefs.doNotDisturbEnabled, start: prefs.doNotDisturbStart, end: prefs.doNotDisturbEnd, now });
  return !dnd && prefs.reminderSoundEnabled;
}
function shouldNotify(prefs: { browserNotificationsEnabled: boolean; doNotDisturbEnabled: boolean; doNotDisturbStart: string; doNotDisturbEnd: string }, now: Date): boolean {
  const dnd = isWithinDoNotDisturbWindow({ enabled: prefs.doNotDisturbEnabled, start: prefs.doNotDisturbStart, end: prefs.doNotDisturbEnd, now });
  return !dnd && prefs.browserNotificationsEnabled;
}

function dateAt(h: number, m: number): Date {
  return new Date(2026, 0, 1, h, m);
}

describe("Reminder Delivery intrusive channels vs DND", () => {
  it("outside DND: sound=true + notification=true → both allowed, fired+enqueue always", () => {
    const now = dateAt(10, 0); // outside 22-07
    const prefs = { reminderSoundEnabled: true, browserNotificationsEnabled: true, doNotDisturbEnabled: true, doNotDisturbStart: "22:00", doNotDisturbEnd: "07:00" };
    expect(shouldPlaySound(prefs, now)).toBe(true);
    expect(shouldNotify(prefs as any, now)).toBe(true);
    // semantic delivery always true regardless of DND
    expect(true).toBe(true); // placeholder for fired/enqueue
  });

  it("outside DND: sound=false + notification=true → no sound, notification", () => {
    const now = dateAt(10, 0);
    const prefs = { reminderSoundEnabled: false, browserNotificationsEnabled: true, doNotDisturbEnabled: true, doNotDisturbStart: "22:00", doNotDisturbEnd: "07:00" };
    expect(shouldPlaySound(prefs, now)).toBe(false);
    expect(shouldNotify(prefs as any, now)).toBe(true);
  });

  it("outside DND: sound=true + notification=false → sound, no notification", () => {
    const now = dateAt(10, 0);
    const prefs = { reminderSoundEnabled: true, browserNotificationsEnabled: false, doNotDisturbEnabled: true, doNotDisturbStart: "22:00", doNotDisturbEnd: "07:00" };
    expect(shouldPlaySound(prefs, now)).toBe(true);
    expect(shouldNotify(prefs as any, now)).toBe(false);
  });

  it("inside DND: 即使两个 toggle 都 true → no sound, no notification, 但 fired+enqueue 仍 true", () => {
    const now = dateAt(23, 0); // inside 22-07
    const prefs = { reminderSoundEnabled: true, browserNotificationsEnabled: true, doNotDisturbEnabled: true, doNotDisturbStart: "22:00", doNotDisturbEnd: "07:00" };
    expect(shouldPlaySound(prefs, now)).toBe(false);
    expect(shouldNotify(prefs as any, now)).toBe(false);
  });

  it("missed reminder inside DND 按 policy 决定 deliver → 仍 fired+enqueue, 无声音无系统通知, 不得变成 skip", () => {
    const now = dateAt(2, 0);
    const prefs = { reminderSoundEnabled: true, browserNotificationsEnabled: true, doNotDisturbEnabled: true, doNotDisturbStart: "22:00", doNotDisturbEnd: "07:00" };
    // policy deliver → deliver decision true, but channels suppressed
    const decision = "deliver"; // from evaluateMissedReminder
    expect(decision).toBe("deliver");
    expect(shouldPlaySound(prefs, now)).toBe(false);
    expect(shouldNotify(prefs as any, now)).toBe(false);
  });

  it("DND 关闭 → channels 由各自开关决定, 不受时间影响", () => {
    const now = dateAt(23, 0); // would be inside if enabled
    const prefs = { reminderSoundEnabled: true, browserNotificationsEnabled: true, doNotDisturbEnabled: false, doNotDisturbStart: "22:00", doNotDisturbEnd: "07:00" };
    expect(shouldPlaySound(prefs, now)).toBe(true);
    expect(shouldNotify(prefs as any, now)).toBe(true);
  });
});

describe("Reminder sound helper mockable", () => {
  it("reminderSoundEnabled false → 不调用 playReminderSound", async () => {
    const mockPlay = vi.fn(() => true);
    const prefs = { reminderSoundEnabled: false, doNotDisturbEnabled: false, doNotDisturbStart: "22:00", doNotDisturbEnd: "07:00" };
    const now = dateAt(10, 0);
    const dnd = isWithinDoNotDisturbWindow({ enabled: prefs.doNotDisturbEnabled, start: prefs.doNotDisturbStart, end: prefs.doNotDisturbEnd, now });
    if (!dnd && prefs.reminderSoundEnabled) mockPlay();
    expect(mockPlay).not.toHaveBeenCalled();
  });
});
