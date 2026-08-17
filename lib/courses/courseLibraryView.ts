/**
 * Course Library V5 —— Attention projection（纯函数，无 React / 无 Store）。
 * 「待处理任务」= todo | doing（submitted 已离开正常执行阶段，completed 已完成，都不算待处理）；
 * 逾期只来自 attention rows（submitted/completed 的旧 DDL 不再误算逾期 —— presentation correction）。
 * 所有 count 从同一 rows 数组派生，避免 overdueCountByCourse 与 taskRows 双轨漂移。
 */

import { CourseTaskRowView } from "@/lib/courseDetailView";

/** 是否属于「待处理」状态（Course Library 首屏 attention 语义；不改 Assignment Domain） */
export function isCourseAttentionTask(status: CourseTaskRowView["status"]): boolean {
  return status === "todo" || status === "doing";
}

export interface CourseLibraryTaskView {
  /** 待处理行（todo/doing，已按调用方排序保持） */
  attentionRows: CourseTaskRowView[];
  attentionCount: number;
  /** 待处理中逾期行数（只来自 attentionRows） */
  overdueCount: number;
  /** 全部任务行数（含 submitted/completed；Popover 完整列表用） */
  totalCount: number;
}

export function buildCourseLibraryTaskView(rows: CourseTaskRowView[]): CourseLibraryTaskView {
  const attentionRows = rows.filter((r) => isCourseAttentionTask(r.status));
  return {
    attentionRows,
    attentionCount: attentionRows.length,
    overdueCount: attentionRows.filter((r) => r.overdue).length,
    totalCount: rows.length,
  };
}
