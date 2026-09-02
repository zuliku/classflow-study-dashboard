"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { useReminderPreferencesStore } from "@/store/useReminderPreferencesStore";
import { FocusSession } from "@/types";
import {
  FocusRuntimePhase,
  getFocusRuntimeDecision,
} from "@/lib/focus/focusRuntime";
import { deriveFocusClock } from "@/lib/focus/focusDomain";
import { playFocusCompleteSound, showFocusBrowserNotification } from "@/lib/focus/focusNotifications";

/**
 * Focus Runtime（Task 3）：让 running FocusSession 按真实时间运行。
 * - 等待 useAppStore hydration 后：booting reconcile（overdue running → complete("recovered")，只站内 Toast）
 * - 之后 phase=running：单 setTimeout 按 remainingMs 倒计时；Session 变化 → 清旧重排
 * - timeout / visibilitychange / focus 都重新读 Store 后 reconcile
 * - live 完成：先 complete("timer") 且 ok:true 才 Toast + 提示音 + Browser Notification（已开启且 granted）
 * - 第二个事件再次 reconcile 时 Store 已 completed → 不会重复通知
 * - 不每秒写 Zustand（每秒倒计时属于 UI Task）
 */
export function FocusRuntime() {
  const timerRef = useRef<number | null>(null);
  const initializedRef = useRef(false);
  const phaseRef = useRef<FocusRuntimePhase>("booting");
  const pushToast = useToastStore((s) => s.pushToast);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** live 完成交付：complete 成功后才通知（音 + Toast + 系统通知） */
  const deliverLiveComplete = useCallback(
    (session: FocusSession) => {
      const now = Date.now();
      const result = useAppStore.getState().completeFocusSession(session.id, "timer", now);
      if (!result.ok) return; // Store 已 completed / 已结算 → 不重复通知
      pushToast({
        message: "专注完成，休息一下吧",
        type: "info",
      });
      const focusPrefs = useAppStore.getState().preferences;
      if (focusPrefs.focusSoundEnabled) {
        playFocusCompleteSound(focusPrefs.focusSoundVolume);
      }
      const prefs = useReminderPreferencesStore.getState();
      if (prefs.browserNotificationsEnabled) {
        showFocusBrowserNotification({
          title: "专注完成",
          body: `已完成 ${session.plannedMinutes} 分钟专注`,
        });
      }
    },
    [pushToast]
  );

  /** 统一 reconcile：booting → recovered（只 Toast）；running → live（完整通知） */
  const reconcileRef = useRef<() => void>(() => {});
  const runReconcile = useCallback(() => {
    if (!initializedRef.current) return;
    const state = useAppStore.getState();
    const now = Date.now();
    const phase = phaseRef.current;
    for (const session of state.focusSessions) {
      const decision = getFocusRuntimeDecision(session, now, phase);
      if (decision === "none") continue;
      if (decision === "complete-recovered") {
        const result = state.completeFocusSession(session.id, "recovered", now);
        if (result.ok) {
          pushToast({ message: "上次的专注会话已自动完成", type: "info" });
        }
        continue;
      }
      if (decision === "complete-live") {
        deliverLiveComplete(session);
      }
    }
    scheduleNextRef.current();
  }, [deliverLiveComplete, pushToast]);
  reconcileRef.current = runReconcile;

  /** 单 timer：只针对 running 且 remaining > 0 的 Session 设置最近一个 timeout */
  const scheduleNextRef = useRef<() => void>(() => {});
  const scheduleNext = useCallback(() => {
    clearTimer();
    const state = useAppStore.getState();
    const now = Date.now();
    let nearest: { session: FocusSession; delay: number } | null = null;
    for (const session of state.focusSessions) {
      if (session.status !== "running" || session.activeStartedAt === undefined) continue;
      const clock = deriveFocusClock(session, now);
      if (clock.remainingMs <= 0) continue; // 已 due：由 reconcile 处理
      if (nearest === null || clock.remainingMs < nearest.delay) {
        nearest = { session, delay: clock.remainingMs };
      }
    }
    if (!nearest) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      reconcileRef.current();
    }, nearest.delay);
  }, [clearTimer]);
  scheduleNextRef.current = scheduleNext;

  // 等待 useAppStore hydration → booting reconcile → running
  useEffect(() => {
    const maybeStart = () => {
      if (!useAppStore.persist.hasHydrated() || initializedRef.current) return;
      initializedRef.current = true;
      phaseRef.current = "booting";
      reconcileRef.current();
      phaseRef.current = "running";
      scheduleNextRef.current();
    };
    if (useAppStore.persist.hasHydrated()) {
      maybeStart();
    } else {
      const unsub = useAppStore.persist.onFinishHydration(() => maybeStart());
      return () => {
        unsub();
        clearTimer();
      };
    }
    return () => clearTimer();
  }, [clearTimer]);

  // Session 变化 → 清旧 timer 并重排（paused 自然不设 timer）
  const focusSessions = useAppStore((s) => s.focusSessions);
  useEffect(() => {
    if (!initializedRef.current) return;
    scheduleNextRef.current();
  }, [focusSessions, scheduleNext]);

  // timeout / visible / focus 统一走 reconcile（重新读 Store，dedup 由 Store completed 保证）
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") reconcileRef.current();
    };
    const onFocus = () => reconcileRef.current();
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
