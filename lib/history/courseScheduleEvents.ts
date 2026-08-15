/**
 * Course / Schedule History 事件（Part 1）：
 * - course.created / updated / deleted（updated 只记录 name/code/teacher/classroom/credit）
 * - schedule.created / updated / deleted（excludeWeekFromSchedule → updated）
 */

import { Course, CourseSchedule, Semester } from "@/types";
import { LearningHistoryEvent } from "@/lib/history/types";
import {
  LearningEventEnvironment,
  ResolvedLearningMutationContext,
  buildLearningHistoryEvent,
} from "@/lib/history/recorder";

// ---------- Course ----------

export function buildCourseCreatedEvent(input: {
  course: Course;
  context: ResolvedLearningMutationContext;
  environment: LearningEventEnvironment;
}): LearningHistoryEvent {
  const { course, context, environment } = input;
  return buildLearningHistoryEvent({
    type: "course.created",
    entityType: "course",
    entityId: course.id,
    data: { name: course.name, code: course.code, credit: course.credit },
    context,
    environment,
    courseId: course.id,
    courseNameSnapshot: course.name,
  });
}

export function buildCourseUpdatedEvent(input: {
  before: Course;
  after: Course;
  context: ResolvedLearningMutationContext;
  environment: LearningEventEnvironment;
}): LearningHistoryEvent | null {
  const { before, after, context, environment } = input;
  const fields: (keyof Pick<Course, "name" | "code" | "teacher" | "classroom" | "credit">)[] = [
    "name",
    "code",
    "teacher",
    "classroom",
    "credit",
  ];
  const beforePatch: Record<string, string | number> = {};
  const afterPatch: Record<string, string | number> = {};
  let changed = false;
  for (const f of fields) {
    if (before[f] !== after[f]) {
      beforePatch[f] = before[f] as string | number;
      afterPatch[f] = after[f] as string | number;
      changed = true;
    }
  }
  if (!changed) return null;
  return buildLearningHistoryEvent({
    type: "course.updated",
    entityType: "course",
    entityId: after.id,
    data: { before: beforePatch, after: afterPatch },
    context,
    environment,
    courseId: after.id,
    courseNameSnapshot: after.name,
  });
}

export function buildCourseDeletedEvent(input: {
  course: Course;
  context: ResolvedLearningMutationContext;
  environment: LearningEventEnvironment;
}): LearningHistoryEvent {
  const { course, context, environment } = input;
  return buildLearningHistoryEvent({
    type: "course.deleted",
    entityType: "course",
    entityId: course.id,
    data: { name: course.name, code: course.code, credit: course.credit },
    context,
    environment,
    courseId: course.id,
    courseNameSnapshot: course.name,
  });
}

// ---------- Schedule ----------

function scheduleDataOf(schedule: CourseSchedule): {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  location: string;
  weeks: string;
  excludedWeeks?: number[];
} {
  return {
    dayOfWeek: schedule.dayOfWeek,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    location: schedule.location,
    weeks: schedule.weeks,
    excludedWeeks: schedule.excludedWeeks ? [...schedule.excludedWeeks] : undefined,
  };
}

export function buildScheduleCreatedEvent(input: {
  schedule: CourseSchedule;
  context: ResolvedLearningMutationContext;
  environment: LearningEventEnvironment;
  restored?: boolean;
}): LearningHistoryEvent {
  const { schedule, context, environment, restored } = input;
  return buildLearningHistoryEvent({
    type: "schedule.created",
    entityType: "schedule",
    entityId: schedule.id,
    data: { ...scheduleDataOf(schedule), restored },
    context,
    environment,
    courseId: schedule.courseId,
  });
}

export function buildScheduleUpdatedEvent(input: {
  schedule: CourseSchedule;
  context: ResolvedLearningMutationContext;
  environment: LearningEventEnvironment;
}): LearningHistoryEvent {
  const { schedule, context, environment } = input;
  return buildLearningHistoryEvent({
    type: "schedule.updated",
    entityType: "schedule",
    entityId: schedule.id,
    data: scheduleDataOf(schedule),
    context,
    environment,
    courseId: schedule.courseId,
  });
}

export function buildScheduleDeletedEvent(input: {
  schedule: CourseSchedule;
  context: ResolvedLearningMutationContext;
  environment: LearningEventEnvironment;
}): LearningHistoryEvent {
  const { schedule, context, environment } = input;
  return buildLearningHistoryEvent({
    type: "schedule.deleted",
    entityType: "schedule",
    entityId: schedule.id,
    data: scheduleDataOf(schedule),
    context,
    environment,
    courseId: schedule.courseId,
  });
}

// ---------- Semester ----------

export function buildSemesterUpdatedEvent(input: {
  before: Semester;
  after: Semester;
  context: ResolvedLearningMutationContext;
  environment: LearningEventEnvironment;
}): LearningHistoryEvent | null {
  const { before, after, context, environment } = input;
  const same =
    before.id === after.id &&
    before.name === after.name &&
    before.startDate === after.startDate &&
    before.totalWeeks === after.totalWeeks;
  if (same) return null;
  return buildLearningHistoryEvent({
    type: "semester.updated",
    entityType: "semester",
    entityId: after.id,
    data: {
      before: { id: before.id, name: before.name, startDate: before.startDate, totalWeeks: before.totalWeeks },
      after: { id: after.id, name: after.name, startDate: after.startDate, totalWeeks: after.totalWeeks },
    },
    context,
    environment,
  });
}
