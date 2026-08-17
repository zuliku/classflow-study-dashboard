/**
 * Task 7G-C：Reminder Runtime Phase 策略（纯函数）。
 * 区分「首次启动的 missed 补发」与「Session 运行中的 retiming 补发」：
 * - initial-reconcile / booting 阶段：禁止 running-session 直发（否则历史 overdue 会绕过 missedReminderPolicy）
 * - running 阶段：已过期的 scheduled Reminder 立即 deliver（Assignment/StudyBlock retiming 后立刻触发，不等 focus/reload）
 */

import { Reminder } from "@/types";
import { getDueScheduledReminders } from "@/lib/reminders/reminderScheduler";

export type ReminderRuntimePhase = "booting" | "initial-reconcile" | "running";

/** running 阶段才返回已过期 scheduled Reminder；booting / initial-reconcile 一律 [] */
export function getRunningSessionDueReminders(
  reminders: Reminder[],
  now: string,
  phase: ReminderRuntimePhase
): Reminder[] {
  if (phase !== "running") return [];
  return getDueScheduledReminders(reminders, now);
}
