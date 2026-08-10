"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useReminderPreferencesStore } from "@/store/useReminderPreferencesStore";
import { useReminderDeliveryStore } from "@/store/useReminderDeliveryStore";
import { Reminder } from "@/types";
import { evaluateMissedReminder, formatLocalDateTime } from "@/lib/reminders/reminderDomain";
import { parseLocalDDL } from "@/lib/ddl";
import {
  getDueScheduledReminders,
  getNextScheduledReminder,
  getReminderTimerDelay,
} from "@/lib/reminders/reminderScheduler";
import { getReminderDeliverySubtitle } from "@/lib/reminders/reminderPresentation";
import { showBrowserReminderNotification } from "@/lib/reminders/browserNotifications";

/**
 * Reminder Local Runtime（Task 7G-A2）：无视觉 DOM（return null）。
 * - 等待 useAppStore + useReminderPreferencesStore 均 hydrate 后才启动
 * - INITIAL_RECONCILE：首次启动按 missed policy 处理已过期 scheduled（deliver / skip / pending）
 * - SESSION_RESUME：visibilitychange / focus 后，本 Session 已打开的页面 → 过期直接 deliver（不经过 policy）
 * - 单 timer：reminders 变化 → 重排最近一条；> 24h → 24h wake-up
 * - duplicate guard：deliver 前重新读 Store，仅 status === "scheduled" 才继续（fired 后其他事件直接跳过）
 */

export function ReminderRuntime() {
  const timerRef = useRef<number | null>(null);
  const initializedRef = useRef(false);
  const enqueue = useReminderDeliveryStore((s) => s.enqueue);

  /** 交付：站内 Card（始终）+ Browser Notification（granted 且已开启时）。返回是否实际交付。 */
  const deliver = useCallback(
    (reminder: Reminder): boolean => {
      const state = useAppStore.getState();
      // 每次交付前重新读取 Store：只有仍 scheduled 才继续（duplicate guard，不依赖 React closure）
      const current = state.reminders.find((r) => r.id === reminder.id);
      if (!current || current.status !== "scheduled") return false;
      state.markReminderFired(reminder.id, formatLocalDateTime(new Date()));
      enqueue(reminder.id);
      const prefs = useReminderPreferencesStore.getState();
      if (prefs.browserNotificationsEnabled) {
        showBrowserReminderNotification({
          title: current.title,
          body: getReminderDeliverySubtitle(current),
          reminderId: current.id,
        });
      }
      return true;
    },
    [enqueue]
  );

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** 单 timer：清除旧 → 找最近 future scheduled → 设置一个 timer（>24h clamp） */
  const scheduleNext = useCallback(() => {
    clearTimer();
    const state = useAppStore.getState();
    const now = formatLocalDateTime(new Date());
    const next = getNextScheduledReminder(state.reminders, now);
    if (!next) return;
    const delay = getReminderTimerDelay(next.triggerAt, now);
    if (delay === null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      // timer 到时：重新获取真实时间 + Store（被修改/删除/fired → 不执行）
      const now2 = formatLocalDateTime(new Date());
      const st = useAppStore.getState();
      const cur = st.reminders.find((r) => r.id === next.id);
      if (cur && cur.status === "scheduled") {
        const t = parseLocalDDL(cur.triggerAt);
        const n = parseLocalDDL(now2);
        if (t && n && t.getTime() <= n.getTime()) deliver(cur);
      }
      scheduleNext();
    }, Math.max(delay, 0));
  }, [clearTimer, deliver]);

  /** 首次启动：按 missed policy 处理已过期 scheduled（网页之前没打开的语义） */
  const runInitialReconcile = useCallback(() => {
    const state = useAppStore.getState();
    const prefs = useReminderPreferencesStore.getState();
    const now = formatLocalDateTime(new Date());
    const due = getDueScheduledReminders(state.reminders, now);
    for (const r of due) {
      const decision = evaluateMissedReminder({
        reminder: r,
        now,
        policy: prefs.missedReminderPolicy,
        windowHours: prefs.missedReminderWindowHours,
      });
      if (decision === "deliver") deliver(r);
      else if (decision === "skip") state.markReminderSkipped(r.id);
      // pending → 不操作
    }
    scheduleNext();
  }, [deliver, scheduleNext]);

  /** Session resume（休眠/后台/锁屏后恢复）：本 Session 已打开的页面 → 过期直接 deliver，不走 policy */
  const runSessionResume = useCallback(() => {
    if (!initializedRef.current) return;
    const state = useAppStore.getState();
    const now = formatLocalDateTime(new Date());
    const due = getDueScheduledReminders(state.reminders, now);
    for (const r of due) deliver(r);
    scheduleNext();
  }, [deliver, scheduleNext]);

  // 等待两个 Store hydrate 后执行 initial reconcile
  useEffect(() => {
    let appReady = useAppStore.persist.hasHydrated();
    let prefsReady = useReminderPreferencesStore.persist.hasHydrated();
    const maybeStart = () => {
      if (!appReady || !prefsReady || initializedRef.current) return;
      initializedRef.current = true;
      runInitialReconcile();
    };
    const unsubApp = useAppStore.persist.onFinishHydration(() => {
      appReady = true;
      maybeStart();
    });
    const unsubPrefs = useReminderPreferencesStore.persist.onFinishHydration(() => {
      prefsReady = true;
      maybeStart();
    });
    maybeStart();
    return () => {
      unsubApp();
      unsubPrefs();
      clearTimer();
    };
  }, [runInitialReconcile, clearTimer]);

  // reminders 变化 → 重排单 timer（新建/删除/fired 等都会改变数组）
  const reminders = useAppStore((s) => s.reminders);
  useEffect(() => {
    if (!initializedRef.current) return;
    scheduleNext();
  }, [reminders, scheduleNext]);

  // Session resume：visibilitychange（回到 visible）+ window focus
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") runSessionResume();
    };
    const onFocus = () => runSessionResume();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      clearTimer();
    };
  }, [runSessionResume, clearTimer]);

  return null;
}
