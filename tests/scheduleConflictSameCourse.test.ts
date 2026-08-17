import { describe, it, expect } from "vitest";
import { findScheduleConflicts } from "@/lib/conflicts";
import { validateScheduleCandidate } from "@/lib/timetableInteraction";
import { CourseSchedule } from "@/types";

const s = (id: string, courseId: string, day: number, start: string, end: string): CourseSchedule => ({
  id,
  courseId,
  dayOfWeek: day,
  startTime: start,
  endTime: end,
  location: "",
  weeks: "1-16周",
});

describe("findScheduleConflicts — ignoreSameCourse", () => {
  it("默认：同课程重叠算冲突（导入/新增语义不变）", () => {
    const conflicts = findScheduleConflicts([
      s("a", "c1", 1, "08:00", "09:40"),
      s("b", "c1", 1, "09:00", "10:40"),
    ]);
    expect(conflicts.length).toBe(1);
  });

  it("ignoreSameCourse：同课程重叠不算冲突", () => {
    const conflicts = findScheduleConflicts(
      [s("a", "c1", 1, "08:00", "09:40"), s("b", "c1", 1, "09:00", "10:40")],
      { ignoreSameCourse: true }
    );
    expect(conflicts.length).toBe(0);
  });

  it("ignoreSameCourse：不同课程重叠仍算冲突", () => {
    const conflicts = findScheduleConflicts(
      [s("a", "c1", 1, "08:00", "09:40"), s("b", "c2", 1, "09:00", "10:40")],
      { ignoreSameCourse: true }
    );
    expect(conflicts.length).toBe(1);
  });
});

describe("validateScheduleCandidate — 拖动/调整同课程时段不冲突", () => {
  it("拖动到与同课程其它时段重叠 → valid（不报冲突）", () => {
    const candidate = s("a", "c1", 1, "09:00", "10:40");
    const all = [
      candidate,
      s("b", "c1", 1, "08:00", "09:40"), // 同课程另一时段，重叠
      s("c", "c2", 3, "08:00", "09:40"), // 其它课程，不同天不冲突
    ];
    const res = validateScheduleCandidate(candidate, all, "a");
    expect(res.valid).toBe(true);
    expect(res.conflict).toBeNull();
  });

  it("拖动到与其它课程重叠 → invalid（报冲突）", () => {
    const candidate = s("a", "c1", 1, "09:00", "10:40");
    const all = [
      candidate,
      s("b", "c2", 1, "09:30", "11:10"), // 其它课程同天重叠
    ];
    const res = validateScheduleCandidate(candidate, all, "a");
    expect(res.valid).toBe(false);
    expect(res.conflict).not.toBeNull();
  });
});
