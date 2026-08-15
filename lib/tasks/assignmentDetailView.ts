/**
 * Task/DDL Detail Panel UX Refresh —— 详情面板纯展示逻辑（无 React）。
 * - Deadline 主文案 / 剩余或逾期时间（本地墙钟，禁 UTC）
 * - 学习安排摘要（已安排时长 · 时段数）
 * - Reminder 摘要（自动默认 / 数量 / opt-out）
 * 全部 deterministic；组件不自行计算业务数字。
 */

import { Assignment, Reminder, StudyBlock } from "@/types";
import { parseLocalDDL } from "@/lib/ddl";
import { formatEstimatedMinutes } from "@/lib/tasks/taskSemantics";
import { formatAssignmentReminderLabel } from "@/lib/reminders/assignmentReminderView";

export interface DeadlineView {
  hasDdl: boolean;
  /** 主文案：今天 20:00 / 明天 20:00 / 8月18日 周二 · 23:59 */
  primary: string;
  /** 剩余 / 逾期文案：还有 8 小时 / 已逾期 2 小时；无 DDL → null */
  relative: string | null;
  overdue: boolean;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const WEEKDAY = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 相对时长（分钟粒度向上取整到显示单位） */
export function formatRelativeDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时`;
  return `${Math.round(hours / 24)} 天`;
}

/** Deadline 主文案 + 剩余/逾期（全部本地墙钟 epoch 运算） */
export function formatDeadlineView(ddl: string | undefined, now: Date): DeadlineView {
  const deadline = parseLocalDDL(ddl);
  if (!deadline) {
    return { hasDdl: false, primary: "未设置截止时间", relative: null, overdue: false };
  }
  const nowD = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dlD = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate());
  const dayDiff = Math.round((dlD.getTime() - nowD.getTime()) / 86400000);
  const time = `${pad2(deadline.getHours())}:${pad2(deadline.getMinutes())}`;
  let primary: string;
  if (dayDiff === 0) primary = `今天 ${time}`;
  else if (dayDiff === 1) primary = `明天 ${time}`;
  else if (dayDiff === -1) primary = `昨天 ${time}`;
  else primary = `${deadline.getMonth() + 1}月${deadline.getDate()}日 ${WEEKDAY[deadline.getDay()]} · ${time}`;

  const diffMs = deadline.getTime() - now.getTime();
  const overdue = diffMs < 0;
  return {
    hasDdl: true,
    primary,
    relative: overdue ? `已逾期 ${formatRelativeDuration(-diffMs)}` : `还有 ${formatRelativeDuration(diffMs)}`,
    overdue,
  };
}

export interface StudyScheduleSummary {
  hasBlocks: boolean;
  minutes: number;
  blockCount: number;
  /** 按日期 + 开始时间升序的时段行 */
  lines: { id: string; date: string; startTime: string; endTime: string }[];
}

function timeToMin(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return Number.isFinite(v) ? v : null;
}

/** 学习安排摘要：总时长（分钟） + 时段数 + 有序行（end <= start 的非法块不计时长） */
export function summarizeStudySchedule(blocks: StudyBlock[]): StudyScheduleSummary {
  const lines = [...blocks]
    .filter((b) => timeToMin(b.startTime) !== null && timeToMin(b.endTime) !== null)
    .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`))
    .map((b) => ({ id: b.id, date: b.date, startTime: b.startTime, endTime: b.endTime }));
  let minutes = 0;
  for (const b of blocks) {
    const s = timeToMin(b.startTime);
    const e = timeToMin(b.endTime);
    if (s === null || e === null || e <= s) continue;
    minutes += e - s;
  }
  return { hasBlocks: lines.length > 0, minutes, blockCount: lines.length, lines };
}

export interface ReminderSummary {
  /** scheduled reminder 总数（auto + manual/custom） */
  count: number;
  /** 存在 scheduled source=auto */
  hasAuto: boolean;
  /** auto 提前量文案（提前 1 小时 / 到期时）；无 auto → null */
  autoLabel: string | null;
  /** 目标 opt-out（autoReminderDisabled === true） */
  disabled: boolean;
}

/** Reminder 摘要（用于 Hero / 提醒 disclosure 的 collapsed 文案） */
export function summarizeReminders(
  reminders: Reminder[],
  targetType: "assignment" | "calendarMark",
  targetId: string,
  autoReminderDisabled: boolean
): ReminderSummary {
  const scheduled = reminders.filter(
    (r) => r.targetType === targetType && r.targetId === targetId && r.status === "scheduled"
  );
  const auto = scheduled.find((r) => r.source === "auto");
  return {
    count: scheduled.length,
    hasAuto: !!auto,
    autoLabel: auto ? formatAssignmentReminderLabel(auto) : null,
    disabled: autoReminderDisabled === true,
  };
}

/** 提醒 collapsed 摘要文案：默认提醒 · 提前 X / N 个提醒 / 默认提醒：已关闭 / 无提醒 */
export function formatReminderSummaryText(summary: ReminderSummary): string {
  if (summary.disabled && summary.count === 0) return "默认提醒：已关闭";
  if (summary.hasAuto && summary.count === 1 && summary.autoLabel) {
    return `默认提醒 · ${summary.autoLabel}`;
  }
  if (summary.count > 0) return `${summary.count} 个提醒`;
  return "无提醒";
}

/** 学习安排 collapsed 摘要文案：未安排学习时间 / 已安排 2 小时 · 2 个时段 */
export function formatScheduleSummaryText(summary: StudyScheduleSummary, estimatedMinutes?: number): string {
  if (!summary.hasBlocks) return "未安排学习时间";
  const total = formatEstimatedMinutes(summary.minutes) ?? `${summary.minutes} 分钟`;
  const base = `已安排 ${total} · ${summary.blockCount} 个时段`;
  if (estimatedMinutes) {
    const est = formatEstimatedMinutes(estimatedMinutes);
    return `${base} / 预计 ${est ?? `${estimatedMinutes} 分钟`}`;
  }
  return base;
}

/** 主操作是否「已完成」语义（决定 完成/重新打开 切换） */
export function isCompletedStatus(a: Pick<Assignment, "status">): boolean {
  return a.status === "completed";
}
