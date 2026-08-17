/**
 * Task 7G-A1：Reminder Domain（纯函数，不读 Zustand）。
 * - relative：triggerAt = target anchor + offsetMinutes（跟随目标时间）
 * - absolute：triggerAt 恒为用户指定时间（永不跟随）
 * - 全部本地墙钟语义（禁 toISOString）
 * - 未来：Local Reminder Runtime → Cloud Scheduler / Web Push（Domain 不依赖浏览器 Notification API）
 */

import {
  MissedReminderPolicy,
  Reminder,
  ReminderSource,
  ReminderStatus,
  ReminderTargetType,
  ReminderTimingMode,
} from "@/types";
import { combineLocalDateTime } from "@/lib/ddl";
import { parseLocalDDL } from "@/lib/ddl";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 本地 Date → "YYYY-MM-DDTHH:mm:ss"（墙钟，无 UTC 偏移） */
export function formatLocalDateTime(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

/** date + startTime → 本地墙钟 "YYYY-MM-DDTHH:mm:ss"；非法 → null（不伪造 00:00） */
function combineDateStartTime(date: string, startTime: string | undefined): string | null {
  if (!DATE_RE.test(date) || !startTime || !TIME_RE.test(startTime)) return null;
  return combineLocalDateTime(date, startTime);
}

/**
 * Target 时间锚点（relative reminder 的基准）：
 * - assignment：Assignment.ddl（无有效 DDL → null）
 * - studyBlock：date + startTime
 * - calendarMark：仅存在 startTime 时（全天事件 → null，只能 absolute）
 * - standalone：恒 null
 */
export function getReminderTargetAnchor(
  targetType: ReminderTargetType,
  target: { ddl?: string; date?: string; startTime?: string }
): string | null {
  switch (targetType) {
    case "assignment":
      return target.ddl && parseLocalDDL(target.ddl) ? target.ddl : null;
    case "studyBlock":
      return combineDateStartTime(target.date ?? "", target.startTime);
    case "calendarMark":
      return combineDateStartTime(target.date ?? "", target.startTime);
    case "standalone":
      return null;
  }
}

/**
 * 解析 triggerAt：
 * - absolute：直接验证并返回原 triggerAt
 * - relative：anchor + offsetMinutes（分钟运算基于 epoch，无时区漂移）
 * 非法 → null。
 */
export function resolveReminderTriggerAt(input: {
  timingMode: ReminderTimingMode;
  triggerAt: string;
  offsetMinutes?: number;
}): string | null {
  const { timingMode, triggerAt, offsetMinutes } = input;
  const base = parseLocalDDL(triggerAt);
  if (!base) return null;
  if (timingMode === "absolute") return triggerAt;
  if (typeof offsetMinutes !== "number" || !Number.isFinite(offsetMinutes)) return null;
  return formatLocalDateTime(new Date(base.getTime() + offsetMinutes * 60_000));
}

const TARGET_TYPES: ReminderTargetType[] = ["assignment", "studyBlock", "calendarMark", "standalone"];
const TIMING_MODES: ReminderTimingMode[] = ["relative", "absolute"];
const STATUSES: ReminderStatus[] = ["scheduled", "fired", "skipped"];

/** 校验并归一 Reminder；不能安全修复的 → null（不猜值） */
export function normalizeReminder(raw: unknown): Reminder | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (!TARGET_TYPES.includes(r.targetType as ReminderTargetType)) return null;
  if (!TIMING_MODES.includes(r.timingMode as ReminderTimingMode)) return null;
  if (!STATUSES.includes(r.status as ReminderStatus)) return null;
  if (typeof r.title !== "string" || r.title.trim().length === 0) return null;
  if (typeof r.triggerAt !== "string" || !parseLocalDDL(r.triggerAt)) return null;
  if (typeof r.id !== "string" || r.id.length === 0) return null;

  const targetType = r.targetType as ReminderTargetType;
  const timingMode = r.timingMode as ReminderTimingMode;
  if (targetType === "standalone") {
    if (timingMode === "relative") return null; // standalone 只能 absolute
    if (r.targetId !== undefined && r.targetId !== null && r.targetId !== "") return null;
  } else if (typeof r.targetId !== "string" || r.targetId.length === 0) {
    return null;
  }
  if (timingMode === "relative" && (typeof r.offsetMinutes !== "number" || !Number.isFinite(r.offsetMinutes))) {
    return null;
  }

  return {
    id: r.id,
    title: r.title.trim(),
    note: typeof r.note === "string" ? r.note : undefined,
    targetType,
    targetId: targetType === "standalone" ? undefined : (r.targetId as string),
    timingMode,
    offsetMinutes: timingMode === "relative" ? (r.offsetMinutes as number) : undefined,
    triggerAt: r.triggerAt,
    status: r.status as ReminderStatus,
    firedAt: typeof r.firedAt === "string" ? r.firedAt : undefined,
    readAt: typeof r.readAt === "string" ? r.readAt : undefined,
    source: (r.source === "kiro" ? "kiro" : r.source === "auto" ? "auto" : "manual") as ReminderSource,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
  };
}

/**
 * Target 时间变化后的同步（Store mutation 调用）：
 * - 只重算匹配 target 的 scheduled relative reminders
 * - absolute / fired / skipped 永不改
 * - anchor 消失（如 DDL 被删除）→ scheduled relative 移除（不自动变 absolute）
 */
export function reconcileTargetReminders(
  reminders: Reminder[],
  targetType: ReminderTargetType,
  targetId: string,
  anchor: string | null,
  now: string
): Reminder[] {
  return reminders
    .map((r): Reminder | null => {
      if (r.targetType !== targetType || r.targetId !== targetId) return r;
      if (r.status !== "scheduled" || r.timingMode === "absolute") return r;
      if (anchor === null) return null;
      const nextTrigger = resolveReminderTriggerAt({
        timingMode: "relative",
        triggerAt: anchor,
        offsetMinutes: r.offsetMinutes,
      });
      if (!nextTrigger) return null;
      return { ...r, triggerAt: nextTrigger, updatedAt: now };
    })
    .filter((r): r is Reminder => r !== null);
}

export type MissedReminderDecision = "deliver" | "skip" | "pending";

/**
 * Missed Reminder Policy（纯决策，Runtime 消费）：
 * 仅处理 scheduled 且 triggerAt <= now；未到时间 / 非 scheduled → "pending"。
 * - deliver：全部 deliver
 * - skip：全部 skip
 * - recent-only：now - triggerAt <= windowHours → deliver；否则 skip
 */
export function evaluateMissedReminder(input: {
  reminder: Reminder;
  now: string;
  policy: MissedReminderPolicy;
  windowHours: 1 | 6 | 24;
}): MissedReminderDecision {
  const { reminder, now, policy, windowHours } = input;
  if (reminder.status !== "scheduled") return "pending";
  const nowDate = parseLocalDDL(now);
  const trigger = parseLocalDDL(reminder.triggerAt);
  if (!nowDate || !trigger || trigger.getTime() > nowDate.getTime()) return "pending";
  if (policy === "deliver") return "deliver";
  if (policy === "skip") return "skip";
  const overdueMs = nowDate.getTime() - trigger.getTime();
  return overdueMs <= windowHours * 60 * 60 * 1000 ? "deliver" : "skip";
}
