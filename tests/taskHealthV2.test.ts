import { describe, it, expect } from "vitest";
import { Assignment, StudyBlock } from "@/types";
import { deriveAssignmentHealthV2 } from "@/lib/tasks/taskHealth";

const NOW = new Date(2026, 10, 6, 12, 0, 0);

function task(patch: Partial<Assignment> = {}): Assignment {
  return {
    id: "a1",
    courseId: "c1",
    title: "任务",
    description: "",
    priority: "high",
    status: "doing",
    progress: 0,
    tags: [],
    ddl: "2026-11-09T23:59:00",
    estimatedMinutes: 240,
    ...patch,
  };
}

function block(id: string, startTime: string, endTime: string, patch: Partial<StudyBlock> = {}): StudyBlock {
  return {
    id,
    title: id,
    date: "2026-11-07",
    startTime,
    endTime,
    assignmentId: "a1",
    courseId: "c1",
    source: "manual",
    ...patch,
  };
}

describe("deriveAssignmentHealthV2", () => {
  it("submitted/completed → null（不显示 Health）", () => {
    expect(deriveAssignmentHealthV2({ assignment: task({ status: "submitted" }), studyBlocks: [], now: NOW })).toBeNull();
    expect(deriveAssignmentHealthV2({ assignment: task({ status: "completed" }), studyBlocks: [], now: NOW })).toBeNull();
  });

  it("released block 不计入计划覆盖度", () => {
    const a = task();
    const blocks = [
      block("active", "10:00", "11:00"),
      block("released", "12:00", "15:00", { planningState: "released" }),
    ];
    const r = deriveAssignmentHealthV2({ assignment: a, studyBlocks: blocks, now: NOW, availableMinutesBeforeDeadline: 600 });
    expect(r?.state).toBe("attention");
    expect(r?.scheduledMinutesBeforeDeadline).toBe(60);
    expect(r?.unscheduledMinutes).toBe(180);
  });

  it("active 任务仍按 timestamp overdue", () => {
    const r = deriveAssignmentHealthV2({
      assignment: task({ ddl: "2026-11-06T09:00:00" }),
      studyBlocks: [],
      now: NOW,
    });
    expect(r?.state).toBe("overdue");
  });
});
