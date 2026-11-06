import { describe, it, expect } from "vitest";
import { Assignment, StudyBlock } from "@/types";
import {
  getTaskPlanningFacts,
  indexActiveStudyBlocksByAssignment,
  isActiveStudyBlock,
  isReleasedStudyBlock,
  plannedActiveMinutes,
  remainingMinutes,
  schedulingState,
} from "@/lib/tasks/taskPlanning";

const TASK: Assignment = {
  id: "a1",
  courseId: "c1",
  title: "计量作业",
  description: "",
  priority: "high",
  status: "doing",
  progress: 0,
  tags: [],
  estimatedMinutes: 240,
};

function block(
  id: string,
  startTime: string,
  endTime: string,
  patch: Partial<StudyBlock> = {}
): StudyBlock {
  return {
    id,
    title: id,
    date: "2026-11-06",
    startTime,
    endTime,
    assignmentId: "a1",
    courseId: "c1",
    source: "manual",
    ...patch,
  };
}

describe("taskPlanning", () => {
  it("active/released 判定；released 不计入索引", () => {
    expect(isActiveStudyBlock({})).toBe(true);
    expect(isActiveStudyBlock({ planningState: "released" })).toBe(false);
    expect(isReleasedStudyBlock({ planningState: "released" })).toBe(true);

    const blocks = [block("b1", "10:00", "11:00"), block("b2", "12:00", "13:00", { planningState: "released" })];
    const index = indexActiveStudyBlocksByAssignment(blocks);
    expect(index.get("a1")?.map((b) => b.id)).toEqual(["b1"]);
  });

  it("4h 任务 + 1h active + 1h released → planned 60, remaining 180, partial", () => {
    const blocks = [block("b1", "10:00", "11:00"), block("b2", "12:00", "13:00", { planningState: "released" })];
    const index = indexActiveStudyBlocksByAssignment(blocks);
    expect(plannedActiveMinutes("a1", index)).toBe(60);
    expect(remainingMinutes(TASK, index)).toBe(180);
    expect(schedulingState(TASK, index)).toBe("partial");

    const facts = getTaskPlanningFacts(TASK, index);
    expect(facts.activeBlockCount).toBe(1);
    expect(facts.plannedMinutes).toBe(60);
    expect(facts.remainingMinutes).toBe(180);
    expect(facts.schedulingState).toBe("partial");
  });

  it("4h 任务 + 4h active → full", () => {
    const blocks = [block("b1", "10:00", "12:00"), block("b2", "13:00", "15:00")];
    const index = indexActiveStudyBlocksByAssignment(blocks);
    expect(remainingMinutes(TASK, index)).toBe(0);
    expect(schedulingState(TASK, index)).toBe("full");
  });

  it("有 active block 但无估时 → unknown，不当作已排满", () => {
    const noEstimate = { ...TASK, estimatedMinutes: undefined };
    const index = indexActiveStudyBlocksByAssignment([block("b1", "10:00", "11:00")]);
    expect(remainingMinutes(noEstimate, index)).toBeNull();
    expect(schedulingState(noEstimate, index)).toBe("unknown");
  });

  it("没有任何 active block → unscheduled", () => {
    const index = indexActiveStudyBlocksByAssignment([]);
    expect(schedulingState(TASK, index)).toBe("unscheduled");
    expect(remainingMinutes(TASK, index)).toBe(240);
  });

  it("非法时间块按 0 分钟，不产生负时长", () => {
    const index = indexActiveStudyBlocksByAssignment([
      block("bad1", "11:00", "10:00"),
      block("bad2", "9点", "10:00"),
      block("good", "10:00", "11:00"),
    ]);
    expect(plannedActiveMinutes("a1", index)).toBe(60);
  });
});
