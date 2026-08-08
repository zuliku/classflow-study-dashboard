import { Assignment } from "@/types";
import { getLocalDDLDate, getLocalDDLTime, combineLocalDateTime, parseLocalDDL } from "@/lib/ddl";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** DDL 是否为可解析的本地时间（历史脏数据不可拖，但可点击打开编辑） */
export function isValidDDL(ddl: string): boolean {
  return parseLocalDDL(ddl) !== null;
}

/** 时间输入是否合法 "HH:mm" */
export function isValidDDLTime(time: string): boolean {
  return TIME_RE.test((time || "").trim());
}

export interface DDLMoveResult {
  /** 更新后的 Assignment（同一 id，仅 ddl 变化） */
  assignment: Assignment;
  /** 目标日期 "yyyy-MM-dd" */
  targetDate: string;
  /** 原 ddl */
  oldDdl: string;
}

/**
 * DDL 日期拖动：只改日期，保留原截止时间（墙钟时间，无 UTC 漂移）。
 * 同日期 drop 返回 null（不产生 Store mutation，也不弹反馈）。
 * DDL 无法解析返回 null（禁止 Drag，点击仍可编辑）。
 */
export function moveAssignmentDDL(
  assignment: Assignment,
  targetDate: string
): DDLMoveResult | null {
  if (!isValidDDL(assignment.ddl)) return null;
  const oldTime = getLocalDDLTime(assignment.ddl);
  if (getLocalDDLDate(assignment.ddl) === targetDate) return null;
  return {
    assignment: { ...assignment, ddl: combineLocalDateTime(targetDate, oldTime) },
    targetDate,
    oldDdl: assignment.ddl,
  };
}

/**
 * 快速修改时间：保持新日期，替换截止时间。
 * 修改结果与原 ddl 完全相同（日期+时间都没变）返回 null。
 */
export function editAssignmentDDLTime(
  assignment: Assignment,
  targetDate: string,
  newTime: string
): DDLMoveResult | null {
  if (!isValidDDL(assignment.ddl)) return null;
  const time = (newTime || "").trim();
  if (!isValidDDLTime(time)) return null;
  const newDdl = combineLocalDateTime(targetDate, time);
  if (getLocalDDLDate(assignment.ddl) === targetDate && getLocalDDLTime(assignment.ddl) === time) {
    return null;
  }
  return { assignment: { ...assignment, ddl: newDdl }, targetDate, oldDdl: assignment.ddl };
}
