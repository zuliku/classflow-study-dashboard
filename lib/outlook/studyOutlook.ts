/**
 * Study Outlook（Analytics V2 · Part 3）确定性前瞻引擎（纯函数，无 AI）。
 * 只读取 current state + 预构建 calibration；复用 deriveAssignmentHealth / findFreeTime。
 * Outlook 不写任何数据；calibration 只作为 task 的只读参考 metadata。
 */

import { parseLocalDDL } from "@/lib/ddl";
import { findFreeTime, FreeTimeSlot } from "@/lib/planning/freeTime";
import { deriveAssignmentHealth } from "@/lib/tasks/taskHealth";
import {
  OutlookTask,
  StudyOutlook,
  StudyOutlookBuildInput,
  StudyOutlookSummary,
  OutlookTaskEstimateCalibration,
  OutlookHealth,
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

export function buildStudyOutlook(input: StudyOutlookBuildInput): StudyOutlook {
  const { assignments, studyBlocks, schedules, calendarMarks, semester, currentSemesterWeek, horizonDays, now, calibration } = input;

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

  // 3. 每个任务：health（复用 deriveAssignmentHealth）+ available free minutes（now → min(ddl, horizonEnd)）
  const tasks: OutlookTask[] = selected.map((a) => {
    const deadlineMs = deadlineOf(a.ddl ?? null);
    const availableEnd = deadlineMs !== null ? Math.min(deadlineMs, horizonEnd.getTime()) : horizonEnd.getTime();
    const availableBeforeDeadline = freeSlots
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
      availableMinutesBeforeDeadline: a.ddl ? availableBeforeDeadline : undefined,
    });

    return {
      assignmentId: a.id,
      title: a.title,
      courseId: a.courseId ?? null,
      courseName: "",
      deadline: a.ddl ?? null,
      estimatedMinutes: a.estimatedMinutes ?? null,
      scheduledMinutesBeforeDeadline: healthResult.scheduledMinutesBeforeDeadline,
      unscheduledMinutes: healthResult.unscheduledMinutes ?? null,
      availableMinutesBeforeDeadline: a.ddl ? availableBeforeDeadline : null,
      health: healthResult.state,
      reasons: healthResult.reasons,
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
  const bottleneckDays = days
    .filter((d) => d.due >= 2 || d.planned >= 240)
    .map((d) => ({
      date: d.date,
      plannedStudyMinutes: d.planned,
      freeMinutesRemaining: freeByDate.get(d.date) ?? 0,
      dueTaskCount: d.due,
    }));

  // 6. Summary
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
    },
  };

  return { horizonDays, summary, tasks: topTasks, bottleneckDays, estimateCalibration: calibration };
}

function parseTime(t: string): [number, number] {
  const [h, m] = t.split(":").map(Number);
  return [h ?? 0, m ?? 0];
}
