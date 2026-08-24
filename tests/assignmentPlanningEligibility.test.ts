import { describe, it, expect } from "vitest";
import { isAssignmentPlanningEligible } from "@/lib/tasks/taskSemantics";
import { proposeStudyPlan } from "@/lib/planning/studyPlanner";
import { buildStudyOutlook } from "@/lib/outlook/studyOutlook";
import { Assignment } from "@/types";

/**
 * Workflow UX V14 —— Assignment Planning Eligibility（单一事实源）：
 * 严格 todo/doing = true；submitted/completed = false。
 * 防止未来再写成 status !== "completed"（submitted 漏网 bug）。
 * Planner / Outlook 的重复 predicate 已收敛至同一 helper——行为锁死。
 */

const mkA = (id: string, status: Assignment["status"]): Assignment =>
  ({ id, courseId: "c1", title: `任务 ${id}`, description: "", priority: "medium", status, progress: 0, tags: [] }) as Assignment;

describe("isAssignmentPlanningEligible", () => {
  it("todo → true", () => {
    expect(isAssignmentPlanningEligible(mkA("a1", "todo"))).toBe(true);
  });
  it("doing → true", () => {
    expect(isAssignmentPlanningEligible(mkA("a2", "doing"))).toBe(true);
  });
  it("submitted → false（不是 status !== completed）", () => {
    expect(isAssignmentPlanningEligible(mkA("a3", "submitted"))).toBe(false);
  });
  it("completed → false", () => {
    expect(isAssignmentPlanningEligible(mkA("a4", "completed"))).toBe(false);
  });
});

const SEMESTER = { id: "s1", name: "x", startDate: "2026-01-05", totalWeeks: 16 };

describe("Planner eligibility 收敛回归", () => {
  const baseInput = {
    studyBlocks: [],
    semester: SEMESTER,
    currentSemesterWeek: 1,
    schedules: [],
    calendarMarks: [],
    fromDate: "2026-01-05",
    toDate: "2026-01-11",
    now: new Date("2026-01-06T10:00:00"),
  };

  it("submitted / completed 不进入 Planner proposal；todo 行为不变", () => {
    const result = proposeStudyPlan({
      ...baseInput,
      assignments: [
        { ...mkA("a-todo", "todo"), ddl: "2026-01-09T23:59:00", estimatedMinutes: 60 },
        { ...mkA("a-sub", "submitted"), ddl: "2026-01-09T23:59:00", estimatedMinutes: 60 },
        { ...mkA("a-done", "completed"), ddl: "2026-01-09T23:59:00", estimatedMinutes: 60 },
      ],
    });
    const titles = result.items.map((i) => i.title);
    expect(titles).toContain("任务 a-todo");
    expect(titles).not.toContain("任务 a-sub");
    expect(titles).not.toContain("任务 a-done");
  });
});

describe("Study Outlook eligibility 收敛回归", () => {
  const outlookInput = {
    studyBlocks: [],
    schedules: [],
    calendarMarks: [],
    courses: [] as import("@/types").Course[],
    semester: SEMESTER,
    currentSemesterWeek: 1,
    horizonDays: 7 as const,
    now: new Date("2026-01-06T10:00:00"),
    calibration: undefined,
  };

  it("submitted / completed 不进入 Outlook active tasks；todo/doing 行为不变", () => {
    const out = buildStudyOutlook({
      ...outlookInput,
      assignments: [
        { ...mkA("a-todo", "todo"), ddl: "2026-01-09T23:59:00" },
        { ...mkA("a-doing", "doing"), ddl: "2026-01-10T23:59:00" },
        { ...mkA("a-sub", "submitted"), ddl: "2026-01-09T23:59:00" },
        { ...mkA("a-done", "completed"), ddl: "2026-01-09T23:59:00" },
      ] as Assignment[],
    });
    const ids = out.tasks.map((t) => t.assignmentId).sort();
    expect(ids).toEqual(["a-doing", "a-todo"]);
  });
});
