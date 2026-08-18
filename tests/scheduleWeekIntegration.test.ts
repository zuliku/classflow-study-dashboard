import { describe, it, expect } from "vitest";
import { isScheduleActive } from "@/lib/schedule";
import { findScheduleConflicts, sharesActiveWeek } from "@/lib/conflicts";
import { CourseSchedule } from "@/types";

const sched = (weeks: string, day = 1, start = "08:00", end = "09:40"): CourseSchedule => ({
  id: `s_${weeks}_${day}_${start}`,
  courseId: "c1",
  dayOfWeek: day,
  startTime: start,
  endTime: end,
  location: "",
  weeks,
});

describe("isScheduleActive — 统一周次解析（多段/枚举/中文逗号）", () => {
  it("1-5,7-17：第 6 周不生效，第 7 周生效", () => {
    const s = sched("1-5,7-17");
    expect(isScheduleActive(s, 5)).toBe(true);
    expect(isScheduleActive(s, 6)).toBe(false);
    expect(isScheduleActive(s, 7)).toBe(true);
    expect(isScheduleActive(s, 17)).toBe(true);
    expect(isScheduleActive(s, 18)).toBe(false);
  });

  it("1-4,6-7,9-17：5/8 周不生效", () => {
    const s = sched("1-4,6-7,9-17");
    expect(isScheduleActive(s, 4)).toBe(true);
    expect(isScheduleActive(s, 5)).toBe(false);
    expect(isScheduleActive(s, 6)).toBe(true);
    expect(isScheduleActive(s, 8)).toBe(false);
    expect(isScheduleActive(s, 9)).toBe(true);
  });

  it("3-7,9：第 8 周不生效，第 9 周生效", () => {
    const s = sched("3-7,9");
    expect(isScheduleActive(s, 3)).toBe(true);
    expect(isScheduleActive(s, 8)).toBe(false);
    expect(isScheduleActive(s, 9)).toBe(true);
  });

  it("中文逗号 1-5，7-17", () => {
    const s = sched("1-5，7-17");
    expect(isScheduleActive(s, 6)).toBe(false);
    expect(isScheduleActive(s, 7)).toBe(true);
  });

  it("1-16单周：偶数周不生效", () => {
    const s = sched("1-16单周");
    expect(isScheduleActive(s, 1)).toBe(true);
    expect(isScheduleActive(s, 2)).toBe(false);
    expect(isScheduleActive(s, 15)).toBe(true);
    expect(isScheduleActive(s, 17)).toBe(false);
  });

  it("excludedWeeks 优先于原始周次", () => {
    const s: CourseSchedule = { ...sched("1-16周"), excludedWeeks: [5] };
    expect(isScheduleActive(s, 5)).toBe(false);
    expect(isScheduleActive(s, 6)).toBe(true);
  });

  it("空 weeks 回退全学期（兼容旧行为）", () => {
    const s = sched("");
    expect(isScheduleActive(s, 1)).toBe(true);
    expect(isScheduleActive(s, 16)).toBe(true);
  });
});

describe("sharesActiveWeek / 冲突检测 — 多段周次", () => {
  it("1-5,7-17 与 6 周课程无共同周 → 不冲突", () => {
    const a = sched("1-5,7-17", 1, "08:00", "09:40");
    const b = sched("6", 1, "08:30", "10:00"); // 仅第 6 周
    expect(sharesActiveWeek(a, b)).toBe(false);
    expect(findScheduleConflicts([a, b]).length).toBe(0);
  });

  it("1-5,7-17 与 1-16 同天重叠 → 冲突（共同周 1-5 或 7-17）", () => {
    const a = sched("1-5,7-17", 1, "08:00", "09:40");
    const b = sched("1-16周", 1, "08:30", "10:00");
    expect(sharesActiveWeek(a, b)).toBe(true);
    expect(findScheduleConflicts([a, b]).length).toBe(1);
  });

  it("1-5,7-17 与 1-4,6-7,9-17 共同周存在（1-4 与 7/9-17）→ 冲突", () => {
    const a = sched("1-5,7-17", 1, "08:00", "09:40");
    const b = sched("1-4,6-7,9-17", 1, "08:30", "10:00");
    expect(findScheduleConflicts([a, b]).length).toBe(1);
  });

  it("单周与双周同天重叠 → 无共同周 → 不冲突", () => {
    const a = sched("单周", 1, "08:00", "09:40");
    const b = sched("双周", 1, "08:30", "10:00");
    expect(sharesActiveWeek(a, b)).toBe(false);
    expect(findScheduleConflicts([a, b]).length).toBe(0);
  });

  it("单周课程与 1-16 全周课程重叠 → 冲突（奇数周共同）", () => {
    const a = sched("单周", 1, "08:00", "09:40");
    const b = sched("1-16周", 1, "08:30", "10:00");
    expect(findScheduleConflicts([a, b]).length).toBe(1);
  });
});
