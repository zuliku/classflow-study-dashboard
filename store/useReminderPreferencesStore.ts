"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createGuardedStorage, subscribeCrossWindowSync } from "@/lib/persistStorage";
import { useToastStore } from "@/store/useToastStore";
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
  /** 提醒音量：0–100（映射到提示音实际增益；默认 100 保持既有听感） */
  reminderSoundVolume: number;
  /** 专注进行中自动暂停提醒的系统通知与声音 */
  focusAutoDoNotDisturbEnabled: boolean;
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
  setReminderSoundVolume: (volume: number) => void;
  setFocusAutoDoNotDisturbEnabled: (enabled: boolean) => void;
  setDoNotDisturbEnabled: (enabled: boolean) => void;
  setDoNotDisturbStart: (time: string) => void;
  setDoNotDisturbEnd: (time: string) => void;
  /** 单字段恢复 canonical default（纯 setter，不触碰系统权限） */
  resetReminderPreference: (key: ReminderPreferenceKey) => void;
  /** DND 三字段一次恢复 canonical defaults */
  resetDoNotDisturb: () => void;
  /** 整库恢复 canonical defaults（仅全局清除调用） */
  resetToDefaults: () => void;
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
  reminderSoundVolume: 100,
  focusAutoDoNotDisturbEnabled: false,
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
      setReminderSoundVolume: (volume) =>
        set({
          reminderSoundVolume: Math.max(
            0,
            Math.min(100, Math.round(Number.isFinite(volume) ? volume : DEFAULT_REMINDER_PREFERENCES.reminderSoundVolume))
          ),
        }),
      setFocusAutoDoNotDisturbEnabled: (enabled) => set({ focusAutoDoNotDisturbEnabled: enabled }),
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
      resetToDefaults: () => set({ ...DEFAULT_REMINDER_PREFERENCES }),
    }),
    {
      name: "classflow-reminder-preferences-v1",
      storage: createGuardedStorage(() =>
        useToastStore.getState().pushToast({
          message: "本地存储空间已满，最新更改可能无法保存，请备份后清理空间。",
          type: "error",
        })
      ),
      partialize: (state) => ({
        browserNotificationsEnabled: state.browserNotificationsEnabled,
        missedReminderPolicy: state.missedReminderPolicy,
        missedReminderWindowHours: state.missedReminderWindowHours,
        reminderSoundEnabled: state.reminderSoundEnabled,
        reminderSoundVolume: state.reminderSoundVolume,
        focusAutoDoNotDisturbEnabled: state.focusAutoDoNotDisturbEnabled,
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
          reminderSoundVolume:
            typeof p?.reminderSoundVolume === "number" && Number.isFinite(p.reminderSoundVolume)
              ? Math.max(0, Math.min(100, Math.round(p.reminderSoundVolume)))
              : DEFAULT_REMINDER_PREFERENCES.reminderSoundVolume,
          focusAutoDoNotDisturbEnabled:
            typeof p?.focusAutoDoNotDisturbEnabled === "boolean"
              ? p.focusAutoDoNotDisturbEnabled
              : DEFAULT_REMINDER_PREFERENCES.focusAutoDoNotDisturbEnabled,
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

// 跨窗口收敛：他窗写入同 key 后去抖 rehydrate（单窗口写时无 storage 事件，零开销）
subscribeCrossWindowSync(useReminderPreferencesStore, "classflow-reminder-preferences-v1");
