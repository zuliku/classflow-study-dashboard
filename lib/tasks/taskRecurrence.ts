/**
 * Task 7F：Recurring Tasks V1（纯函数，无 Zustand）。
 * completion-driven recurrence：只有完成当前 occurrence 时才生成下一次。
 * DDL 一律本地墙钟（无 UTC 转换）；monthly 月末按目标月真实天数 clamp。
 */

import { addDays } from "date-fns";
import { Assignment, TaskRecurrence } from "@/types";
import { combineLocalDateTime, getLocalDDLTime, parseLocalDDL } from "@/lib/ddl";
import { createId } from "@/lib/utils";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 重复规则展示文案（Drawer / Table 共用） */
export const RECURRENCE_LABELS: Record<TaskRecurrence, string> = {
  daily: "每天",
  weekly: "每周",
  biweekly: "每两周",
  monthly: "每月",
};

/**
 * 下一次 occurrence 的 DDL：
 * - daily +1 天 / weekly +7 天 / biweekly +14 天
 * - monthly → 下一个自然月同一天（1月31日 → 2月最后一天；不溢出到下一月）
 * 保持原始 HH:mm；无有效 DDL / 无 recurrence → null。
 */
export function getNextRecurringDDL(
  ddl: string | undefined,
  recurrence: TaskRecurrence | undefined
): string | null {
  if (!recurrence || !ddl) return null;
  const d = parseLocalDDL(ddl);
  if (!d) return null;

  let next: Date;
  if (recurrence === "monthly") {
    // 目标月 = 当前月 + 1（12月 → 次年 1月）；clamp 到目标月最后一天
    const nextMonthIdx = (d.getMonth() + 1) % 12;
    const nextYear = d.getFullYear() + (d.getMonth() === 11 ? 1 : 0);
    const lastDay = new Date(nextYear, nextMonthIdx + 1, 0).getDate();
    next = new Date(
      nextYear,
      nextMonthIdx,
      Math.min(d.getDate(), lastDay),
      d.getHours(),
      d.getMinutes(),
      d.getSeconds() || 0,
      0
    );
  } else {
    const days = recurrence === "daily" ? 1 : recurrence === "weekly" ? 7 : 14;
    next = addDays(d, days);
  }

  const dateStr = `${next.getFullYear()}-${pad2(next.getMonth() + 1)}-${pad2(next.getDate())}`;
  return combineLocalDateTime(dateStr, getLocalDDLTime(ddl));
}

/**
 * 构建下一次 occurrence（不含 id；调用方（Store）负责 createId + CalendarMark）：
 * - 复制：courseId/title/description/estimatedMinutes/priority/tags/materialIds/recurrence/seriesId
 * - 重置：status=todo / progress=0 / subtasks 全新 ID 且全部未完成
 * - 不复制 StudyBlock（新 occurrence 应重新安排）
 * 条件：有 recurrence + status completed + 有效 DDL；否则 null。
 */
export function buildNextRecurringAssignment(
  current: Assignment
): Omit<Assignment, "id"> | null {
  if (!current.recurrence || current.status !== "completed") return null;
  const nextDdl = getNextRecurringDDL(current.ddl, current.recurrence);
  if (!nextDdl) return null;

  return {
    courseId: current.courseId,
    title: current.title,
    description: current.description,
    ddl: nextDdl,
    estimatedMinutes: current.estimatedMinutes,
    priority: current.priority,
    status: "todo",
    progress: 0,
    tags: [...current.tags],
    subtasks: current.subtasks?.map((st) => ({
      id: createId("st"),
      title: st.title,
      completed: false,
    })),
    materialIds: current.materialIds ? [...current.materialIds] : undefined,
    recurrence: current.recurrence,
    recurrenceSeriesId: current.recurrenceSeriesId,
    recurrenceParentId: current.id,
  };
}
