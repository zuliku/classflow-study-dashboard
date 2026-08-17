/**
 * StudyBlock History 事件（Part 1）：
 * - created / updated / deleted
 * - updated 只关心 date / startTime / endTime（及对应 planned minutes）；仅 title 变化不记录
 */

import { StudyBlock } from "@/types";
import { LearningHistoryEvent } from "@/lib/history/types";
import {
  LearningEventEnvironment,
  ResolvedLearningMutationContext,
  buildLearningHistoryEvent,
} from "@/lib/history/recorder";

/** planned minutes：end > start 才有值；非法返回 null（不返回负数） */
export function studyBlockPlannedMinutes(block: {
  startTime: string;
  endTime: string;
}): number | null {
  const toMin = (t: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) return null;
    const v = Number(m[1]) * 60 + Number(m[2]);
    return Number.isFinite(v) ? v : null;
  };
  const s = toMin(block.startTime);
  const e = toMin(block.endTime);
  if (s === null || e === null) return null;
  if (e <= s) return null;
  return e - s;
}

export function buildStudyBlockCreatedEvent(input: {
  block: StudyBlock;
  context: ResolvedLearningMutationContext;
  environment: LearningEventEnvironment;
  restored?: boolean;
}): LearningHistoryEvent {
  const { block, context, environment, restored } = input;
  return buildLearningHistoryEvent({
    type: "study_block.created",
    entityType: "study-block",
    entityId: block.id,
    data: {
      date: block.date,
      startTime: block.startTime,
      endTime: block.endTime,
      plannedMinutes: studyBlockPlannedMinutes(block),
      originSource: block.source === "kiro" ? "kiro" : "manual",
      restored,
    },
    context,
    environment,
    assignmentId: block.assignmentId,
    courseId: block.courseId,
  });
}

export function buildStudyBlockUpdatedEvent(input: {
  before: StudyBlock;
  after: StudyBlock;
  context: ResolvedLearningMutationContext;
  environment: LearningEventEnvironment;
}): LearningHistoryEvent | null {
  const { before, after, context, environment } = input;
  const date = before.date !== after.date ? after.date : undefined;
  const startTime = before.startTime !== after.startTime ? after.startTime : undefined;
  const endTime = before.endTime !== after.endTime ? after.endTime : undefined;
  if (date === undefined && startTime === undefined && endTime === undefined) return null;
  return buildLearningHistoryEvent({
    type: "study_block.updated",
    entityType: "study-block",
    entityId: after.id,
    data: {
      date,
      startTime,
      endTime,
      plannedMinutesBefore: studyBlockPlannedMinutes(before),
      plannedMinutesAfter: studyBlockPlannedMinutes(after),
    },
    context,
    environment,
    assignmentId: after.assignmentId,
    courseId: after.courseId,
  });
}

export function buildStudyBlockDeletedEvent(input: {
  block: StudyBlock;
  context: ResolvedLearningMutationContext;
  environment: LearningEventEnvironment;
}): LearningHistoryEvent {
  const { block, context, environment } = input;
  return buildLearningHistoryEvent({
    type: "study_block.deleted",
    entityType: "study-block",
    entityId: block.id,
    data: { date: block.date },
    context,
    environment,
    assignmentId: block.assignmentId,
    courseId: block.courseId,
  });
}
