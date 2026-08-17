/**
 * Focus History 事件（Part 1）：
 * - started / paused / resumed / completed
 * - actualActiveMs 直接来自最终 FocusSession（不另算一套）
 * - sessionSource 保留 Session 最初由谁创建；事件 source 按操作方（manual/kiro/system）
 */

import { FocusSession } from "@/types";
import { LearningHistoryEvent } from "@/lib/history/types";
import {
  LearningEventEnvironment,
  ResolvedLearningMutationContext,
  buildLearningHistoryEvent,
} from "@/lib/history/recorder";

export function buildFocusStartedEvent(input: {
  session: FocusSession;
  context: ResolvedLearningMutationContext;
  environment: LearningEventEnvironment;
}): LearningHistoryEvent {
  const { session, context, environment } = input;
  return buildLearningHistoryEvent({
    type: "focus.started",
    entityType: "focus-session",
    entityId: session.id,
    data: {
      plannedMinutes: session.plannedMinutes,
      sessionSource: session.source,
      startedAt: session.startedAt,
    },
    context,
    environment,
    assignmentId: session.assignmentId,
    courseId: session.courseId,
  });
}

export function buildFocusPausedEvent(input: {
  session: FocusSession;
  context: ResolvedLearningMutationContext;
  environment: LearningEventEnvironment;
}): LearningHistoryEvent {
  const { session, context, environment } = input;
  return buildLearningHistoryEvent({
    type: "focus.paused",
    entityType: "focus-session",
    entityId: session.id,
    data: { accumulatedActiveMs: session.accumulatedActiveMs },
    context,
    environment,
    assignmentId: session.assignmentId,
    courseId: session.courseId,
  });
}

export function buildFocusResumedEvent(input: {
  session: FocusSession;
  context: ResolvedLearningMutationContext;
  environment: LearningEventEnvironment;
}): LearningHistoryEvent {
  const { session, context, environment } = input;
  return buildLearningHistoryEvent({
    type: "focus.resumed",
    entityType: "focus-session",
    entityId: session.id,
    data: { accumulatedActiveMs: session.accumulatedActiveMs },
    context,
    environment,
    assignmentId: session.assignmentId,
    courseId: session.courseId,
  });
}

export function buildFocusCompletedEvent(input: {
  session: FocusSession;
  endReason: "timer" | "manual" | "recovered";
  context: ResolvedLearningMutationContext;
  environment: LearningEventEnvironment;
  backfilled?: boolean;
}): LearningHistoryEvent | null {
  const { session, endReason, context, environment, backfilled } = input;
  if (!session.endedAt || session.actualActiveMs === undefined) return null;
  return buildLearningHistoryEvent({
    type: "focus.completed",
    entityType: "focus-session",
    entityId: session.id,
    data: {
      plannedMinutes: session.plannedMinutes,
      actualActiveMs: session.actualActiveMs,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      endReason,
      sessionSource: session.source,
      backfilled,
    },
    context,
    environment,
    assignmentId: session.assignmentId,
    courseId: session.courseId,
  });
}
