"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { MissedReminderPolicy } from "@/types";

/**
 * Reminder Preferences（独立于业务 useAppStore）：
 * 浏览器 Notification 权限属于设备/browser 环境，不与业务 backup 强绑定。
 * 持久化：localStorage `classflow-reminder-preferences-v1`
 */

const WINDOW_OPTIONS: MissedReminderWindowHours[] = [1, 6, 24];

export type MissedReminderWindowHours = 1 | 6 | 24;

/** 真实持久化偏好（仅数据，不含 actions；V5A7 modified/reset 唯一口径的输入类型） */
export interface ReminderPreferences {
  browserNotificationsEnabled: boolean;
  missedReminderPolicy: MissedReminderPolicy;
  missedReminderWindowHours: MissedReminderWindowHours;
  reminderSoundEnabled: boolean;
  doNotDisturbEnabled: boolean;
  doNotDisturbStart: string; // "HH:mm"
  doNotDisturbEnd: string; // "HH:mm"
}

export type ReminderPreferenceKey = keyof ReminderPreferences;

interface ReminderPreferencesState extends ReminderPreferences {
  setBrowserNotificationsEnabled: (enabled: boolean) => void;
  setMissedReminderPolicy: (policy: MissedReminderPolicy) => void;
  setMissedReminderWindowHours: (hours: MissedReminderWindowHours) => void;
  setReminderSoundEnabled: (enabled: boolean) => void;
  setDoNotDisturbEnabled: (enabled: boolean) => void;
  setDoNotDisturbStart: (time: string) => void;
  setDoNotDisturbEnd: (time: string) => void;
  /** 单字段恢复 canonical default（纯 setter，不触碰系统权限） */
  resetReminderPreference: (key: ReminderPreferenceKey) => void;
  /** DND 三字段一次恢复 canonical defaults */
  resetDoNotDisturb: () => void;
}

/**
 * Canonical defaults（唯一 authoritative 定义）：
 * store 初始化、persist merge/sanitize fallback、modified 检测、reset 全部共享，
 * UI 与测试禁止再硬编码 "22:00" / 6 / false 等 magic defaults。
 */
export const DEFAULT_REMINDER_PREFERENCES: ReminderPreferences = {
  browserNotificationsEnabled: false,
  missedReminderPolicy: "deliver",
  missedReminderWindowHours: 6,
  reminderSoundEnabled: true,
  doNotDisturbEnabled: false,
  doNotDisturbStart: "22:00",
  doNotDisturbEnd: "07:00",
};

/** 当前与默认不同的偏好键（纯函数；全部 primitive，直接比较，不比较 actions） */
export function getModifiedReminderPreferenceKeys(
  preferences: ReminderPreferences
): ReminderPreferenceKey[] {
  return (Object.keys(DEFAULT_REMINDER_PREFERENCES) as ReminderPreferenceKey[]).filter(
    (k) => preferences[k] !== DEFAULT_REMINDER_PREFERENCES[k]
  );
}

/** 单项恢复默认的 patch（纯函数；store action 与测试共用） */
export function resetReminderPreferencePatch(key: ReminderPreferenceKey): Partial<ReminderPreferences> {
  return { [key]: DEFAULT_REMINDER_PREFERENCES[key] };
}

/**
 * DND 按一个业务设置理解：enabled/start/end 任一偏离默认 → 整行 modified。
 * 注意：enabled=false 但改过时间同样算 modified（时间值本身仍是真实持久化偏好）。
 */
export function isDoNotDisturbModified(preferences: ReminderPreferences): boolean {
  return (
    preferences.doNotDisturbEnabled !== DEFAULT_REMINDER_PREFERENCES.doNotDisturbEnabled ||
    preferences.doNotDisturbStart !== DEFAULT_REMINDER_PREFERENCES.doNotDisturbStart ||
    preferences.doNotDisturbEnd !== DEFAULT_REMINDER_PREFERENCES.doNotDisturbEnd
  );
}

function normalizeWindowHours(v: unknown): MissedReminderWindowHours {
  return WINDOW_OPTIONS.includes(v as MissedReminderWindowHours)
    ? (v as MissedReminderWindowHours)
    : DEFAULT_REMINDER_PREFERENCES.missedReminderWindowHours;
}

function normalizePolicy(v: unknown): MissedReminderPolicy {
  return v === "recent-only" || v === "skip" ? v : DEFAULT_REMINDER_PREFERENCES.missedReminderPolicy;
}

export const useReminderPreferencesStore = create<ReminderPreferencesState>()(
  persist(
    (set) => ({
      ...DEFAULT_REMINDER_PREFERENCES,
      setBrowserNotificationsEnabled: (enabled) => set({ browserNotificationsEnabled: enabled }),
      setMissedReminderPolicy: (policy) => set({ missedReminderPolicy: policy }),
      setMissedReminderWindowHours: (hours) => set({ missedReminderWindowHours: hours }),
      setReminderSoundEnabled: (enabled) => set({ reminderSoundEnabled: enabled }),
      setDoNotDisturbEnabled: (enabled) => set({ doNotDisturbEnabled: enabled }),
      setDoNotDisturbStart: (time) => set({ doNotDisturbStart: time }),
      setDoNotDisturbEnd: (time) => set({ doNotDisturbEnd: time }),
      resetReminderPreference: (key) => set(resetReminderPreferencePatch(key)),
      resetDoNotDisturb: () =>
        set({
          doNotDisturbEnabled: DEFAULT_REMINDER_PREFERENCES.doNotDisturbEnabled,
          doNotDisturbStart: DEFAULT_REMINDER_PREFERENCES.doNotDisturbStart,
          doNotDisturbEnd: DEFAULT_REMINDER_PREFERENCES.doNotDisturbEnd,
        }),
    }),
    {
      name: "classflow-reminder-preferences-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        browserNotificationsEnabled: state.browserNotificationsEnabled,
        missedReminderPolicy: state.missedReminderPolicy,
        missedReminderWindowHours: state.missedReminderWindowHours,
        reminderSoundEnabled: state.reminderSoundEnabled,
        doNotDisturbEnabled: state.doNotDisturbEnabled,
        doNotDisturbStart: state.doNotDisturbStart,
        doNotDisturbEnd: state.doNotDisturbEnd,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<ReminderPreferencesState> | undefined;
        const isHHMM = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
        return {
          ...current,
          ...p,
          browserNotificationsEnabled:
            typeof p?.browserNotificationsEnabled === "boolean"
              ? p.browserNotificationsEnabled
              : DEFAULT_REMINDER_PREFERENCES.browserNotificationsEnabled,
          missedReminderPolicy: normalizePolicy(p?.missedReminderPolicy),
          missedReminderWindowHours: normalizeWindowHours(p?.missedReminderWindowHours),
          reminderSoundEnabled:
            typeof p?.reminderSoundEnabled === "boolean"
              ? p.reminderSoundEnabled
              : DEFAULT_REMINDER_PREFERENCES.reminderSoundEnabled,
          doNotDisturbEnabled:
            typeof p?.doNotDisturbEnabled === "boolean"
              ? p.doNotDisturbEnabled
              : DEFAULT_REMINDER_PREFERENCES.doNotDisturbEnabled,
          doNotDisturbStart: isHHMM(p?.doNotDisturbStart)
            ? p.doNotDisturbStart!
            : DEFAULT_REMINDER_PREFERENCES.doNotDisturbStart,
          doNotDisturbEnd: isHHMM(p?.doNotDisturbEnd)
            ? p.doNotDisturbEnd!
            : DEFAULT_REMINDER_PREFERENCES.doNotDisturbEnd,
        };
      },
    }
  )
);
