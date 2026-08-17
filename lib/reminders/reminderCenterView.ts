/**
 * Task 7G-A3a：Reminder Center 展示纯逻辑（分组 / unread / 时间文案）。
 * 分组语义：upcoming = scheduled（升序）；history = fired + skipped（最近优先）。
 * 不推断 policy —— 已到期但仍 scheduled 的 Reminder 保持 scheduled 语义。
 */

import { Reminder } from "@/types";
import { getLocalDDLTime, parseLocalDDL } from "@/lib/ddl";

/** unread = fired && !readAt（铃铛小圆点） */
export function hasUnreadFiredReminders(reminders: Reminder[]): boolean {
  return reminders.some((r) => r.status === "fired" && !r.readAt);
}

export interface ReminderCenterGroups {
  /** status === "scheduled"，triggerAt 升序 */
  upcoming: Reminder[];
  /** fired + skipped，最近优先（triggerAt 降序） */
  history: Reminder[];
}

export function getReminderCenterGroups(reminders: Reminder[]): ReminderCenterGroups {
  const byTime = (r: Reminder) => parseLocalDDL(r.triggerAt)?.getTime() ?? 0;
  const upcoming = reminders
    .filter((r) => r.status === "scheduled")
    .sort((a, b) => byTime(a) - byTime(b));
  const history = reminders
    .filter((r) => r.status === "fired" || r.status === "skipped")
    .sort((a, b) => byTime(b) - byTime(a));
  return { upcoming, history };
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 时间文案：今天 HH:mm / 明天 HH:mm / M月d日 HH:mm；非法 triggerAt → 安全 fallback（不 crash） */
export function formatReminderCenterTime(triggerAt: string, now: string): string {
  const t = parseLocalDDL(triggerAt);
  const n = parseLocalDDL(now);
  if (!t || !n) return "时间未知";
  const time = getLocalDDLTime(triggerAt) || "00:00";
  const today = localDateStr(n);
  const target = localDateStr(t);
  if (target === today) return `今天 ${time}`;
  const tomorrow = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
  if (target === localDateStr(tomorrow)) return `明天 ${time}`;
  return `${t.getMonth() + 1}月${t.getDate()}日 ${time}`;
}
