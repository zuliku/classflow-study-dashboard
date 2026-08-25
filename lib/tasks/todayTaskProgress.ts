/**
 * Workflow UX Sidebar Productization V2.2 —— 今日任务进度（纯函数，不触碰 Store）。
 *
 * 今日任务定义（唯一口径）：
 * - parseLocalDDL(assignment.ddl) 存在且 isToday(parsed) —— 无 DDL / 明天 / 逾期 / 非法 DDL 不计入
 * - 不根据 StudyBlock / createdAt / updatedAt 猜测
 *
 * Denominator 稳定：submitted / completed 仍留在 total 中
 * （5 个今日任务完成 1 个 → 1 / 5，而不是 1 / 4）。
 *
 * Done semantics：status === "submitted" || "completed"
 * —— 与 Planning Eligibility（todo/doing = active；submitted/completed = terminal）一致；
 * doing progress=100 不额外计一次 done。
 */

import { Assignment } from "@/types";
import { parseLocalDDL } from "@/lib/ddl";
import { isSameDay } from "date-fns";

export interface TodayTaskProgress {
  total: number;
  done: number;
  percentage: number;
}

export function getTodayTaskProgress(
  assignments: Assignment[],
  now: Date = new Date()
): TodayTaskProgress {
  let total = 0;
  let done = 0;
  for (const a of assignments) {
    const ddl = parseLocalDDL(a.ddl);
    // 以调用方注入的 now（本地墙钟）比较——不读系统时钟，保证 deterministic / 可测
    if (!ddl || !isSameDay(ddl, now)) continue;
    total += 1;
    if (a.status === "submitted" || a.status === "completed") done += 1;
  }
  return {
    total,
    done,
    percentage: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}
