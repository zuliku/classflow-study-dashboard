import { describe, it, expect, beforeEach } from "vitest";
import { LearningHistoryEvent } from "@/lib/history/types";
import { buildLearningHistoryEvent, resolveLearningMutationContext } from "@/lib/history/recorder";
import { clearLearningHistoryStorage, appendLearningHistoryEvents, setLearningHistoryCoverage } from "@/lib/history/store";
import { aggregateLearningHistory, LearningHistoryGroupBy } from "@/lib/history/aggregate";

const SEMESTER = { id: "sem1", name: "测试学期", startDate: "2026-08-10", totalWeeks: 16 };
const ENV = { semester: SEMESTER };

function mkEvent(patch: {
  type: LearningHistoryEvent["type"];
  occurredAt: number;
  courseId?: string;
  assignmentId?: string;
  courseNameSnapshot?: string;
  data?: unknown;
}): LearningHistoryEvent {
  return {
    ...buildLearningHistoryEvent({
      type: patch.type,
      entityType: patch.type.startsWith("assignment")
        ? "assignment"
        : patch.type.startsWith("study_block")
          ? "study-block"
          : patch.type.startsWith("focus")
            ? "focus-session"
            : patch.type.startsWith("course")
              ? "course"
              : "schedule",
      entityId: `e-${patch.type}-${patch.occurredAt}`,
      data: patch.data ?? { status: "todo", priority: "medium", ddl: null, estimatedMinutes: null },
      context: resolveLearningMutationContext({ source: "manual", occurredAt: patch.occurredAt }),
      environment: ENV,
      courseId: patch.courseId,
      assignmentId: patch.assignmentId,
      courseNameSnapshot: patch.courseNameSnapshot,
    }),
  } as LearningHistoryEvent;
}

const FOCUS_COMPLETED = (id: number, actual: number, planned: number) =>
  mkEvent({ type: "focus.completed", occurredAt: id, data: { actualActiveMs: actual, plannedMinutes: planned } });

const ASSIGNMENT_COMPLETED = (id: number, courseId: string) =>
  mkEvent({ type: "assignment.completed", occurredAt: id, courseId, assignmentId: `a${id}` });

beforeEach(async () => {
  await clearLearningHistoryStorage();
  await setLearningHistoryCoverage({
    schemaVersion: 1,
    historyStartedAt: 1000000000000, // 2001-09-09
    initializedAt: 1000000000000,
    focusBackfillCompleted: false,
    backfilledFocusSessions: 0,
  });
});

describe("Learning History Aggregation", () => {
  it("逐字段 exact：2 focus + 3 completed + 1 reopened + 2 study block created + 1 deadline changed", async () => {
    await appendLearningHistoryEvents([
      FOCUS_COMPLETED(1000, 1_500_000, 25), // 25 min
      FOCUS_COMPLETED(2000, 2_000_000, 30), // ~33 min
      ASSIGNMENT_COMPLETED(3000, "c1"),
      ASSIGNMENT_COMPLETED(4000, "c1"),
      ASSIGNMENT_COMPLETED(5000, "c2"),
      mkEvent({ type: "assignment.reopened", occurredAt: 6000, courseId: "c1", assignmentId: "a6" }),
      mkEvent({
        type: "study_block.created",
        occurredAt: 7000,
        courseId: "c1",
        data: { date: "2026-08-15", startTime: "10:00", endTime: "11:30", plannedMinutes: 90, originSource: "manual" },
      }),
      mkEvent({
        type: "study_block.created",
        occurredAt: 8000,
        data: { date: "2026-08-16", startTime: "09:00", endTime: "09:30", plannedMinutes: null, originSource: "manual" },
      }),
      mkEvent({
        type: "assignment.deadline_changed",
        occurredAt: 9000,
        courseId: "c1",
        assignmentId: "a9",
        data: { before: null, after: "2026-09-01T10:00:00" },
      }),
    ]);
    const summary = await aggregateLearningHistory({ from: 0, to: 10000, groupBy: "none" });
    expect(summary.focus).toEqual({ completedSessions: 2, actualMinutes: 58, plannedMinutes: 55 });
    expect(summary.assignments).toEqual({
      created: 0,
      completed: 3,
      reopened: 1,
      deleted: 0,
      deadlineChanges: 1,
      estimateChanges: 0,
      priorityChanges: 0,
    });
    expect(summary.studyBlocks).toEqual({
      created: 2,
      updated: 0,
      deleted: 0,
      plannedMinutesCreated: 90, // null 忽略分钟数但统计 created
    });
    expect(summary.courses).toEqual({ created: 0, updated: 0, deleted: 0 });
    expect(summary.schedules).toEqual({ created: 0, updated: 0, deleted: 0 });
    expect(summary.groups).toBeUndefined();
  });

  it("coverage：from < historyStartedAt → fullCoverage=false；>= → true", async () => {
    await appendLearningHistoryEvents([FOCUS_COMPLETED(1000, 60000, 10)]);
    const early = await aggregateLearningHistory({ from: 100, to: 5000 });
    expect(early.coverage.fullCoverage).toBe(false);
    const late = await aggregateLearningHistory({ from: 1000000000000, to: 1000000000000 + 86400000 });
    expect(late.coverage.fullCoverage).toBe(true);
  });

  it("group by day：使用 event.localDate（不按当前 timezone）", async () => {
    const day1 = mkEvent({ type: "focus.completed", occurredAt: 1000, data: { actualActiveMs: 60000, plannedMinutes: 10 } });
    const day2 = mkEvent({ type: "focus.completed", occurredAt: 2000, data: { actualActiveMs: 120000, plannedMinutes: 20 } });
    // 强制两个事件的 localDate 不同（即使 occurredAt 接近）
    const withDate = (e: LearningHistoryEvent, localDate: string): LearningHistoryEvent => ({ ...e, localDate });
    await appendLearningHistoryEvents([withDate(day1, "2026-08-15"), withDate(day2, "2026-08-16")]);
    const summary = await aggregateLearningHistory({ from: 0, to: 3000, groupBy: "day" });
    expect(summary.groups!.map((g) => ({ key: g.key, sessions: g.focusCompletedSessions, minutes: g.focusActualMinutes }))).toEqual([
      { key: "2026-08-15", sessions: 1, minutes: 1 },
      { key: "2026-08-16", sessions: 1, minutes: 2 },
    ]);
  });

  it("group by semester-week：使用 event.semesterWeek（即使当前 UI week 不同）；null 不进组但进 total", async () => {
    const inWeek3 = { ...mkEvent({ type: "assignment.completed", occurredAt: 1000, courseId: "c1" }), semesterWeek: 3 };
    const nullWeek = { ...mkEvent({ type: "assignment.completed", occurredAt: 2000, courseId: "c1" }), semesterWeek: null };
    await appendLearningHistoryEvents([inWeek3, nullWeek]);
    const summary = await aggregateLearningHistory({ from: 0, to: 3000, groupBy: "semester-week" });
    expect(summary.assignments.completed).toBe(2); // total 含 null
    expect(summary.groups!.map((g) => g.key)).toEqual(["w3"]);
    expect(summary.groups![0].assignmentsCompleted).toBe(1);
  });

  it("group by course：使用 courseNameSnapshot（删除 course 后仍可分组）", async () => {
    await appendLearningHistoryEvents([
      { ...ASSIGNMENT_COMPLETED(1000, "c1"), courseNameSnapshot: "高级统计学" },
      { ...ASSIGNMENT_COMPLETED(2000, "c1"), courseNameSnapshot: "高级统计学" },
    ]);
    const summary = await aggregateLearningHistory({ from: 0, to: 3000, groupBy: "course" });
    expect(summary.groups).toHaveLength(1);
    expect(summary.groups![0].label).toBe("高级统计学");
    expect(summary.groups![0].assignmentsCompleted).toBe(2);
    expect(summary.assignments.completed).toBe(2);
  });
});
