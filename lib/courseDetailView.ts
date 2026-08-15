/**
 * Course Detail V2 —— 课程抽屉纯展示逻辑（无 React）。
 * - 相关任务展示排序（view-level，不改 store）
 * - 任务行状态/截止展示（本地墙钟）
 * - 可展开列表切片 / 课程统计文案
 * 全部 deterministic；组件不自行计算业务数字。
 */

import { Assignment } from "@/types";
import { getLocalDDLDate, parseLocalDDL } from "@/lib/ddl";

export const COURSE_TASK_STATUS_LABEL: Record<Assignment["status"], string> = {
  todo: "待完成",
  doing: "进行中",
  submitted: "已提交",
  completed: "已完成",
};

export interface CourseTaskRowView {
  id: string;
  title: string;
  status: Assignment["status"];
  statusLabel: string;
  /** 8月15日 / 无截止时间 */
  deadlineLabel: string;
  /** 有 DDL 且已过 now → 逾期（warning 语义，非纯红） */
  overdue: boolean;
  hasDdl: boolean;
}

/** 任务行截止展示：M月d日；无 DDL → 无截止时间；逾期判定用传入 now（deterministic） */
export function buildCourseTaskRow(assignment: Assignment, now: Date): CourseTaskRowView {
  const deadline = parseLocalDDL(assignment.ddl);
  const hasDdl = deadline !== null;
  const d = getLocalDDLDate(assignment.ddl);
  return {
    id: assignment.id,
    title: assignment.title,
    status: assignment.status,
    statusLabel: COURSE_TASK_STATUS_LABEL[assignment.status],
    deadlineLabel: hasDdl ? `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日` : "无截止时间",
    overdue: hasDdl ? deadline.getTime() < now.getTime() : false,
    hasDdl,
  };
}

/** 课程 Drawer 相关任务展示排序（view-level，绝不 mutate store）：
 * 组序：todo/doing → submitted → completed；
 * 组内：有 DDL 按 deadline epoch 升序（已逾期最先，其次最近未来），无 DDL 排组内最后。
 * 同 key 时按标题 localeCompare，保持 deterministic。 */
export function sortCourseAssignments(assignments: Assignment[]): Assignment[] {
  const rank = (s: Assignment["status"]): number =>
    s === "completed" ? 2 : s === "submitted" ? 1 : 0;
  const deadlineMs = (a: Assignment): number =>
    a.ddl ? (parseLocalDDL(a.ddl)?.getTime() ?? Infinity) : Infinity;
  return [...assignments].sort((a, b) => {
    const ra = rank(a.status) - rank(b.status);
    if (ra !== 0) return ra;
    const da = deadlineMs(a);
    const db = deadlineMs(b);
    if (da !== db) return da - db;
    const titleCmp = a.title.localeCompare(b.title, "zh-CN");
    if (titleCmp !== 0) return titleCmp;
    return a.id.localeCompare(b.id);
  });
}

/** 可展开列表切片：<= limit 全展示；> limit 默认前 limit，展开后全量 */
export function expandableSlice<T>(
  items: readonly T[],
  expanded: boolean,
  limit = 5
): { visible: readonly T[]; hiddenCount: number } {
  const visible = expanded ? items : items.slice(0, limit);
  return { visible, hiddenCount: Math.max(0, items.length - visible.length) };
}

/** 课程统计文案：1 个时段 · 4 个任务 · 2 份资料 */
export function formatCourseStats(
  scheduleCount: number,
  taskCount: number,
  materialCount: number
): string {
  return `${scheduleCount} 个时段 · ${taskCount} 个任务 · ${materialCount} 份资料`;
}

/** 资料 meta 行：size · uploadDate（缺失部分省略，不显示假占位） */
export function formatMaterialMeta(mat: {
  size?: string;
  uploadDate: string;
}): string {
  return [mat.size, mat.uploadDate].filter((v): v is string => !!v && v.length > 0).join(" · ");
}
