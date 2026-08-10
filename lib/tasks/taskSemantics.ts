/**
 * Task V2 语义层（唯一入口）：Task ≠ Deadline ≠ StudyBlock。
 * Assignment 允许没有 DDL；预计耗时缺失 = 未知（不伪造默认值）。
 * 后续 Workspace / Timeline / Kiro Tools 一律经此取语义，不各自判断 task.ddl。
 */

import { Assignment } from "@/types";
import { parseLocalDDL, getLocalDDLDate, getLocalDDLTime } from "@/lib/ddl";

/** 预计耗时上限：7 天（防止 NaN / Infinity / 异常大值进入持久化） */
export const MAX_ESTIMATED_MINUTES = 7 * 24 * 60;

/** estimatedMinutes 清洗：仅接受有限正整数；非法 → undefined */
export function normalizeEstimatedMinutes(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(Math.min(value, MAX_ESTIMATED_MINUTES));
}

/** 是否有合法 Deadline */
export function hasTaskDeadline(task: Pick<Assignment, "ddl">): boolean {
  return parseLocalDDL(task.ddl) !== null;
}

/** Deadline → Date | null（本地墙钟语义；无 DDL 返回 null） */
export function getTaskDeadline(task: Pick<Assignment, "ddl">): Date | null {
  return parseLocalDDL(task.ddl);
}

/** Deadline 日期 "YYYY-MM-DD" | null（无 DDL 返回 null，绝不返回空串占位） */
export function getTaskDeadlineDate(task: Pick<Assignment, "ddl">): string | null {
  return hasTaskDeadline(task) ? getLocalDDLDate(task.ddl) : null;
}

/** Deadline 时间 "HH:mm" | null（无 DDL 返回 null） */
export function getTaskDeadlineTime(task: Pick<Assignment, "ddl">): string | null {
  return hasTaskDeadline(task) ? getLocalDDLTime(task.ddl) : null;
}

/** 预计耗时可读文本（UI/文案共用；无则返回 null，不得显示假时长） */
export function formatEstimatedMinutes(minutes: number | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `${minutes} 分钟`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

/** materialIds 清洗：仅保留非空 string + 去重；空结果 → undefined（无关联） */
export function normalizeMaterialIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids: string[] = [];
  for (const v of value) {
    if (typeof v === "string" && v.trim().length > 0 && !ids.includes(v)) {
      ids.push(v);
    }
  }
  return ids.length > 0 ? ids : undefined;
}

/**
 * Assignment 归一化（persist hydrate / backup restore / patch 入口共用）：
 * - ddl：字符串保留原值，非字符串/缺失 → undefined（旧数据 ddl 必然存在，原值保留）
 * - estimatedMinutes：sanitize（非法 → undefined）
 * - subtasks 缺失合法
 * - materialIds（Task 6A）：清洗（旧 Assignment 无此字段完全合法）
 * 不 throw：保证旧数据可正常 hydrate。
 */
export function normalizeAssignment(raw: unknown): Assignment {
  const a = (raw ?? {}) as Record<string, unknown>;
  const base = a as unknown as Assignment;
  const hasValidDdl = typeof a.ddl === "string" && a.ddl.length > 0;
  return {
    id: typeof a.id === "string" && a.id ? a.id : `a_${Math.random().toString(36).slice(2)}`,
    courseId: typeof a.courseId === "string" ? a.courseId : "",
    title: typeof a.title === "string" ? a.title : "未命名任务",
    description: typeof a.description === "string" ? a.description : "",
    ddl: hasValidDdl ? (a.ddl as string) : undefined,
    estimatedMinutes: normalizeEstimatedMinutes(a.estimatedMinutes),
    priority: base.priority ?? "medium",
    status: base.status ?? "todo",
    progress: typeof a.progress === "number" && a.progress >= 0 && a.progress <= 100 ? a.progress : 0,
    tags: Array.isArray(a.tags) ? a.tags.filter((t): t is string => typeof t === "string") : [],
    subtasks: Array.isArray(a.subtasks) ? (a.subtasks as Assignment["subtasks"]) : undefined,
    materialIds: normalizeMaterialIds(a.materialIds),
  };
}
