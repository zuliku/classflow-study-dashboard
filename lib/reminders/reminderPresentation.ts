/**
 * Task 7G-A2：Reminder 展示文案（纯函数，站内 Card 与 Browser Notification body 共用）。
 */

import { Reminder } from "@/types";

function offsetText(offsetMinutes: number): string {
  const abs = Math.abs(offsetMinutes);
  if (abs % 1440 === 0 && abs > 0) return `${abs / 1440} 天`;
  if (abs % 60 === 0 && abs > 0) return `${abs / 60} 小时`;
  return `${abs} 分钟`;
}

/** 交付文案（短句）：target / offset 语义 → 用户可读 subtitle */
export function getReminderDeliverySubtitle(reminder: Reminder): string {
  const offset = reminder.offsetMinutes ?? 0;
  switch (reminder.targetType) {
    case "assignment":
      if (reminder.timingMode !== "relative") return reminder.note ?? "任务提醒";
      if (offset === 0) return "任务截止时间已到";
      return `距离截止时间还有 ${offsetText(offset)}`;
    case "studyBlock":
      return offset < 0 ? "学习计划即将开始" : "学习计划开始了";
    case "calendarMark":
      return offset < 0 ? "日程即将开始" : "日程时间已到";
    case "standalone":
      return reminder.note ?? "提醒时间已到";
  }
}
