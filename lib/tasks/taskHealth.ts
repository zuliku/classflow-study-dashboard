/**
 * Task V2 Deadline Health（纯函数，无 AI、无 React）。
 * 关注「规划覆盖程度」：Task ≠ Deadline ≠ StudyBlock。
 * - 无 Deadline / 无 estimatedMinutes → unknown（不伪造风险，禁止默认 60min）
 * - scheduledMinutes 只统计 Deadline 之前的 StudyBlock
 * - 不使用 progress 伪造实际耗时（progress 不是 time tracking）
 */

import { Assignment, StudyBlock } from "@/types";
import { parseLocalDDL } from "@/lib/ddl";
import { timeToMinutes } from "@/lib/timeline/timelineGeometry";

export type TaskHealthState =
  | "safe"
  | "attention"
  | "at-risk"
  | "overdue"
  | "unscheduled"
  | "unknown";

export type TaskHealthReason =
  | "missing_deadline"
  | "missing_estimate"
  | "overdue"
  | "insufficient_available_time"
  | "not_scheduled"
  | "partially_scheduled"
  | "deadline_soon"
  | "fully_scheduled";

export interface TaskHealthInput {
  assignment: Assignment;
  studyBlocks: StudyBlock[];
  now: Date;
  /** 截止前可用空闲分钟（Free Time Engine 提供；缺省 = 无法判断 at-risk） */
  availableMinutesBeforeDeadline?: number;
}

export interface TaskHealthResult {
  assignmentId: string;
  state: TaskHealthState;
  /** 本地 wall-clock DDL 原文（无 DDL 时不出现） */
  deadline?: string;
  minutesUntilDeadline?: number;
  estimatedMinutes?: number;
  /** 截止之前已安排的计划分钟和（Deadline 后的 StudyBlock 不计入） */
  scheduledMinutesBeforeDeadline: number;
  /** max(estimated - scheduled, 0) */
  unscheduledMinutes?: number;
  availableMinutesBeforeDeadline?: number;
  reasons: TaskHealthReason[];
}

/** 该 StudyBlock 是否完全落在 Deadline 之前（同日比较 end <= deadline 时刻） */
function blockBeforeDeadline(
  b: StudyBlock,
  deadlineDate: string,
  deadlineMinutes: number
): boolean {
  if (b.date < deadlineDate) return true;
  if (b.date > deadlineDate) return false;
  const end = timeToMinutes(b.endTime);
  return end !== null && end <= deadlineMinutes;
}

export function deriveAssignmentHealth(input: TaskHealthInput): TaskHealthResult {
  const { assignment, studyBlocks, now } = input;
  const deadline = parseLocalDDL(assignment.ddl);

  const base: TaskHealthResult = {
    assignmentId: assignment.id,
    state: "unknown",
    scheduledMinutesBeforeDeadline: 0,
    reasons: [],
  };

  // 1. 无 Deadline → unknown（合法状态，不是风险）
  if (!deadline) {
    return { ...base, reasons: ["missing_deadline"] };
  }
  base.deadline = assignment.ddl;
  base.minutesUntilDeadline = Math.max(
    0,
    Math.round((deadline.getTime() - now.getTime()) / 60000)
  );

  // 2. 已过 Deadline 且未提交/未完成 → overdue
  if (deadline.getTime() <= now.getTime()) {
    if (assignment.status !== "submitted" && assignment.status !== "completed") {
      return { ...base, state: "overdue", reasons: ["overdue"] };
    }
  }

  // 3. 无 estimatedMinutes → unknown（不知道需要多少时间，不伪造）
  if (!assignment.estimatedMinutes || assignment.estimatedMinutes <= 0) {
    return { ...base, reasons: ["missing_estimate"] };
  }
  base.estimatedMinutes = assignment.estimatedMinutes;

  // 4. 只统计 Deadline 之前的 StudyBlock（非法块 end<=start 跳过）
  // 本地墙钟日期（与 ddl 字符串语义一致）：直接用 assignment.ddl 前 10 位
  const dlDateStr = assignment.ddl!.slice(0, 10);
  const dlMinutes = deadline.getHours() * 60 + deadline.getMinutes();
  const scheduled = studyBlocks
    .filter((b) => b.assignmentId === assignment.id && blockBeforeDeadline(b, dlDateStr, dlMinutes))
    .reduce((sum, b) => {
      const s = timeToMinutes(b.startTime);
      const e = timeToMinutes(b.endTime);
      if (s === null || e === null || e <= s) return sum;
      return sum + (e - s);
    }, 0);
  base.scheduledMinutesBeforeDeadline = scheduled;

  // 5. 已排满 → safe（前提：Deadline 未过）
  if (scheduled >= assignment.estimatedMinutes) {
    return { ...base, state: "safe", reasons: ["fully_scheduled"] };
  }

  base.unscheduledMinutes = Math.max(assignment.estimatedMinutes - scheduled, 0);

  const available = input.availableMinutesBeforeDeadline;

  // 6. 可用时间已知：不足 → at-risk（最重要的确定性风险判断）
  if (available !== undefined && available < base.unscheduledMinutes) {
    base.availableMinutesBeforeDeadline = available;
    return { ...base, state: "at-risk", reasons: ["insufficient_available_time"] };
  }

  // 7. 一个 Block 都没排（仍有足够 Free Time 或未知）→ unscheduled（“还没排计划”，不是危险）
  if (scheduled === 0) {
    if (available !== undefined) base.availableMinutesBeforeDeadline = available;
    return { ...base, state: "unscheduled", reasons: ["not_scheduled"] };
  }

  // 8. 部分已排 → attention；Deadline < 24h 且未覆盖完全 → 同样 attention（附加 deadline_soon）
  base.availableMinutesBeforeDeadline = available;
  const reasons: TaskHealthReason[] = ["partially_scheduled"];
  if (base.minutesUntilDeadline !== undefined && base.minutesUntilDeadline < 24 * 60) {
    reasons.push("deadline_soon");
  }
  return { ...base, state: "attention", reasons };
}
