/**
 * Task 7G-A3b：Assignment Reminder UI 纯逻辑（preset / duplicate / availability / label）。
 * 组件不承担业务判断；DDL 解析与 trigger 计算复用现有 Domain（resolveReminderTriggerAt / parseLocalDDL）。
 */

import { Assignment, Reminder, ReminderTimingMode } from "@/types";
import { parseLocalDDL } from "@/lib/ddl";
import { resolveReminderTriggerAt } from "@/lib/reminders/reminderDomain";

export interface AssignmentReminderPreset {
  label: string;
  offsetMinutes: number;
}

/** 固定 V1 四个 relative preset（克制，不扩 5/30 分钟等） */
export const ASSIGNMENT_REMINDER_PRESETS: AssignmentReminderPreset[] = [
  { label: "到期时", offsetMinutes: 0 },
  { label: "提前 10 分钟", offsetMinutes: -10 },
  { label: "提前 1 小时", offsetMinutes: -60 },
  { label: "提前 1 天", offsetMinutes: -1440 },
];

/** 当前 Assignment 的 scheduled Reminder（按 triggerAt 升序，最近发生的最上） */
export function getAssignmentScheduledReminders(
  reminders: Reminder[],
  assignmentId: string
): Reminder[] {
  return reminders
    .filter(
      (r) =>
        r.targetType === "assignment" && r.targetId === assignmentId && r.status === "scheduled"
    )
    .sort((a, b) => (parseLocalDDL(a.triggerAt)?.getTime() ?? 0) - (parseLocalDDL(b.triggerAt)?.getTime() ?? 0));
}

export interface ReminderScheduleInput {
  timingMode: ReminderTimingMode;
  offsetMinutes?: number;
  triggerAt: string;
}

/**
 * 防重复（UI 层，P3 fix 1：与 Domain same-trigger 语义一致）：
 * 按「最终解析后的本地 triggerAt」比较（epoch）——relative 与 absolute 若最终时刻相同
 * 同样属于重复实际通知（不再只比较 timingMode）。
 * 注意：schedule 输入中 relative 的 triggerAt 是 anchor（preset 传 DDL）；已有 Reminder 的
 * triggerAt 是最终值（resolve 后）。excludeReminderId：编辑时排除自己。
 */
export function hasAssignmentReminderDuplicate(
  reminders: Reminder[],
  assignmentId: string,
  schedule: ReminderScheduleInput,
  excludeReminderId?: string
): boolean {
  // schedule：relative 需按 anchor + offset resolve 到最终时刻
  const scheduleFinal =
    schedule.timingMode === "relative"
      ? resolveReminderTriggerAt({
          timingMode: "relative",
          triggerAt: schedule.triggerAt,
          offsetMinutes: schedule.offsetMinutes,
        })
      : schedule.triggerAt;
  const target = scheduleFinal ? parseLocalDDL(scheduleFinal) : null;
  if (!target) return false;
  return reminders.some((r) => {
    if (r.targetType !== "assignment" || r.targetId !== assignmentId) return false;
    if (r.status !== "scheduled" || r.id === excludeReminderId) return false;
    const rt = parseLocalDDL(r.triggerAt);
    if (!rt) return false;
    return rt.getTime() === target.getTime();
  });
}

export type AssignmentPresetUnavailableReason = "no-ddl" | "past" | "duplicate";

export interface AssignmentPresetAvailability {
  label: string;
  offsetMinutes: number;
  available: boolean;
  reason?: AssignmentPresetUnavailableReason;
}

/** 每个 preset 的可用性（无 DDL / 解析后已过期 / 已存在重复） */
export function getAssignmentPresetAvailability(
  assignment: Assignment,
  reminders: Reminder[],
  now: string,
  excludeReminderId?: string
): AssignmentPresetAvailability[] {
  const hasDdl = !!assignment.ddl && parseLocalDDL(assignment.ddl) !== null;
  const nowDate = parseLocalDDL(now);
  return ASSIGNMENT_REMINDER_PRESETS.map((p) => {
    if (!hasDdl) {
      return { label: p.label, offsetMinutes: p.offsetMinutes, available: false, reason: "no-ddl" };
    }
    const trigger = resolveReminderTriggerAt({
      timingMode: "relative",
      triggerAt: assignment.ddl!,
      offsetMinutes: p.offsetMinutes,
    });
    const triggerDate = trigger ? parseLocalDDL(trigger) : null;
    if (!triggerDate || !nowDate || triggerDate.getTime() <= nowDate.getTime()) {
      return { label: p.label, offsetMinutes: p.offsetMinutes, available: false, reason: "past" };
    }
    if (
      hasAssignmentReminderDuplicate(
        reminders,
        assignment.id,
        { timingMode: "relative", offsetMinutes: p.offsetMinutes, triggerAt: assignment.ddl! },
        excludeReminderId
      )
    ) {
      return { label: p.label, offsetMinutes: p.offsetMinutes, available: false, reason: "duplicate" };
    }
    return { label: p.label, offsetMinutes: p.offsetMinutes, available: true };
  });
}

/** 行 label：relative → 到期时 / 提前 X（任意 offset 优雅 fallback）；absolute → 自定义时间 */
export function formatAssignmentReminderLabel(reminder: Reminder): string {
  if (reminder.timingMode === "absolute") return "自定义时间";
  const offset = reminder.offsetMinutes ?? 0;
  if (offset === 0) return "到期时";
  const abs = Math.abs(offset);
  const unit =
    abs % 1440 === 0 && abs > 0
      ? `${abs / 1440} 天`
      : abs % 60 === 0 && abs > 0
        ? `${abs / 60} 小时`
        : `${abs} 分钟`;
  return `提前 ${unit}`;
}
