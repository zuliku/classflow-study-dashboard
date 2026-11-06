/**
 * Phase 0：Task Planning 覆盖度（纯函数，无 React / 无 Zustand）。
 *
 * 规则：
 * - 只有 active StudyBlock 才算计划；released 是历史。
 * - scheduledMinutes 只统计 active blocks。
 * - remainingMinutes 不读 progress。
 * - 没有 estimatedMinutes → remaining 未知，不能当作“已排满”。
 */

import { Assignment, StudyBlock } from "@/types";
import { timeToMinutes } from "@/lib/timeline/timelineGeometry";

export type TaskSchedulingState = "unscheduled" | "partial" | "full" | "unknown";

export function isActiveStudyBlock(block: Pick<StudyBlock, "planningState">): boolean {
  return block.planningState !== "released";
}

export function isReleasedStudyBlock(block: Pick<StudyBlock, "planningState">): boolean {
  return block.planningState === "released";
}

/** StudyBlock 分钟数；时间非法 / end <= start → 0（不让坏数据进入统计） */
export function studyBlockMinutes(block: Pick<StudyBlock, "startTime" | "endTime">): number {
  const start = timeToMinutes(block.startTime);
  const end = timeToMinutes(block.endTime);
  if (start === null || end === null || end <= start) return 0;
  return end - start;
}

/** 按 assignmentId 索引 active blocks（O(B)，避免每个任务全量 filter） */
export function indexActiveStudyBlocksByAssignment(
  studyBlocks: readonly StudyBlock[]
): Map<string, StudyBlock[]> {
  const map = new Map<string, StudyBlock[]>();
  for (const block of studyBlocks) {
    if (!isActiveStudyBlock(block) || !block.assignmentId) continue;
    const list = map.get(block.assignmentId);
    if (list) list.push(block);
    else map.set(block.assignmentId, [block]);
  }
  return map;
}

export function activeBlocksForTask(
  taskId: string,
  blocksById: Map<string, StudyBlock[]>
): StudyBlock[] {
  return blocksById.get(taskId) ?? [];
}

export function plannedActiveMinutes(
  taskId: string,
  blocksById: Map<string, StudyBlock[]>
): number {
  return activeBlocksForTask(taskId, blocksById).reduce(
    (sum, block) => sum + studyBlockMinutes(block),
    0
  );
}

/**
 * 剩余分钟：
 * - 有估时：max(0, estimate - planned)
 * - 无估时：null（未知，不伪造 0）
 */
export function remainingMinutes(
  task: Pick<Assignment, "id" | "estimatedMinutes">,
  blocksById: Map<string, StudyBlock[]>
): number | null {
  const estimate =
    typeof task.estimatedMinutes === "number" && task.estimatedMinutes > 0
      ? task.estimatedMinutes
      : null;
  if (estimate === null) return null;
  return Math.max(0, estimate - plannedActiveMinutes(task.id, blocksById));
}

/**
 * - 没有 active block → unscheduled
 * - 有 active block、无估时 → unknown
 * - 有估时且 remaining === 0 → full
 * - 否则 partial
 */
export function schedulingState(
  task: Pick<Assignment, "id" | "estimatedMinutes">,
  blocksById: Map<string, StudyBlock[]>
): TaskSchedulingState {
  const blocks = activeBlocksForTask(task.id, blocksById);
  if (blocks.length === 0) return "unscheduled";
  const remaining = remainingMinutes(task, blocksById);
  if (remaining === null) return "unknown";
  return remaining === 0 ? "full" : "partial";
}

export interface TaskPlanningFacts {
  activeBlockCount: number;
  plannedMinutes: number;
  remainingMinutes: number | null;
  schedulingState: TaskSchedulingState;
}

export function getTaskPlanningFacts(
  task: Pick<Assignment, "id" | "estimatedMinutes">,
  blocksById: Map<string, StudyBlock[]>
): TaskPlanningFacts {
  const blocks = activeBlocksForTask(task.id, blocksById);
  return {
    activeBlockCount: blocks.length,
    plannedMinutes: plannedActiveMinutes(task.id, blocksById),
    remainingMinutes: remainingMinutes(task, blocksById),
    schedulingState: schedulingState(task, blocksById),
  };
}
