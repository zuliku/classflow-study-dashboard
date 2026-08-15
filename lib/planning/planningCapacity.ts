/**
 * Canonical Planning Capacity Engine（Planning Constraint Semantics V1.2）。
 * Planner 与 Outlook 共用的「两层容量」：
 *   Preferred Pass（非课程时间）→ 只有存在真实 allocatable 缺口才进入
 *   Soft Fallback Pass（+课程时间，其余仍 hard busy）→ 只补剩余需求
 *   Combined = merge（不把 fallback 当已授权；课程重叠仍需 Approval Gate）
 *
 * - 区间语义：Pass 2 把 Preferred projected blocks 转成临时 StudyBlocks（函数内 simulation，
 *   绝不写 Store / History / UI），再以 expanded capacity 只补剩余缺口——
 *   不用 interval subtraction，不破坏「free + course」连续可安排区间（sandwich bug 修复）。
 * - 无 multi-task global dayCap：Deadline 是 per-assignment constraint（allocator 的 slotBeforeDeadline 处理）。
 * - 单一共享容量池：每个 Scenario 内部任务间共享（绝不恢复 per-task independent）。
 */

import { Assignment, CalendarMark, CourseSchedule, Semester, StudyBlock } from "@/types";
import { findFreeTime } from "@/lib/planning/freeTime";
import {
  allocateStudyCapacity,
  CapacityAllocationResult,
  CapacityAllocationOptions,
  CapacityTaskAllocation,
} from "@/lib/planning/capacityAllocation";

export interface PlanningCapacityInput {
  assignments: Assignment[];
  studyBlocks: StudyBlock[];
  schedules: CourseSchedule[];
  calendarMarks: CalendarMark[];
  semester: Semester;
  currentSemesterWeek: number;
  fromDate: string; // "YYYY-MM-DD"
  toDate: string; // "YYYY-MM-DD"
  now: Date;
}

export type PlanningCapacityOptions = CapacityAllocationOptions;

export interface PlanningCapacitySummary {
  preferredAllocatedMinutes: number;
  preferredShortfallMinutes: number;
  /** 放宽课程约束后额外可安排的分钟（≠ 课程重叠分钟：block 可能部分是课程、部分不是） */
  additionalAllocatedWithCourseTime: number;
  combinedAllocatedMinutes: number;
  combinedShortfallMinutes: number;
  courseFallbackUsed: boolean;
}

export interface PlanningCapacityResult {
  preferred: CapacityAllocationResult;
  /** Preferred 无真实缺口 → null（不进入 Pass 2） */
  courseFallback: CapacityAllocationResult | null;
  combined: CapacityAllocationResult;
  summary: PlanningCapacitySummary;
}

/** 只统计当前模式真正参与 allocation 的任务的 shortfall（排除 missing_estimate / overdue 等非规划性缺口） */
export function getAllocatableShortfall(
  result: CapacityAllocationResult,
  options?: PlanningCapacityOptions
): number {
  return result.tasks
    .filter(
      (t) =>
        t.classification === "eligible" ||
        (options?.includeNoDeadline === true && t.classification === "no_deadline")
    )
    .reduce((s, t) => s + t.shortfallMinutes, 0);
}

/**
 * 合并两次 Allocation：
 * - allocatedMinutes / projectedBlocks 相加
 * - remainingRequiredMinutes 保持 Preferred 的原始需求（不换成 Pass 2 的 residual）
 * - shortfall = max(originalRemaining - combinedAllocated, 0)；completeCoverage 由最终 shortfall 判断
 * - 非参与分类（missing_estimate / overdue / outlook 的 no_deadline）原样保留 Preferred 语义
 */
export function mergePlanningCapacityAllocations(
  preferred: CapacityAllocationResult,
  fallback: CapacityAllocationResult | null,
  options?: PlanningCapacityOptions
): CapacityAllocationResult {
  const fallbackByAssignment = new Map(
    (fallback?.tasks ?? []).map((t) => [t.assignmentId, t])
  );

  const tasks: CapacityTaskAllocation[] = preferred.tasks.map((pref) => {
    const fb = fallbackByAssignment.get(pref.assignmentId);
    const participating =
      pref.classification === "eligible" ||
      (options?.includeNoDeadline === true && pref.classification === "no_deadline");
    if (!participating || !fb) {
      return pref; // 非参与任务：保持 Preferred 语义（缺失估时等）
    }
    const allocatedMinutes = pref.allocatedMinutes + fb.allocatedMinutes;
    const shortfallMinutes = Math.max(pref.remainingRequiredMinutes - allocatedMinutes, 0);
    return {
      ...pref,
      allocatedMinutes,
      shortfallMinutes,
      completeCoverage: shortfallMinutes === 0,
      projectedBlocks: [...pref.projectedBlocks, ...fb.projectedBlocks],
    };
  });

  const totalRemainingRequiredMinutes = tasks.reduce((s, t) => s + t.remainingRequiredMinutes, 0);
  const totalAllocatedMinutes = tasks.reduce((s, t) => s + t.allocatedMinutes, 0);
  const totalShortfallMinutes = tasks.reduce((s, t) => s + t.shortfallMinutes, 0);
  const freeMinutesInWindow =
    fallback?.freeMinutesInWindow ?? preferred.freeMinutesInWindow;
  const fullyCoveredTasks = tasks.filter(
    (t) =>
      (t.classification === "eligible" ||
        (options?.includeNoDeadline === true && t.classification === "no_deadline")) &&
      t.completeCoverage
  ).length;
  const partiallyCoveredTasks = tasks.filter(
    (t) =>
      (t.classification === "eligible" ||
        (options?.includeNoDeadline === true && t.classification === "no_deadline")) &&
      !t.completeCoverage &&
      t.allocatedMinutes > 0
  ).length;
  const uncoveredTasks = tasks.filter(
    (t) =>
      (t.classification === "eligible" ||
        (options?.includeNoDeadline === true && t.classification === "no_deadline")) &&
      t.allocatedMinutes === 0
  ).length;

  return {
    tasks,
    totalRemainingRequiredMinutes,
    totalAllocatedMinutes,
    totalShortfallMinutes,
    freeMinutesInWindow,
    unusedFreeMinutes: Math.max(freeMinutesInWindow - totalAllocatedMinutes, 0),
    fullyCoveredTasks,
    partiallyCoveredTasks,
    uncoveredTasks,
  };
}

/** 把 Preferred projected blocks 转成函数内临时 StudyBlocks（只存在于本次 simulation） */
function toSimulatedStudyBlocks(tasks: CapacityTaskAllocation[]): StudyBlock[] {
  const out: StudyBlock[] = [];
  for (const t of tasks) {
    for (let i = 0; i < t.projectedBlocks.length; i++) {
      const b = t.projectedBlocks[i];
      out.push({
        id: `capacity_pref_${t.assignmentId}_${i}`,
        title: t.title,
        date: b.date,
        startTime: b.startTime,
        endTime: b.endTime,
        assignmentId: t.assignmentId,
        courseId: t.courseId ?? undefined,
        source: "kiro",
      });
    }
  }
  return out;
}

/**
 * 构建 Portfolio 两层容量（Planner / Outlook 唯一入口；单次构建，不逐任务重复查询）。
 * 最多 2 × findFreeTime + 2 × allocation。
 */
export function buildPlanningCapacity(
  input: PlanningCapacityInput,
  options?: PlanningCapacityOptions
): PlanningCapacityResult {
  const from = new Date(`${input.fromDate}T00:00:00`);
  const to = new Date(`${input.toDate}T23:59:59`);

  const baseQuery = {
    start: from,
    now: input.now,
    end: to,
    semester: input.semester,
    currentSemesterWeek: input.currentSemesterWeek,
    schedules: input.schedules,
    calendarMarks: input.calendarMarks,
    studyBlocks: input.studyBlocks,
  };

  // ---- Pass 1：Preferred（非课程时间）----
  const preferredSlots = findFreeTime(baseQuery);
  const preferred = allocateStudyCapacity(
    {
      assignments: input.assignments,
      studyBlocks: input.studyBlocks,
      freeSlots: preferredSlots,
      fromDate: input.fromDate,
      toDate: input.toDate,
      now: input.now,
    },
    options
  );

  const allocatableShortfall = getAllocatableShortfall(preferred, options);

  // ---- Pass 2：只有真实 allocatable 缺口才进入（否则 courseFallback=null）----
  let courseFallback: CapacityAllocationResult | null = null;
  if (allocatableShortfall > 0) {
    const simulatedStudyBlocks = [...input.studyBlocks, ...toSimulatedStudyBlocks(preferred.tasks)];
    const expandedSlots = findFreeTime({
      ...baseQuery,
      studyBlocks: simulatedStudyBlocks,
      includeCourseTime: true, // 课程不再 busy；Exam/Activity/已有块/Preferred projected 仍 busy
    });
    courseFallback = allocateStudyCapacity(
      {
        assignments: input.assignments,
        studyBlocks: simulatedStudyBlocks, // Preferred blocks 计入 scheduled → 只补剩余需求
        freeSlots: expandedSlots,
        fromDate: input.fromDate,
        toDate: input.toDate,
        now: input.now,
      },
      options
    );
  }

  const combined = mergePlanningCapacityAllocations(preferred, courseFallback, options);

  const additionalAllocatedWithCourseTime = Math.max(
    combined.totalAllocatedMinutes - preferred.totalAllocatedMinutes,
    0
  );

  return {
    preferred,
    courseFallback,
    combined,
    summary: {
      preferredAllocatedMinutes: preferred.totalAllocatedMinutes,
      preferredShortfallMinutes: preferred.totalShortfallMinutes,
      additionalAllocatedWithCourseTime,
      combinedAllocatedMinutes: combined.totalAllocatedMinutes,
      combinedShortfallMinutes: combined.totalShortfallMinutes,
      courseFallbackUsed: additionalAllocatedWithCourseTime > 0,
    },
  };
}
