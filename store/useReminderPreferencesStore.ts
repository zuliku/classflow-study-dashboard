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

interface ReminderPreferencesState {
  browserNotificationsEnabled: boolean;
  missedReminderPolicy: MissedReminderPolicy;
  missedReminderWindowHours: MissedReminderWindowHours;
  setBrowserNotificationsEnabled: (enabled: boolean) => void;
  setMissedReminderPolicy: (policy: MissedReminderPolicy) => void;
  setMissedReminderWindowHours: (hours: MissedReminderWindowHours) => void;
}

const DEFAULT_REMINDER_PREFERENCES = {
  browserNotificationsEnabled: false,
  missedReminderPolicy: "deliver" as MissedReminderPolicy,
  missedReminderWindowHours: 6 as MissedReminderWindowHours,
};

function normalizeWindowHours(v: unknown): MissedReminderWindowHours {
  return WINDOW_OPTIONS.includes(v as MissedReminderWindowHours)
    ? (v as MissedReminderWindowHours)
    : 6;
}

function normalizePolicy(v: unknown): MissedReminderPolicy {
  return v === "recent-only" || v === "skip" ? v : "deliver";
}

export const useReminderPreferencesStore = create<ReminderPreferencesState>()(
  persist(
    (set) => ({
      ...DEFAULT_REMINDER_PREFERENCES,
      setBrowserNotificationsEnabled: (enabled) => set({ browserNotificationsEnabled: enabled }),
      setMissedReminderPolicy: (policy) => set({ missedReminderPolicy: policy }),
      setMissedReminderWindowHours: (hours) => set({ missedReminderWindowHours: hours }),
    }),
    {
      name: "classflow-reminder-preferences-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        browserNotificationsEnabled: state.browserNotificationsEnabled,
        missedReminderPolicy: state.missedReminderPolicy,
        missedReminderWindowHours: state.missedReminderWindowHours,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<ReminderPreferencesState> | undefined;
        return {
          ...current,
          ...p,
          browserNotificationsEnabled:
            typeof p?.browserNotificationsEnabled === "boolean"
              ? p.browserNotificationsEnabled
              : false,
          missedReminderPolicy: normalizePolicy(p?.missedReminderPolicy),
          missedReminderWindowHours: normalizeWindowHours(p?.missedReminderWindowHours),
        };
      },
    }
  )
);
