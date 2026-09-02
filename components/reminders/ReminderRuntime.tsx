"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useReminderPreferencesStore } from "@/store/useReminderPreferencesStore";
import { useReminderDeliveryStore } from "@/store/useReminderDeliveryStore";
import { useReminderCenterStore } from "@/store/useReminderCenterStore";
import { Reminder } from "@/types";
import { evaluateMissedReminder, formatLocalDateTime } from "@/lib/reminders/reminderDomain";
import {
  getDueScheduledReminders,
  getNextScheduledReminder,
  getReminderTimerDelay,
} from "@/lib/reminders/reminderScheduler";
import { getRunningSessionDueReminders, ReminderRuntimePhase } from "@/lib/reminders/reminderRuntimePolicy";
import { getReminderDeliverySubtitle } from "@/lib/reminders/reminderPresentation";
import { showBrowserReminderNotification } from "@/lib/reminders/browserNotifications";
import { isWithinDoNotDisturbWindow } from "@/lib/reminders/doNotDisturb";
import { playReminderSound } from "@/lib/reminders/reminderSound";

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
  // Task 7G-C：booting → initial-reconcile → running（phase guard 防止历史 overdue 绕过 missed policy）
  const phaseRef = useRef<ReminderRuntimePhase>("booting");
  const enqueue = useReminderDeliveryStore((s) => s.enqueue);

  /** 系统通知点击 → 打开 ClassFlow + target navigation（bridge 不 import store，回调在此注入） */
  const buildNotificationOnClick = useCallback((reminder: Reminder) => {
    return () => {
      const state = useAppStore.getState();
      state.markReminderRead(reminder.id, formatLocalDateTime(new Date()));
      if (reminder.targetType === "assignment" && reminder.targetId) {
        state.setSelectedAssignmentId(reminder.targetId);
      } else if (reminder.targetType === "studyBlock" || reminder.targetType === "calendarMark") {
        state.setActiveTab("timetable");
      } else if (reminder.targetType === "standalone") {
        useReminderCenterStore.getState().open();
      }
    };
  }, []);

  /** 交付：semantic delivery（始终 mark fired + in-app enqueue）+ intrusive channels（受 DND 与开关抑制）。 */
  const deliver = useCallback(
    (reminder: Reminder): boolean => {
      const state = useAppStore.getState();
      // 每次交付前重新读取 Store：只有仍 scheduled 才继续（duplicate guard，不依赖 React closure）
      const current = state.reminders.find((r) => r.id === reminder.id);
      if (!current || current.status !== "scheduled") return false;
      // semantic delivery：永远执行（DND 不得抑制）
      state.markReminderFired(reminder.id, formatLocalDateTime(new Date()));
      enqueue(reminder.id);
      const prefs = useReminderPreferencesStore.getState();
      const nowDate = new Date();
      const isDnd = isWithinDoNotDisturbWindow({
        enabled: prefs.doNotDisturbEnabled,
        start: prefs.doNotDisturbStart,
        end: prefs.doNotDisturbEnd,
        now: nowDate,
      });
      // intrusive delivery：受 DND 抑制
      if (!isDnd && prefs.reminderSoundEnabled) {
        try {
          playReminderSound();
        } catch {}
      }
      if (!isDnd && prefs.browserNotificationsEnabled) {
        showBrowserReminderNotification({
          title: current.title,
          body: getReminderDeliverySubtitle(current),
          reminderId: current.id,
          onClick: buildNotificationOnClick(current),
        });
      }
      return true;
    },
    [enqueue, buildNotificationOnClick]
  );

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** 单 timer：清除旧 → 找最近 future scheduled → 设置一个 timer（>24h clamp；到点统一走 session reconcile） */
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
      sessionReconcileRef.current();
    }, Math.max(delay, 0));
  }, [clearTimer]);

  /** 首次启动：按 missed policy 处理已过期 scheduled（网页之前没打开的语义） */
  const runInitialReconcile = useCallback(() => {
    phaseRef.current = "initial-reconcile";
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
    phaseRef.current = "running";
    scheduleNext();
  }, [deliver, scheduleNext]);

  /**
   * Running Session Reconcile（Task 7G-C 核心）：timer / focus / visibility / reminders 变化的统一入口。
   * running 阶段：scheduled && triggerAt <= now 立即 deliver（Assignment/StudyBlock retiming 后无需等待 focus/reload）。
   * booting / initial-reconcile：返回 []（历史 overdue 必须走 missedReminderPolicy）。
   */
  const runSessionReconcile = useCallback(() => {
    if (!initializedRef.current) return;
    const state = useAppStore.getState();
    const now = formatLocalDateTime(new Date());
    const due = getRunningSessionDueReminders(state.reminders, now, phaseRef.current);
    for (const r of due) deliver(r);
    scheduleNext();
  }, [deliver, scheduleNext]);
  // 避免 hook callback 循环依赖（timer callback / effects 统一经 ref 调用）
  const sessionReconcileRef = useRef<() => void>(() => {});
  sessionReconcileRef.current = runSessionReconcile;

  // 等待两个 Store hydrate 后执行 initial reconcile（booting → initial-reconcile → running）
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

  // reminders 变化 → running 阶段立即 session reconcile（Task 7G-C：retiming 后 newly overdue 直接 deliver）；
  // 同时重排单 timer。booting / initial-reconcile 阶段 phase guard 阻止直发（历史 overdue 必须走 missed policy）。
  const reminders = useAppStore((s) => s.reminders);
  useEffect(() => {
    if (!initializedRef.current) return;
    sessionReconcileRef.current();
  }, [reminders, scheduleNext]);

  // Session resume：visibilitychange（回到 visible）+ window focus → 统一 session reconcile
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") sessionReconcileRef.current();
    };
    const onFocus = () => sessionReconcileRef.current();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      clearTimer();
    };
  }, [clearTimer]);

  return null;
}
