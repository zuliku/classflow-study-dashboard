import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isBrowserNotificationSupported,
  showBrowserReminderNotification,
} from "@/lib/reminders/browserNotifications";

describe("browserNotifications bridge（SSR 安全）", () => {
  const origWindow = globalThis.window;
  const origNotification = (globalThis as Record<string, unknown>).Notification;

  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).Notification;
  });

  it("Notification undefined → unsupported / 不 show（不 crash）", () => {
    expect(isBrowserNotificationSupported()).toBe(false);
    expect(
      showBrowserReminderNotification({ title: "t", body: "b", reminderId: "r1" })
    ).toBe(false);
  });

  it("permission denied → 不 show", () => {
    const calls: { title: string; body: string; icon: string; tag: string }[] = [];
    class FakeNotification {
      static permission: NotificationPermission = "denied";
      constructor(public title: string, public options: { body: string; icon: string; tag: string }) {
        calls.push({ title, ...options });
      }
      onclick: (() => void) | null = null;
      close() {}
    }
    const win = { Notification: FakeNotification } as unknown as Window & typeof globalThis;
    (globalThis as Record<string, unknown>).window = win;

    expect(showBrowserReminderNotification({ title: "t", body: "b", reminderId: "r1" })).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("granted → 使用 Kiro icon + 独立 tag", () => {
    let instance: { title: string; options: { body: string; icon: string; tag: string }; onclick: (() => void) | null; close: () => void } | null = null;
    class FakeNotification {
      static permission: NotificationPermission = "granted";
      onclick: (() => void) | null = null;
      close() {}
      constructor(
        public title: string,
        public options: { body: string; icon: string; tag: string }
      ) {
        instance = this;
      }
    }
    const win = { Notification: FakeNotification, focus: () => {} } as unknown as Window & typeof globalThis;
    (globalThis as Record<string, unknown>).window = win;

    const ok = showBrowserReminderNotification({ title: "作业提醒", body: "距离截止还有 1 小时", reminderId: "r1" });
    expect(ok).toBe(true);
    expect(instance).not.toBeNull();
    expect(instance!.title).toBe("作业提醒");
    expect(instance!.options.body).toBe("距离截止还有 1 小时");
    expect(instance!.options.icon).toBe("/kiro/kiro-mark.png");
    expect(instance!.options.tag).toBe("classflow-reminder-r1");
  });
});

// 还原全局（node 环境无真实 Notification）
vi.restoreAllMocks;
