/**
 * Assignment History 事件（Part 1）：
 * - deriveAssignmentTransitionEvents：统一处理 status/completed/reopened/DDL/estimate/priority
 * - 纯 progress 变化不产生历史（只记录 status lifecycle）
 * - no-op 不产生事件
 */

import { Assignment } from "@/types";
import {
  AssignmentCompletionTrigger,
  AssignmentCreatedData,
  LearningHistoryEvent,
} from "@/lib/history/types";
import {
  LearningEventEnvironment,
  ResolvedLearningMutationContext,
  buildLearningHistoryEvent,
} from "@/lib/history/recorder";

export function buildAssignmentCreatedEvent(input: {
  assignment: Assignment;
  context: ResolvedLearningMutationContext;
  environment: LearningEventEnvironment;
}): LearningHistoryEvent {
  const { assignment, context, environment } = input;
  const data: AssignmentCreatedData = {
    status: assignment.status,
    priority: assignment.priority,
    ddl: assignment.ddl ?? null,
    estimatedMinutes: assignment.estimatedMinutes ?? null,
  };
  return buildLearningHistoryEvent({
    type: "assignment.created",
    entityType: "assignment",
    entityId: assignment.id,
    data,
    context,
    environment,
    courseId: assignment.courseId,
    assignmentId: assignment.id,
    courseNameSnapshot: undefined,
    assignmentTitleSnapshot: assignment.title,
  });
}

/**
 * 统一 Assignment 转换事件推导（status / completed / reopened / DDL / estimate / priority）。
 * 供所有 assignment mutation 使用，避免各 action 复制判断。
 */
export function deriveAssignmentTransitionEvents(input: {
  before: Assignment;
  after: Assignment;
  context: ResolvedLearningMutationContext;
  completionTrigger: AssignmentCompletionTrigger;
  environment: LearningEventEnvironment;
}): LearningHistoryEvent[] {
  const { before, after, context, environment, completionTrigger } = input;
  const events: LearningHistoryEvent[] = [];

  const base = {
    context,
    environment,
    courseId: after.courseId,
    assignmentId: after.id,
    assignmentTitleSnapshot: after.title,
  };

  // 进入 completed：status_changed + completed
  if (before.status !== "completed" && after.status === "completed") {
    events.push(
      buildLearningHistoryEvent({
        ...base,
        type: "assignment.status_changed",
        entityType: "assignment",
        entityId: after.id,
        data: { from: before.status, to: after.status },
      }),
      buildLearningHistoryEvent({
        ...base,
        type: "assignment.completed",
        entityType: "assignment",
        entityId: after.id,
        data: { previousStatus: before.status, completionTrigger },
      })
    );
  } else if (before.status === "completed" && after.status !== "completed") {
    // 从 completed 离开：status_changed + reopened
    events.push(
      buildLearningHistoryEvent({
        ...base,
        type: "assignment.status_changed",
        entityType: "assignment",
        entityId: after.id,
        data: { from: before.status, to: after.status },
      }),
      buildLearningHistoryEvent({
        ...base,
        type: "assignment.reopened",
        entityType: "assignment",
        entityId: after.id,
        data: { from: "completed", to: after.status },
      })
    );
  } else if (before.status !== after.status) {
    // 普通状态切换（todo ↔ doing 等；不经过 completed）
    events.push(
      buildLearningHistoryEvent({
        ...base,
        type: "assignment.status_changed",
        entityType: "assignment",
        entityId: after.id,
        data: { from: before.status, to: after.status },
      })
    );
  }

  // DDL 变化（no-op 不记录）
  if ((before.ddl ?? null) !== (after.ddl ?? null)) {
    events.push(
      buildLearningHistoryEvent({
        ...base,
        type: "assignment.deadline_changed",
        entityType: "assignment",
        entityId: after.id,
        data: { before: before.ddl ?? null, after: after.ddl ?? null },
      })
    );
  }

  // 预计耗时变化
  if ((before.estimatedMinutes ?? null) !== (after.estimatedMinutes ?? null)) {
    events.push(
      buildLearningHistoryEvent({
        ...base,
        type: "assignment.estimate_changed",
        entityType: "assignment",
        entityId: after.id,
        data: { before: before.estimatedMinutes ?? null, after: after.estimatedMinutes ?? null },
      })
    );
  }

  // 优先级变化
  if (before.priority !== after.priority) {
    events.push(
      buildLearningHistoryEvent({
        ...base,
        type: "assignment.priority_changed",
        entityType: "assignment",
        entityId: after.id,
        data: { before: before.priority, after: after.priority },
      })
    );
  }

  return events;
}
