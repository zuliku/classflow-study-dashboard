import { describe, it, expect, beforeEach } from "vitest";
import { LearningHistoryEvent, LearningHistoryEventType, LearningHistorySource } from "@/lib/history/types";
import { buildLearningHistoryEvent, resolveLearningMutationContext } from "@/lib/history/recorder";
import { clearLearningHistoryStorage, appendLearningHistoryEvents } from "@/lib/history/store";
import { queryLearningHistory, collectLearningHistoryEvents, resolveLearningHistoryQuery } from "@/lib/history/query";

const SEMESTER = { id: "sem1", name: "测试学期", startDate: "2026-08-10", totalWeeks: 16 };
const ENV = { semester: SEMESTER };

/** 构造事件（occurredAt 与 sequence 可精确控制） */
function mkEvent(patch: {
  id: string;
  type: LearningHistoryEventType;
  occurredAt: number;
  source?: LearningHistorySource;
  courseId?: string;
  assignmentId?: string;
  sequence?: number;
}): LearningHistoryEvent {
  const base = buildLearningHistoryEvent({
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
    entityId: `e-${patch.id}`,
    data: { status: "todo", priority: "medium", ddl: null, estimatedMinutes: null },
    context: resolveLearningMutationContext({ source: patch.source ?? "manual", occurredAt: patch.occurredAt }),
    environment: ENV,
    courseId: patch.courseId,
    assignmentId: patch.assignmentId,
  });
  return { ...base, id: patch.id, sequence: patch.sequence ?? 1 } as LearningHistoryEvent;
}

beforeEach(async () => {
  await clearLearningHistoryStorage();
});

describe("Learning History Query Engine", () => {
  it("time range filter（from/to）", async () => {
    await appendLearningHistoryEvents([
      mkEvent({ id: "a", type: "assignment.created", occurredAt: 1000 }),
      mkEvent({ id: "b", type: "assignment.created", occurredAt: 2000 }),
      mkEvent({ id: "c", type: "assignment.created", occurredAt: 3000 }),
    ]);
    const events = await queryLearningHistory({ from: 1500, to: 2500, limit: 100 });
    expect(events.map((e) => e.id)).toEqual(["b"]);
  });

  it("event type filter", async () => {
    await appendLearningHistoryEvents([
      mkEvent({ id: "a", type: "assignment.created", occurredAt: 1000 }),
      mkEvent({ id: "b", type: "assignment.completed", occurredAt: 2000 }),
      mkEvent({ id: "c", type: "focus.completed", occurredAt: 3000 }),
    ]);
    const events = await queryLearningHistory({ eventTypes: ["assignment.completed"], limit: 100 });
    expect(events.map((e) => e.id)).toEqual(["b"]);
  });

  it("course / assignment / entity type / source filters（AND）", async () => {
    await appendLearningHistoryEvents([
      mkEvent({ id: "a", type: "assignment.created", occurredAt: 1000, courseId: "c1", assignmentId: "a1", source: "manual" }),
      mkEvent({ id: "b", type: "assignment.created", occurredAt: 2000, courseId: "c2", assignmentId: "a2", source: "kiro" }),
      mkEvent({ id: "c", type: "study_block.created", occurredAt: 3000, courseId: "c1", source: "manual" }),
      mkEvent({ id: "d", type: "assignment.created", occurredAt: 4000, courseId: "c1", assignmentId: "a3", source: "kiro" }),
    ]);
    expect((await queryLearningHistory({ courseId: "c1", order: "asc", limit: 100 })).map((e) => e.id)).toEqual(["a", "c", "d"]);
    expect((await queryLearningHistory({ assignmentId: "a1", order: "asc", limit: 100 })).map((e) => e.id)).toEqual(["a"]);
    expect((await queryLearningHistory({ entityType: "study-block", order: "asc", limit: 100 })).map((e) => e.id)).toEqual(["c"]);
    expect((await queryLearningHistory({ source: "kiro", order: "asc", limit: 100 })).map((e) => e.id)).toEqual(["b", "d"]);
    expect((await queryLearningHistory({ courseId: "c1", source: "kiro", order: "asc", limit: 100 })).map((e) => e.id)).toEqual(["d"]);
  });

  it("ordering：desc/asc 按 (occurredAt, sequence) 稳定排序", async () => {
    await appendLearningHistoryEvents([
      mkEvent({ id: "a", type: "assignment.created", occurredAt: 1000, sequence: 1 }),
      mkEvent({ id: "b", type: "assignment.created", occurredAt: 2000, sequence: 1 }),
      // 同一 mutation 多事件：同 occurredAt，sequence 1 → 2
      mkEvent({ id: "c1", type: "assignment.status_changed", occurredAt: 3000, sequence: 1 }),
      mkEvent({ id: "c2", type: "assignment.completed", occurredAt: 3000, sequence: 2 }),
    ]);
    const desc = await queryLearningHistory({ limit: 100, order: "desc" });
    expect(desc.map((e) => e.id)).toEqual(["c2", "c1", "b", "a"]);
    const asc = await queryLearningHistory({ limit: 100, order: "asc" });
    expect(asc.map((e) => e.id)).toEqual(["a", "b", "c1", "c2"]);
  });

  it("limit：默认 100，显式 limit 截断（Core 层不 clamp 到 200）", async () => {
    const events = Array.from({ length: 250 }, (_, i) =>
      mkEvent({ id: `e${i}`, type: "assignment.created", occurredAt: i, sequence: 1 })
    );
    await appendLearningHistoryEvents(events);
    expect((await queryLearningHistory({ order: "asc" })).length).toBe(100);
    expect((await queryLearningHistory({ order: "asc", limit: 250 })).length).toBe(250);
    expect((await queryLearningHistory({ order: "asc", limit: 5 })).length).toBe(5);
  });

  it("collect（aggregate 用）：无 limit 全量", async () => {
    const events = Array.from({ length: 120 }, (_, i) =>
      mkEvent({ id: `e${i}`, type: "assignment.created", occurredAt: i, sequence: 1 })
    );
    await appendLearningHistoryEvents(events);
    const collected = await collectLearningHistoryEvents(resolveLearningHistoryQuery({}));
    expect(collected.length).toBe(120);
  });
});
