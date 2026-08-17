/**
 * Task 7G-A2：Reminder Local Scheduler（纯函数）。
 * 只处理 status === "scheduled"；fired / skipped 一律忽略。
 * 单 timer 语义：getNextScheduledReminder 找到最近一条 → getReminderTimerDelay 计算延迟。
 * 长周期安全：超过 24h 只设置 24h wake-up timer（避免超长 setTimeout 边界问题），到点后重新计算。
 */

import { Reminder } from "@/types";
import { parseLocalDDL } from "@/lib/ddl";

export const REMINDER_TIMER_MAX_DELAY_MS = 24 * 60 * 60 * 1000;

/** 已到期且仍 scheduled 的 Reminder（initial reconcile / session resume 共用） */
export function getDueScheduledReminders(reminders: Reminder[], now: string): Reminder[] {
  const nowDate = parseLocalDDL(now);
  if (!nowDate) return [];
  return reminders.filter((r) => {
    if (r.status !== "scheduled") return false;
    const t = parseLocalDDL(r.triggerAt);
    return !!t && t.getTime() <= nowDate.getTime();
  });
}

/** 最近一条 future scheduled Reminder（triggerAt > now）；无 → null。不 mutate 原数组。 */
export function getNextScheduledReminder(reminders: Reminder[], now: string): Reminder | null {
  const nowDate = parseLocalDDL(now);
  if (!nowDate) return null;
  let best: Reminder | null = null;
  let bestMs = Infinity;
  for (const r of reminders) {
    if (r.status !== "scheduled") continue;
    const t = parseLocalDDL(r.triggerAt);
    if (!t) continue;
    const ms = t.getTime();
    if (ms > nowDate.getTime() && ms < bestMs) {
      best = r;
      bestMs = ms;
    }
  }
  return best;
}

/** Timer 延迟（ms）：已过期 → 0；> 24h → clamp 到 REMINDER_TIMER_MAX_DELAY_MS；非法 → null */
export function getReminderTimerDelay(triggerAt: string, now: string): number | null {
  const t = parseLocalDDL(triggerAt);
  const n = parseLocalDDL(now);
  if (!t || !n) return null;
  const delay = t.getTime() - n.getTime();
  if (delay <= 0) return 0;
  return Math.min(delay, REMINDER_TIMER_MAX_DELAY_MS);
}
