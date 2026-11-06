import { describe, it, expect } from "vitest";
import { Assignment, StudyBlock } from "@/types";
import {
  buildDeadlineFeed,
  buildPlanBacklogProjection,
  buildTodayProjection,
} from "@/lib/tasks/taskProjections";

const NOW = new Date(2026, 10, 6, 15, 0, 0); // 2026-11-06 15:00
const WEEK = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];

function task(id: string, patch: Partial<Assignment> = {}): Assignment {
  return {
    id,
    courseId: "c1",
    title: id,
    description: "",
    priority: "medium",
    status: "todo",
    progress: 0,
    tags: [],
    ...patch,
  };
}

function block(
  id: string,
  assignmentId: string,
  date: string,
  startTime: string,
  endTime: string,
  patch: Partial<StudyBlock> = {}
): StudyBlock {
  return {
    id,
    title: id,
    date,
    startTime,
    endTime,
    assignmentId,
    courseId: "c1",
    source: "manual",
    ...patch,
  };
}

const assignments: Assignment[] = [
  task("overdue", { ddl: "2026-11-06T09:00:00", estimatedMinutes: 60 }),
  task("dueToday", { ddl: "2026-11-06T23:59:00", estimatedMinutes: 30 }),
  task("doToday", { doDate: "2026-11-06", estimatedMinutes: 45 }),
  task("scheduledToday", { ddl: "2026-11-10T23:59:00", estimatedMinutes: 120 }),
  task("multi", {
    ddl: "2026-11-05T09:00:00",
    doDate: "2026-11-06",
    estimatedMinutes: 90,
  }),
  task("submitted", { status: "submitted", ddl: "2026-11-06T23:59:00" }),
  task("completed", { status: "completed", ddl: "2026-11-06T23:59:00" }),
  task("later", { ddl: "2026-11-09T23:59:00", estimatedMinutes: 60 }),
  task("fullyScheduled", { ddl: "2026-11-12T23:59:00", estimatedMinutes: 60 }),
  task("releasedOnly", { ddl: "2026-11-12T23:59:00", estimatedMinutes: 60 }),
];

const studyBlocks: StudyBlock[] = [
  block("b-scheduled", "scheduledToday", "2026-11-06", "10:00", "11:00"),
  block("b-multi", "multi", "2026-11-06", "16:00", "17:00"),
  block("b-full", "fullyScheduled", "2026-11-10", "10:00", "11:00"),
  block("b-released", "releasedOnly", "2026-11-06", "18:00", "19:00", {
    planningState: "released",
  }),
];

describe("buildTodayProjection", () => {
  const projection = buildTodayProjection(assignments, studyBlocks, NOW);

  it("按 overdue → dueToday → doToday → scheduledToday 归组，且任务只出现一次", () => {
    expect(projection.groups.overdue.map((i) => i.task.id)).toEqual(["multi", "overdue"]);
    expect(projection.groups.dueToday.map((i) => i.task.id)).toEqual(["dueToday"]);
    expect(projection.groups.doToday.map((i) => i.task.id)).toEqual(["doToday"]);
    expect(projection.groups.scheduledToday.map((i) => i.task.id)).toEqual(["scheduledToday"]);

    // multi 同时在 overdue/doDate/block today，但只归入 overdue
    expect(projection.groups.dueToday.some((i) => i.task.id === "multi")).toBe(false);
    expect(projection.groups.doToday.some((i) => i.task.id === "multi")).toBe(false);
    expect(projection.groups.scheduledToday.some((i) => i.task.id === "multi")).toBe(false);
  });

  it("submitted/completed 不进入 Today；waitingCount 单独统计", () => {
    const all = Object.values(projection.groups).flat().map((i) => i.task.id);
    expect(all).not.toContain("submitted");
    expect(all).not.toContain("completed");
    expect(projection.waitingCount).toBe(1);
  });

  it("plannedMinutes 只统计 active blocks；released 不计", () => {
    // scheduledToday 60 + multi 60；releasedOnly 的 60 不计
    expect(projection.plannedMinutes).toBe(120);
  });

  it("unplannedMinutes 统计今天任务中尚未安排到今天的剩余分钟", () => {
    // overdue 60 + dueToday 30 + doToday 45；multi/scheduledToday 今天已有 block
    expect(projection.unplannedMinutes).toBe(135);
    expect(projection.unplannedUnknownCount).toBe(0);
  });

  it("taskCount 为去重后的任务数", () => {
    expect(projection.taskCount).toBe(5);
  });
});

describe("buildPlanBacklogProjection", () => {
  const projection = buildPlanBacklogProjection(assignments, studyBlocks, WEEK, NOW);

  it("按 overdue → dueThisWeek → needsScheduling 归组，closed 不出现", () => {
    expect(projection.buckets.overdue.map((i) => i.task.id)).toEqual(["multi", "overdue"]);
    expect(projection.buckets.dueThisWeek.map((i) => i.task.id)).toEqual(["dueToday"]);
    expect(projection.buckets.needsScheduling.map((i) => i.task.id).sort()).toEqual(
      ["doToday", "later", "releasedOnly", "scheduledToday"].sort()
    );
  });

  it("fully scheduled 且不在本周到期 → 不进入 Backlog", () => {
    const all = Object.values(projection.buckets).flat().map((i) => i.task.id);
    expect(all).not.toContain("fullyScheduled");
    expect(all).not.toContain("submitted");
    expect(all).not.toContain("completed");
  });

  it("counts 与 buckets 一致", () => {
    expect(projection.counts).toEqual({
      overdue: projection.buckets.overdue.length,
      dueThisWeek: projection.buckets.dueThisWeek.length,
      needsScheduling: projection.buckets.needsScheduling.length,
    });
  });
});

describe("buildDeadlineFeed", () => {
  it("overdue → today → soon → later，closed 不出现", () => {
    const feed = buildDeadlineFeed(assignments, NOW, 3);
    expect(feed.groups.overdue.map((i) => i.task.id)).toEqual(["multi", "overdue"]);
    expect(feed.groups.today.map((i) => i.task.id)).toEqual(["dueToday"]);
    expect(feed.groups.soon.map((i) => i.task.id)).toEqual(["later"]);
    expect(feed.groups.later.map((i) => i.task.id)).toEqual([
      "scheduledToday",
      "fullyScheduled",
      "releasedOnly",
    ]);
    expect(feed.items.some((i) => i.task.id === "submitted")).toBe(false);
    expect(feed.items.some((i) => i.task.id === "completed")).toBe(false);
  });

  it("warningDays 改变 soon/later 边界", () => {
    const feed = buildDeadlineFeed(assignments, NOW, 1);
    expect(feed.groups.soon).toHaveLength(0);
    expect(feed.groups.later.map((i) => i.task.id)).toContain("later");
  });
});
