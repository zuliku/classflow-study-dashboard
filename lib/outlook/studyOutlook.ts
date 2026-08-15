/**
 * Study Outlook（Analytics V2 · Part 3/4）确定性前瞻引擎（纯函数，无 AI）。
 * 只读取 current state + 预构建 calibration；复用 deriveAssignmentHealth / findFreeTime /
 * Capacity Allocator（与 Study Planner 共用同一共享容量算法）。
 * Outlook 不写任何数据；calibration 只作为 task 的只读参考 metadata。
 */

import { parseLocalDDL } from "@/lib/ddl";
import { findFreeTime, FreeTimeSlot } from "@/lib/planning/freeTime";
import { deriveAssignmentHealth } from "@/lib/tasks/taskHealth";
import { buildPlanningCapacity } from "@/lib/planning/planningCapacity";
import {
  OutlookTask,
  StudyOutlook,
  StudyOutlookBuildInput,
  StudyOutlookSummary,
  OutlookTaskEstimateCalibration,
  OutlookHealth,
  CapacityCheckpoint,
} from "@/lib/outlook/types";

export const OUTLOOK_MAX_TASKS = 8;

const HEALTH_RANK: Record<OutlookHealth, number> = {
  overdue: 0,
  "at-risk": 1,
  attention: 2,
  unscheduled: 3,
  unknown: 4,
  safe: 5,
};

const pad2 = (n: number) => String(n).padStart(2, "0");

function dateStrOf(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function localDateStrToMs(date: string, hour = 23, minute = 59, second = 59): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, minute, second, 999).getTime();
}

function slotMinutes(slot: FreeTimeSlot): number {
  const [sh, sm] = slot.startTime.split(":").map(Number);
  const [eh, em] = slot.endTime.split(":").map(Number);
  const minutes = eh * 60 + em - (sh * 60 + sm);
  return Math.max(0, minutes);
}

/** course 校准优先，fallback global；只读参考 */
function pickCalibrationRef(
  input: StudyOutlookBuildInput,
  courseId: string | null,
  estimatedMinutes: number | null
): OutlookTaskEstimateCalibration | undefined {
  if (estimatedMinutes === null || estimatedMinutes <= 0) return undefined;
  const cal = input.calibration;
  if (cal.status !== "ready" || cal.medianRatio === null) return undefined;
  if (courseId !== null) {
    const course = cal.byCourse.find((c) => c.courseId === courseId && c.status === "ready" && c.medianRatio !== null);
    if (course && course.medianRatio !== null) {
      return { source: "course", medianRatio: course.medianRatio, sampleCount: course.sampleCount };
    }
  }
  return { source: "global", medianRatio: cal.medianRatio, sampleCount: cal.sampleCount };
}

export function buildStudyOutlook(input: StudyOutlookBuildInput): StudyOutlook {  const { assignments, studyBlocks, schedules, calendarMarks, semester, currentSemesterWeek, horizonDays, now, calibration } = input;

  const horizonEnd = new Date(now.getTime() + horizonDays * 86400000);
  horizonEnd.setHours(23, 59, 59, 999);

  // 1. Task selection：active（todo/doing）；DDL 在 horizon 内或已 overdue
  const active = assignments.filter((a) => a.status === "todo" || a.status === "doing");
  const noDeadline = active.filter((a) => !a.ddl || !parseLocalDDL(a.ddl));
  const selected = active.filter((a) => {
    if (!a.ddl) return false;
    const dl = parseLocalDDL(a.ddl);
    if (!dl) return false;
    // overdue：Deadline 已过；或 DDL 在 [now, horizonEnd]
    return dl.getTime() <= horizonEnd.getTime();
  });

  // 2. Free Time Facts（单次构建；now → horizonEnd；DDL 当天受 cap 影响）
  const freeSlots = findFreeTime({
    start: now,
    end: horizonEnd,
    semester,
    currentSemesterWeek,
    schedules,
    calendarMarks,
    studyBlocks,
  });

  const totalFreeMinutes = freeSlots.reduce((s, slot) => s + slotMinutes(slot), 0);

  const deadlineOf = (dl: string | null): number | null => {
    if (!dl) return null;
    const d = parseLocalDDL(dl);
    return d ? d.getTime() : null;
  };

  // 3. Canonical Planning Capacity（V1.2：Preferred 非课程时间 + Combined soft fallback；只算 eligible）
  const capacity = buildPlanningCapacity(
    {
      assignments: selected,
      studyBlocks,
      schedules,
      calendarMarks,
      semester,
      currentSemesterWeek,
      fromDate: dateStrOf(now),
      toDate: dateStrOf(horizonEnd),
      now,
    },
    { includeNoDeadline: false }
  );
  const preferredByAssignment = new Map(
    capacity.preferred.tasks.map((t) => [t.assignmentId, t])
  );
  const combinedByAssignment = new Map(
    capacity.combined.tasks.map((t) => [t.assignmentId, t])
  );
  const fallbackByAssignment = new Map(
    (capacity.courseFallback?.tasks ?? []).map((t) => [t.assignmentId, t])
  );
  const allocBlockByDate = new Map<string, number>();
  for (const t of capacity.combined.tasks) {
    for (const b of t.projectedBlocks) {
      allocBlockByDate.set(b.date, (allocBlockByDate.get(b.date) ?? 0) + b.minutes);
    }
  }

  // 4. 每个任务：health（复用 deriveAssignmentHealth）+ raw free minutes + 共享容量 facts
  const tasks: OutlookTask[] = selected.map((a) => {
    const deadlineMs = deadlineOf(a.ddl ?? null);
    const availableEnd = deadlineMs !== null ? Math.min(deadlineMs, horizonEnd.getTime()) : horizonEnd.getTime();
    const rawFreeBeforeDeadline = freeSlots
      .filter((slot) => {
        // slot 的精确结束时刻（秒级 0：与 parseLocalDDL 的精确 ms 直接比较，DDL 当天 end<=DDL 时刻视为可用）
        const slotEnd = localDateStrToMs(slot.date, ...parseTime(slot.endTime), 0);
        const slotStart = localDateStrToMs(slot.date, ...parseTime(slot.startTime), 0);
        return slotStart < availableEnd && slotEnd <= availableEnd && slotStart >= now.getTime();
      })
      .reduce((s, slot) => s + slotMinutes(slot), 0);

    const healthResult = deriveAssignmentHealth({
      assignment: a,
      studyBlocks,
      now,
      availableMinutesBeforeDeadline: a.ddl ? rawFreeBeforeDeadline : undefined,
    });

    const alloc = preferredByAssignment.get(a.id);
    const combined = combinedByAssignment.get(a.id);
    const fallback = fallbackByAssignment.get(a.id);
    const isEligible = (t: typeof alloc | undefined) =>
      t !== undefined && t.classification === "eligible";
    const capacityComplete = isEligible(alloc) ? alloc!.completeCoverage : null;
    const reasons: string[] = [...healthResult.reasons];
    // Deadline 后仍有自己的 StudyBlock：不影响 coverage，但占用真实 free time（提示用）
    if (a.ddl && hasStudyBlocksAfterDeadline(a, studyBlocks)) {
      if (!reasons.includes("scheduled_after_deadline")) reasons.push("scheduled_after_deadline");
    }

    return {
      assignmentId: a.id,
      title: a.title,
      courseId: a.courseId ?? null,
      courseName: "",
      deadline: a.ddl ?? null,
      estimatedMinutes: a.estimatedMinutes ?? null,
      scheduledMinutesBeforeDeadline: healthResult.scheduledMinutesBeforeDeadline,
      unscheduledMinutes: healthResult.unscheduledMinutes ?? null,
      availableMinutesBeforeDeadline: a.ddl ? rawFreeBeforeDeadline : null,
      // Preferred（非课程时间）容量
      capacityAllocatedMinutes: isEligible(alloc) ? alloc!.allocatedMinutes : null,
      capacityShortfallMinutes: isEligible(alloc) ? alloc!.shortfallMinutes : null,
      capacityComplete,
      // V1.2：soft fallback 与 combined
      courseFallbackAllocatedMinutes:
        isEligible(fallback) && fallback!.allocatedMinutes > 0 ? fallback!.allocatedMinutes : null,
      combinedCapacityAllocatedMinutes: isEligible(combined) ? combined!.allocatedMinutes : null,
      combinedCapacityShortfallMinutes: isEligible(combined) ? combined!.shortfallMinutes : null,
      combinedCapacityComplete: isEligible(combined) ? combined!.completeCoverage : null,
      health: healthResult.state,
      reasons,
      estimateCalibration: pickCalibrationRef(input, a.courseId ?? null, a.estimatedMinutes ?? null),
    };
  });

  // 课程名（来自 state.courses）
  const courseNames = new Map<string, string>();
  for (const c of input.courses) courseNames.set(c.id, c.name);
  const tasksWithCourses = tasks.map((t) => ({
    ...t,
    courseName: t.courseId ? (courseNames.get(t.courseId) ?? "") : "",
  }));

  // 4. 排序：overdue → at-risk → attention → unscheduled → unknown → safe；同状态 DDL 早优先
  const sorted = [...tasksWithCourses].sort((a, b) => {
    const hr = HEALTH_RANK[a.health] - HEALTH_RANK[b.health];
    if (hr !== 0) return hr;
    const da = deadlineOf(a.deadline) ?? Infinity;
    const db = deadlineOf(b.deadline) ?? Infinity;
    return da - db;
  });
  const topTasks = sorted.slice(0, OUTLOOK_MAX_TASKS);

  // 5. Bottleneck days（deterministic 定义：dueTaskCount>=2 或 plannedStudyMinutes>=240）
  const days: { date: string; planned: number; due: number }[] = [];
  for (let i = 0; i < horizonDays; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    const date = dateStrOf(d);
    const planned = studyBlocks
      .filter((b) => b.date === date)
      .reduce((sum, b) => {
        const s = b.startTime.split(":").map(Number);
        const e = b.endTime.split(":").map(Number);
        const minutes = e[0] * 60 + e[1] - (s[0] * 60 + s[1]);
        return sum + Math.max(0, minutes);
      }, 0);
    const due = selected.filter((a) => a.ddl && a.ddl.slice(0, 10) === date).length;
    days.push({ date, planned, due });
  }
  const freeByDate = new Map<string, number>();
  for (const slot of freeSlots) {
    freeByDate.set(slot.date, (freeByDate.get(slot.date) ?? 0) + slotMinutes(slot));
  }

  // 6. Cumulative Deadline Forecast（只含 eligible：有估时 + 有效 DDL + active）
  const eligibleTasks = tasks.filter((t) => t.capacityComplete !== null);
  const forecastDeadlines = Array.from(
    new Set(eligibleTasks.map((t) => t.deadline).filter((d): d is string => !!d))
  ).sort((a, b) => deadlineOf(a)! - deadlineOf(b)!);
  const capacityForecast: CapacityCheckpoint[] = forecastDeadlines.map((dl) => {
    const dueIds = eligibleTasks
      .filter((t) => t.deadline && t.deadline <= dl)
      .map((t) => t.assignmentId);
    const cumulativeRequiredMinutes = dueIds.reduce(
      (s, id) => s + (tasks.find((t) => t.assignmentId === id)?.unscheduledMinutes ?? 0),
      0
    );
    const cumulativeAllocatedMinutes = dueIds.reduce(
      (s, id) => s + (tasks.find((t) => t.assignmentId === id)?.capacityAllocatedMinutes ?? 0),
      0
    );
    return {
      deadline: dl,
      dueAssignmentIds: dueIds,
      cumulativeRequiredMinutes,
      cumulativeAllocatedMinutes,
      cumulativeShortfallMinutes: Math.max(cumulativeRequiredMinutes - cumulativeAllocatedMinutes, 0),
    };
  });
  const firstShortfall = capacityForecast.find((c) => c.cumulativeShortfallMinutes > 0);
  const firstCapacityShortfall = firstShortfall
    ? {
        deadline: firstShortfall.deadline,
        shortfallMinutes: firstShortfall.cumulativeShortfallMinutes,
        affectedAssignmentIds: tasks
          .filter(
            (t) =>
              t.capacityComplete === false &&
              t.deadline !== null &&
              t.deadline <= firstShortfall.deadline
          )
          .map((t) => t.assignmentId),
      }
    : null;
  const firstShortfallDate = firstShortfall ? firstShortfall.deadline.slice(0, 10) : null;

  // V1.2：Combined（soft fallback 后）的 cumulative forecast
  const eligibleCombinedTasks = tasks.filter((t) => t.combinedCapacityComplete !== null);
  const combinedForecastDeadlines = Array.from(
    new Set(eligibleCombinedTasks.map((t) => t.deadline).filter((d): d is string => !!d))
  ).sort((a, b) => deadlineOf(a)! - deadlineOf(b)!);
  const combinedCapacityForecast: CapacityCheckpoint[] = combinedForecastDeadlines.map((dl) => {
    const dueIds = eligibleCombinedTasks
      .filter((t) => t.deadline && t.deadline <= dl)
      .map((t) => t.assignmentId);
    const cumulativeRequiredMinutes = dueIds.reduce(
      (s, id) => s + (tasks.find((t) => t.assignmentId === id)?.unscheduledMinutes ?? 0),
      0
    );
    const cumulativeAllocatedMinutes = dueIds.reduce(
      (s, id) => s + (tasks.find((t) => t.assignmentId === id)?.combinedCapacityAllocatedMinutes ?? 0),
      0
    );
    return {
      deadline: dl,
      dueAssignmentIds: dueIds,
      cumulativeRequiredMinutes,
      cumulativeAllocatedMinutes,
      cumulativeShortfallMinutes: Math.max(cumulativeRequiredMinutes - cumulativeAllocatedMinutes, 0),
    };
  });
  const firstCombinedShortfall = combinedCapacityForecast.find((c) => c.cumulativeShortfallMinutes > 0);
  const firstCombinedCapacityShortfall = firstCombinedShortfall
    ? {
        deadline: firstCombinedShortfall.deadline,
        shortfallMinutes: firstCombinedShortfall.cumulativeShortfallMinutes,
        affectedAssignmentIds: tasks
          .filter(
            (t) =>
              t.combinedCapacityComplete === false &&
              t.deadline !== null &&
              t.deadline <= firstCombinedShortfall.deadline
          )
          .map((t) => t.assignmentId),
      }
    : null;
  const firstCombinedShortfallDate = firstCombinedShortfall
    ? firstCombinedShortfall.deadline.slice(0, 10)
    : null;

  const bottleneckDays = days
    .filter((d) => d.due >= 2 || d.planned >= 240)
    .map((d) => ({
      date: d.date,
      plannedStudyMinutes: d.planned,
      freeMinutesRemaining: freeByDate.get(d.date) ?? 0,
      dueTaskCount: d.due,
      projectedAllocationMinutes: allocBlockByDate.get(d.date) ?? 0,
      capacityPressure: (
        firstCombinedShortfallDate !== null && d.date >= firstCombinedShortfallDate
          ? "hard-shortfall"
          : firstShortfallDate !== null && d.date >= firstShortfallDate
            ? "preferred-shortfall"
            : "busy"
      ) as "busy" | "preferred-shortfall" | "hard-shortfall",
    }));

  // 7. Summary
  const counts = {
    totalDue: tasks.length,
    overdue: tasks.filter((t) => t.health === "overdue").length,
    atRisk: tasks.filter((t) => t.health === "at-risk").length,
    attention: tasks.filter((t) => t.health === "attention").length,
    unscheduled: tasks.filter((t) => t.health === "unscheduled").length,
    safe: tasks.filter((t) => t.health === "safe").length,
    unknown: tasks.filter((t) => t.health === "unknown").length,
    missingEstimate: tasks.filter((t) => t.reasons.includes("missing_estimate")).length,
    noDeadline: noDeadline.length,
  };
  const summary: StudyOutlookSummary = {
    horizonDays,
    counts,
    workload: {
      estimatedMinutesKnown: tasks.reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0),
      scheduledMinutes: tasks.reduce((s, t) => s + t.scheduledMinutesBeforeDeadline, 0),
      remainingKnownMinutes: tasks.reduce((s, t) => s + (t.unscheduledMinutes ?? 0), 0),
      freeMinutes: totalFreeMinutes,
      // @deprecated → preferred*
      allocatableMinutes: capacity.summary.preferredAllocatedMinutes,
      shortfallMinutes: capacity.summary.preferredShortfallMinutes,
      unusedFreeMinutes: capacity.preferred.unusedFreeMinutes,
      // V1.2：两层容量
      preferredAllocatedMinutes: capacity.summary.preferredAllocatedMinutes,
      preferredShortfallMinutes: capacity.summary.preferredShortfallMinutes,
      additionalAllocatedWithCourseTime: capacity.summary.additionalAllocatedWithCourseTime,
      combinedAllocatedMinutes: capacity.summary.combinedAllocatedMinutes,
      combinedShortfallMinutes: capacity.summary.combinedShortfallMinutes,
    },
  };

  return {
    horizonDays,
    summary,
    tasks: topTasks,
    bottleneckDays,
    capacityForecast,
    firstCapacityShortfall,
    combinedCapacityForecast,
    firstCombinedCapacityShortfall,
    estimateCalibration: calibration,
  };
}

function parseTime(t: string): [number, number] {
  const [h, m] = t.split(":").map(Number);
  return [h ?? 0, m ?? 0];
}

/** Deadline 之后仍存在自己的 StudyBlock（不影响 coverage；仅提示） */
function hasStudyBlocksAfterDeadline(
  assignment: import("@/types").Assignment,
  studyBlocks: import("@/types").StudyBlock[]
): boolean {
  if (!assignment.ddl) return false;
  const dl = parseLocalDDL(assignment.ddl);
  if (!dl) return false;
  const dlDate = assignment.ddl.slice(0, 10);
  const dlMinutes = dl.getHours() * 60 + dl.getMinutes();
  return studyBlocks.some((b) => {
    if (b.assignmentId !== assignment.id) return false;
    if (b.date > dlDate) return true;
    if (b.date < dlDate) return false;
    const end = Number(b.endTime.split(":")[0]) * 60 + Number(b.endTime.split(":")[1]);
    return end > dlMinutes;
  });
}
