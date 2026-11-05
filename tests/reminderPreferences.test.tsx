/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  DEFAULT_REMINDER_PREFERENCES,
  getModifiedReminderPreferenceKeys,
  resetReminderPreferencePatch,
  isDoNotDisturbModified,
  type ReminderPreferences,
} from "@/store/useReminderPreferencesStore";
import { TaskSettings } from "@/components/settings/TaskSettings";

if (typeof (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof window !== "undefined" && !(window as unknown as { matchMedia?: unknown }).matchMedia) {
  (window as unknown as { matchMedia: unknown }).matchMedia = () =>
    ({
      matches: false,
      media: "",
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }) as unknown as MediaQueryList;
}

const CANONICAL: ReminderPreferences = {
  browserNotificationsEnabled: false,
  missedReminderPolicy: "deliver",
  missedReminderWindowHours: 6,
  reminderSoundEnabled: true,
  reminderSoundVolume: 100,
  focusAutoDoNotDisturbEnabled: false,
  doNotDisturbEnabled: false,
  doNotDisturbStart: "22:00",
  doNotDisturbEnd: "07:00",
};

describe("V5A7 A：canonical default truth", () => {
  it("DEFAULT_REMINDER_PREFERENCES 与预期 canonical 一致", () => {
    expect(DEFAULT_REMINDER_PREFERENCES).toEqual(CANONICAL);
  });

  it("默认 preference → modified keys 为空", () => {
    expect(getModifiedReminderPreferenceKeys({ ...CANONICAL })).toEqual([]);
  });
});

describe("V5A7 B：逐字段 modified semantics", () => {
  it.each([
    ["browserNotificationsEnabled", { ...CANONICAL, browserNotificationsEnabled: true }],
    ["missedReminderPolicy", { ...CANONICAL, missedReminderPolicy: "recent-only" }],
    ["missedReminderWindowHours", { ...CANONICAL, missedReminderWindowHours: 24 }],
    ["reminderSoundEnabled", { ...CANONICAL, reminderSoundEnabled: false }],
    ["reminderSoundVolume", { ...CANONICAL, reminderSoundVolume: 40 }],
    ["focusAutoDoNotDisturbEnabled", { ...CANONICAL, focusAutoDoNotDisturbEnabled: true }],
    ["doNotDisturbEnabled", { ...CANONICAL, doNotDisturbEnabled: true }],
    ["doNotDisturbStart", { ...CANONICAL, doNotDisturbStart: "23:00" }],
    ["doNotDisturbEnd", { ...CANONICAL, doNotDisturbEnd: "08:00" }],
  ] as const)(" %s 偏离 → 仅该字段 modified", (key, prefs) => {
    expect(getModifiedReminderPreferenceKeys(prefs)).toEqual([key]);
  });

  it("windowHours 非默认但 policy 非 recent-only → 仍然 modified（不因隐藏忽略）", () => {
    expect(
      getModifiedReminderPreferenceKeys({ ...CANONICAL, missedReminderWindowHours: 24 })
    ).toContain("missedReminderWindowHours");
  });

  it("skip policy 同样 modified", () => {
    expect(
      getModifiedReminderPreferenceKeys({ ...CANONICAL, missedReminderPolicy: "skip" })
    ).toEqual(["missedReminderPolicy"]);
  });
});

describe("V5A7 C/G：reset truth 与 DND composite semantics", () => {
  it.each([
    ["browserNotificationsEnabled", false],
    ["missedReminderPolicy", "deliver"],
    ["missedReminderWindowHours", 6],
    ["reminderSoundEnabled", true],
    ["reminderSoundVolume", 100],
    ["focusAutoDoNotDisturbEnabled", false],
    ["doNotDisturbEnabled", false],
    ["doNotDisturbStart", "22:00"],
    ["doNotDisturbEnd", "07:00"],
  ] as const)("resetReminderPreferencePatch(%s) → canonical", (key, value) => {
    expect(resetReminderPreferencePatch(key)).toEqual({ [key]: value });
  });

  it("Case 1：enabled=true（时间默认）→ modified", () => {
    expect(isDoNotDisturbModified({ ...CANONICAL, doNotDisturbEnabled: true })).toBe(true);
  });

  it("Case 2：enabled=false + start=23:00 → modified", () => {
    expect(isDoNotDisturbModified({ ...CANONICAL, doNotDisturbStart: "23:00" })).toBe(true);
  });

  it("Case 3：enabled=false + end=08:00 → modified", () => {
    expect(isDoNotDisturbModified({ ...CANONICAL, doNotDisturbEnd: "08:00" })).toBe(true);
  });

  it("Case 4：全部默认 → not modified", () => {
    expect(isDoNotDisturbModified({ ...CANONICAL })).toBe(false);
  });

  it("Case 5：store resetDoNotDisturb 一次恢复三字段", async () => {
    vi.resetModules();
    const { useReminderPreferencesStore } = await import("@/store/useReminderPreferencesStore");
    const store = useReminderPreferencesStore;
    store.getState().setDoNotDisturbEnabled(true);
    store.getState().setDoNotDisturbStart("23:30");
    store.getState().setDoNotDisturbEnd("06:30");
    expect(isDoNotDisturbModified(store.getState())).toBe(true);
    store.getState().resetDoNotDisturb();
    expect(store.getState().doNotDisturbEnabled).toBe(false);
    expect(store.getState().doNotDisturbStart).toBe("22:00");
    expect(store.getState().doNotDisturbEnd).toBe("07:00");
    expect(isDoNotDisturbModified(store.getState())).toBe(false);
  });
});

describe("V5A7 store：初始化 / hydrate 兼容 / reset actions", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  async function freshStore() {
    vi.resetModules();
    const mod = await import("@/store/useReminderPreferencesStore");
    return mod.useReminderPreferencesStore;
  }

  it("初始 state 即 canonical defaults", async () => {
    const store = await freshStore();
    const s = store.getState();
    expect(s.browserNotificationsEnabled).toBe(false);
    expect(s.missedReminderPolicy).toBe("deliver");
    expect(s.missedReminderWindowHours).toBe(6);
    expect(s.reminderSoundEnabled).toBe(true);
    expect(s.reminderSoundVolume).toBe(100);
    expect(s.focusAutoDoNotDisturbEnabled).toBe(false);
    expect(s.doNotDisturbEnabled).toBe(false);
    expect(s.doNotDisturbStart).toBe("22:00");
    expect(s.doNotDisturbEnd).toBe("07:00");
  });

  it("非法 persisted 值回落 canonical（boolean/policy/window/time 全覆盖）", async () => {
    localStorage.setItem(
      "classflow-reminder-preferences-v1",
      JSON.stringify({
        state: {
          browserNotificationsEnabled: "yes",
          missedReminderPolicy: "sometimes",
          missedReminderWindowHours: 99,
          reminderSoundEnabled: 1,
          reminderSoundVolume: 999,
          focusAutoDoNotDisturbEnabled: "yes",
          doNotDisturbEnabled: "no",
          doNotDisturbStart: "25:00",
          doNotDisturbEnd: "bad",
        },
      })
    );
    const store = await freshStore();
    const s = store.getState();
    expect(s.browserNotificationsEnabled).toBe(false);
    expect(s.missedReminderPolicy).toBe("deliver");
    expect(s.missedReminderWindowHours).toBe(6);
    expect(s.reminderSoundEnabled).toBe(true);
    expect(s.reminderSoundVolume).toBe(100);
    expect(s.focusAutoDoNotDisturbEnabled).toBe(false);
    expect(s.doNotDisturbEnabled).toBe(false);
    expect(s.doNotDisturbStart).toBe("22:00");
    expect(s.doNotDisturbEnd).toBe("07:00");
  });

  it("resetReminderPreference 恢复单字段 canonical", async () => {
    const store = await freshStore();
    store.getState().setReminderSoundEnabled(false);
    store.getState().setMissedReminderWindowHours(24);
    store.getState().resetReminderPreference("reminderSoundEnabled");
    expect(store.getState().reminderSoundEnabled).toBe(true);
    // 未 reset 的字段保持
    expect(store.getState().missedReminderWindowHours).toBe(24);
    store.getState().resetReminderPreference("missedReminderWindowHours");
    expect(store.getState().missedReminderWindowHours).toBe(6);

    store.getState().setReminderSoundVolume(20);
    store.getState().setFocusAutoDoNotDisturbEnabled(true);
    store.getState().resetReminderPreference("reminderSoundVolume");
    store.getState().resetReminderPreference("focusAutoDoNotDisturbEnabled");
    expect(store.getState().reminderSoundVolume).toBe(100);
    expect(store.getState().focusAutoDoNotDisturbEnabled).toBe(false);

    store.getState().setReminderSoundVolume(150);
    expect(store.getState().reminderSoundVolume).toBe(100);
    store.getState().setReminderSoundVolume(-5);
    expect(store.getState().reminderSoundVolume).toBe(0);
  });
});

describe("V5A7 consumer：TaskSettings modified/reset wiring", () => {
  const RESET_LABELS: Record<string, string> = {
    "browser-notifications": "将系统通知恢复默认",
    "missed-reminder-policy": "将错过提醒处理恢复默认",
    "missed-reminder-window": "将补发时间范围恢复默认",
    "reminder-sound": "将提醒声音恢复默认",
    "reminder-sound-volume": "将提醒音量恢复默认",
    "focus-auto-dnd": "将专注期间自动免打扰恢复默认",
    "do-not-disturb": "将免打扰时段恢复默认",
  };

  function resetButton(container: HTMLElement, settingId: string): HTMLButtonElement | null {
    return container.querySelector(
      `[data-setting-id="${settingId}"] button[aria-label="${RESET_LABELS[settingId]}"]`
    );
  }

  async function mountTaskSettings() {
    vi.resetModules();
    const storeMod = await import("@/store/useReminderPreferencesStore");
    const { TaskSettings: Settings } = await import("@/components/settings/TaskSettings");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<Settings />);
    });
    return { container, root, store: storeMod.useReminderPreferencesStore };
  }

  it("D：默认态无 reset 按钮；开启通知后出现；reset 只改 preference、不请求系统权限", async () => {
    const requestPermission = vi.fn(async () => "granted" as NotificationPermission);
    (window as unknown as { Notification?: unknown }).Notification = {
      permission: "granted",
      requestPermission,
    };
    const { container, root, store } = await mountTaskSettings();
    try {
      expect(resetButton(container, "browser-notifications")).toBeNull();
      act(() => {
        store.getState().setBrowserNotificationsEnabled(true);
      });
      expect(resetButton(container, "browser-notifications")).toBeTruthy();
      await act(async () => {
        resetButton(container, "browser-notifications")!.click();
      });
      expect(store.getState().browserNotificationsEnabled).toBe(false);
      expect(resetButton(container, "browser-notifications")).toBeNull();
      expect(requestPermission).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
      container.remove();
      delete (window as unknown as { Notification?: unknown }).Notification;
    }
  });

  it("E：policy recent-only 显示 window；window 24 → modified，reset → 6；policy reset → deliver", async () => {
    const { container, root, store } = await mountTaskSettings();
    try {
      // 默认 deliver 时 window 行隐藏
      expect(container.querySelector('[data-setting-id="missed-reminder-window"]')).toBeNull();
      expect(resetButton(container, "missed-reminder-policy")).toBeNull();
      act(() => {
        store.getState().setMissedReminderPolicy("recent-only");
        store.getState().setMissedReminderWindowHours(24);
      });
      expect(container.querySelector('[data-setting-id="missed-reminder-window"]')).toBeTruthy();
      expect(resetButton(container, "missed-reminder-policy")).toBeTruthy();
      expect(resetButton(container, "missed-reminder-window")).toBeTruthy();
      await act(async () => {
        resetButton(container, "missed-reminder-window")!.click();
      });
      expect(store.getState().missedReminderWindowHours).toBe(6);
      await act(async () => {
        resetButton(container, "missed-reminder-policy")!.click();
      });
      expect(store.getState().missedReminderPolicy).toBe("deliver");
      expect(resetButton(container, "missed-reminder-policy")).toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("F：声音关闭 → modified；reset → true", async () => {
    const { container, root, store } = await mountTaskSettings();
    try {
      expect(resetButton(container, "reminder-sound")).toBeNull();
      act(() => {
        store.getState().setReminderSoundEnabled(false);
      });
      expect(resetButton(container, "reminder-sound")).toBeTruthy();
      await act(async () => {
        resetButton(container, "reminder-sound")!.click();
      });
      expect(store.getState().reminderSoundEnabled).toBe(true);
      expect(resetButton(container, "reminder-sound")).toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("F2：提醒音量 / 专注期间自动免打扰 modified/reset", async () => {
    const { container, root, store } = await mountTaskSettings();
    try {
      act(() => {
        store.getState().resetReminderPreference("reminderSoundVolume");
        store.getState().resetReminderPreference("focusAutoDoNotDisturbEnabled");
      });
      expect(resetButton(container, "reminder-sound-volume")).toBeNull();
      expect(resetButton(container, "focus-auto-dnd")).toBeNull();
      act(() => {
        store.getState().setReminderSoundVolume(35);
        store.getState().setFocusAutoDoNotDisturbEnabled(true);
      });
      expect(resetButton(container, "reminder-sound-volume")).toBeTruthy();
      expect(resetButton(container, "focus-auto-dnd")).toBeTruthy();
      await act(async () => {
        resetButton(container, "reminder-sound-volume")!.click();
        resetButton(container, "focus-auto-dnd")!.click();
      });
      expect(store.getState().reminderSoundVolume).toBe(100);
      expect(store.getState().focusAutoDoNotDisturbEnabled).toBe(false);
      expect(resetButton(container, "reminder-sound-volume")).toBeNull();
      expect(resetButton(container, "focus-auto-dnd")).toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("G：DND 任一子字段变化 → 整行 modified；reset 一次恢复三字段", async () => {
    const { container, root, store } = await mountTaskSettings();
    try {
      expect(resetButton(container, "do-not-disturb")).toBeNull();
      // enabled=false 但改了时间 → 仍然 modified
      act(() => {
        store.getState().setDoNotDisturbStart("23:30");
      });
      expect(resetButton(container, "do-not-disturb")).toBeTruthy();
      act(() => {
        store.getState().setDoNotDisturbEnabled(true);
        store.getState().setDoNotDisturbEnd("06:30");
      });
      await act(async () => {
        resetButton(container, "do-not-disturb")!.click();
      });
      expect(store.getState().doNotDisturbEnabled).toBe(false);
      expect(store.getState().doNotDisturbStart).toBe("22:00");
      expect(store.getState().doNotDisturbEnd).toBe("07:00");
      expect(resetButton(container, "do-not-disturb")).toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
