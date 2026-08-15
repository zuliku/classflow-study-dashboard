import { describe, it, expect } from "vitest";
import { proposeStudyPlan } from "@/lib/planning/studyPlanner";
import { allocateStudyCapacity } from "@/lib/planning/capacityAllocation";
import { findFreeTime } from "@/lib/planning/freeTime";
import { Assignment, CalendarMark, CourseSchedule, Semester, StudyBlock } from "@/types";

/**
 * 本轮最重要 invariant：同一 state / fromDate / toDate / now 下，
 * Capacity Allocator（Outlook 使用）与 proposeStudyPlan 对相同 eligible tasks 的
 * 分配结果必须一致（projectedBlocks / allocatedMinutes / completeCoverage）。
 */

const NOW = new Date(2026, 7, 10, 9, 0, 0);
const iso = (d: Date, h = 23, m = 59) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
const date = (offset: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const SEMESTER: Semester = { id: "s", name: "S", startDate: date(0), totalWeeks: 16 };

function mk(id: string, patch: Partial<Assignment> = {}): Assignment {
  return {
    id, courseId: "c1", title: id, description: "", priority: "medium",
    status: "todo", progress: 0, tags: [],
    ...patch,
  } as Assignment;
}

function block(id: string, assignmentId: string, offset: number, start: string, end: string): StudyBlock {
  return { id, title: id, date: date(offset), startTime: start, endTime: end, assignmentId, courseId: "c1", source: "manual" };
}

const noBlocks: StudyBlock[] = [];
const noMarks: CalendarMark[] = [];
const noSchedules: CourseSchedule[] = [];

describe("Capacity Allocator ↔ Study Planner Canonical Invariant", () => {
  it("竞争场景：planner proposal 与 allocation forecast 完全一致（含 blocks）", () => {
    const assignments = [
      mk("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 120 }),
      mk("a2", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 120 }),
    ];
    const pool = findFreeTime({
      start: NOW,
      now: NOW,
      end: new Date(NOW.getTime() + 1 * 86400000),
      semester: SEMESTER,
      currentSemesterWeek: 1,
      schedules: noSchedules,
      calendarMarks: noMarks,
      studyBlocks: noBlocks,
    });
    // 用 marks 把今天锁死，让明天只剩 180min？不 —— 直接对同一 findFreeTime 结果分配即可
    const allocation = allocateStudyCapacity({
      assignments, studyBlocks: noBlocks, freeSlots: pool,
      fromDate: date(0), toDate: date(1), now: NOW,
    });
    const planner = proposeStudyPlan({
      assignments, studyBlocks: noBlocks, semester: SEMESTER, currentSemesterWeek: 1,
      schedules: noSchedules, calendarMarks: noMarks, fromDate: date(0), toDate: date(1), now: NOW,
    });

    for (const a of allocation.tasks) {
      const p = planner.items.find((i) => i.assignmentId === a.assignmentId)!;
      expect(p.proposedMinutes).toBe(a.allocatedMinutes);
      expect(p.completeCoverage).toBe(a.completeCoverage);
      expect(p.proposedBlocks).toEqual(a.projectedBlocks);
      expect(p.scheduledMinutes).toBe(a.alreadyScheduledMinutes);
    }
  });

  it("existing plan：两者都只补缺口（remaining = estimate - scheduled）", () => {
    const a = mk("a1", { ddl: iso(new Date(NOW.getTime() + 3 * 86400000)), estimatedMinutes: 180 });
    const blocks = [block("b1", "a1", 1, "19:00", "20:00")]; // 60
    const pool = findFreeTime({
      start: NOW,
      now: NOW,
      end: new Date(NOW.getTime() + 3 * 86400000),
      semester: SEMESTER,
      currentSemesterWeek: 1,
      schedules: noSchedules,
      calendarMarks: noMarks,
      studyBlocks: blocks,
    });
    const allocation = allocateStudyCapacity({
      assignments: [a], studyBlocks: blocks, freeSlots: pool,
      fromDate: date(0), toDate: date(3), now: NOW,
    });
    const planner = proposeStudyPlan({
      assignments: [a], studyBlocks: blocks, semester: SEMESTER, currentSemesterWeek: 1,
      schedules: noSchedules, calendarMarks: noMarks, fromDate: date(0), toDate: date(3), now: NOW,
    });
    const ta = allocation.tasks[0];
    const pa = planner.items[0];
    expect(ta.remainingRequiredMinutes).toBe(120);
    expect(pa.proposedMinutes).toBe(ta.allocatedMinutes);
    expect(pa.proposedMinutes).toBe(120);
    expect(pa.completeCoverage).toBe(ta.completeCoverage);
    expect(pa.proposedBlocks).toEqual(ta.projectedBlocks);
  });

  it("missing estimate：两边都保持 completeCoverage=false + missing_estimate；allocator 不消费容量", () => {
    const a1 = mk("a1", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)) });
    const a2 = mk("a2", { ddl: iso(new Date(NOW.getTime() + 1 * 86400000)), estimatedMinutes: 60 });
    const pool = findFreeTime({
      start: NOW,
      now: NOW,
      end: new Date(NOW.getTime() + 1 * 86400000),
      semester: SEMESTER,
      currentSemesterWeek: 1,
      schedules: noSchedules,
      calendarMarks: noMarks,
      studyBlocks: noBlocks,
    });
    const allocation = allocateStudyCapacity({
      assignments: [a1, a2], studyBlocks: noBlocks, freeSlots: pool,
      fromDate: date(0), toDate: date(1), now: NOW,
    });
    const planner = proposeStudyPlan({
      assignments: [a1, a2], studyBlocks: noBlocks, semester: SEMESTER, currentSemesterWeek: 1,
      schedules: noSchedules, calendarMarks: noMarks, fromDate: date(0), toDate: date(1), now: NOW,
    });
    const allocA1 = allocation.tasks.find((t) => t.assignmentId === "a1")!;
    const planA1 = planner.items.find((i) => i.assignmentId === "a1")!;
    expect(allocA1.classification).toBe("missing_estimate");
    expect(allocA1.allocatedMinutes).toBe(0);
    expect(planA1.completeCoverage).toBe(false);
    expect(planA1.reasons).toContain("missing_estimate");
    const planA2 = planner.items.find((i) => i.assignmentId === "a2")!;
    expect(planA2.proposedMinutes).toBe(60);
    expect(planA2.completeCoverage).toBe(true);
  });
});
