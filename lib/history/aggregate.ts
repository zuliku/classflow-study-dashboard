/**
 * Learning History Aggregation Engine（Part 2）。
 * deterministic summary：所有指标只从 Event 统计（不根据当前状态倒推）。
 * 与 query.ts 共用 collectLearningHistoryEvents。
 */

import { LearningHistoryEvent } from "@/lib/history/types";
import { collectLearningHistoryEvents, resolveLearningHistoryQuery } from "@/lib/history/query";
import { getLearningHistoryCoverage } from "@/lib/history/store";

export type LearningHistoryGroupBy = "none" | "day" | "semester-week" | "course";

export interface LearningHistorySummaryRequest {
  from: number;
  to: number;
  semesterId?: string;
  courseId?: string;
  groupBy?: LearningHistoryGroupBy;
}

export interface LearningHistorySummaryBucket {
  key: string;
  label: string;
  focusCompletedSessions: number;
  focusActualMinutes: number;
  assignmentsCompleted: number;
  studyBlocksCreated: number;
}

export interface LearningHistorySummary {
  range: { from: number; to: number };
  coverage: {
    historyStartedAt: number;
    fullCoverage: boolean;
    focusBackfillCompleted: boolean;
    backfilledFocusSessions: number;
  };
  focus: { completedSessions: number; actualMinutes: number; plannedMinutes: number };
  assignments: {
    created: number;
    completed: number;
    reopened: number;
    deleted: number;
    deadlineChanges: number;
    estimateChanges: number;
    priorityChanges: number;
  };
  studyBlocks: {
    created: number;
    updated: number;
    deleted: number;
    plannedMinutesCreated: number;
  };
  courses: { created: number; updated: number; deleted: number };
  schedules: { created: number; updated: number; deleted: number };
  groups?: LearningHistorySummaryBucket[];
}

/** 事件 → 分组 key（day 用 event.localDate；semester-week 用 event.semesterWeek（null 不进组）；course 用 courseId + snapshot） */
export function bucketKeyOf(
  event: LearningHistoryEvent,
  groupBy: LearningHistoryGroupBy
): { key: string; label: string } | null {
  if (groupBy === "day") {
    return { key: event.localDate, label: event.localDate };
  }
  if (groupBy === "semester-week") {
    if (event.semesterWeek === null) return null;
    return { key: `w${event.semesterWeek}`, label: `第 ${event.semesterWeek} 周` };
  }
  if (groupBy === "course") {
    if (!event.courseId) return null;
    return { key: event.courseId, label: event.courseNameSnapshot ?? event.courseId };
  }
  return null;
}

export async function aggregateLearningHistory(
  request: LearningHistorySummaryRequest
): Promise<LearningHistorySummary> {
  const events = await collectLearningHistoryEvents(
    resolveLearningHistoryQuery({
      from: request.from,
      to: request.to,
      semesterId: request.semesterId,
      courseId: request.courseId,
    })
  );

  const coverage = await getLearningHistoryCoverage();
  const historyStartedAt = coverage?.historyStartedAt ?? Date.now();
  const fullCoverage = request.from >= historyStartedAt;

  const summary: LearningHistorySummary = {
    range: { from: request.from, to: request.to },
    coverage: {
      historyStartedAt,
      fullCoverage,
      focusBackfillCompleted: coverage?.focusBackfillCompleted ?? false,
      backfilledFocusSessions: coverage?.backfilledFocusSessions ?? 0,
    },
    focus: { completedSessions: 0, actualMinutes: 0, plannedMinutes: 0 },
    assignments: {
      created: 0,
      completed: 0,
      reopened: 0,
      deleted: 0,
      deadlineChanges: 0,
      estimateChanges: 0,
      priorityChanges: 0,
    },
    studyBlocks: { created: 0, updated: 0, deleted: 0, plannedMinutesCreated: 0 },
    courses: { created: 0, updated: 0, deleted: 0 },
    schedules: { created: 0, updated: 0, deleted: 0 },
  };

  const groupBy = request.groupBy ?? "none";
  const buckets = new Map<string, LearningHistorySummaryBucket>();

  for (const event of events) {
    // ---- Focus（只从 focus.completed 统计；不使用 started/paused/resumed 推算）----
    if (event.type === "focus.completed") {
      const data = event.data as { actualActiveMs: number; plannedMinutes: number };
      summary.focus.completedSessions += 1;
      summary.focus.actualMinutes += Math.round(data.actualActiveMs / 60000);
      summary.focus.plannedMinutes += data.plannedMinutes;
    }

    // ---- Assignment ----
    if (event.type === "assignment.created") summary.assignments.created += 1;
    else if (event.type === "assignment.completed") summary.assignments.completed += 1;
    else if (event.type === "assignment.reopened") summary.assignments.reopened += 1;
    else if (event.type === "assignment.deleted") summary.assignments.deleted += 1;
    else if (event.type === "assignment.deadline_changed") summary.assignments.deadlineChanges += 1;
    else if (event.type === "assignment.estimate_changed") summary.assignments.estimateChanges += 1;
    else if (event.type === "assignment.priority_changed") summary.assignments.priorityChanges += 1;

    // ---- StudyBlock ----
    if (event.type === "study_block.created") {
      summary.studyBlocks.created += 1;
      const planned = (event.data as { plannedMinutes: number | null }).plannedMinutes;
      if (planned !== null && Number.isFinite(planned)) {
        summary.studyBlocks.plannedMinutesCreated += planned;
      }
    } else if (event.type === "study_block.updated") {
      summary.studyBlocks.updated += 1;
    } else if (event.type === "study_block.deleted") {
      summary.studyBlocks.deleted += 1;
    }

    // ---- Course / Schedule ----
    if (event.type === "course.created") summary.courses.created += 1;
    else if (event.type === "course.updated") summary.courses.updated += 1;
    else if (event.type === "course.deleted") summary.courses.deleted += 1;
    else if (event.type === "schedule.created") summary.schedules.created += 1;
    else if (event.type === "schedule.updated") summary.schedules.updated += 1;
    else if (event.type === "schedule.deleted") summary.schedules.deleted += 1;

    // ---- Groups ----
    const bucket = bucketKeyOf(event, groupBy);
    if (bucket) {
      let b = buckets.get(bucket.key);
      if (!b) {
        b = {
          key: bucket.key,
          label: bucket.label,
          focusCompletedSessions: 0,
          focusActualMinutes: 0,
          assignmentsCompleted: 0,
          studyBlocksCreated: 0,
        };
        buckets.set(bucket.key, b);
      }
      if (event.type === "focus.completed") {
        b.focusCompletedSessions += 1;
        b.focusActualMinutes += Math.round((event.data as { actualActiveMs: number }).actualActiveMs / 60000);
      } else if (event.type === "assignment.completed") {
        b.assignmentsCompleted += 1;
      } else if (event.type === "study_block.created") {
        b.studyBlocksCreated += 1;
      }
    }
  }

  if (groupBy !== "none") {
    summary.groups = Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key));
  }

  return summary;
}
