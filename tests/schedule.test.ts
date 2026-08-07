import { describe, it, expect } from "vitest";
import { isScheduleActive } from "@/store/useAppStore";
import { findScheduleConflicts } from "@/lib/conflicts";
import { CourseSchedule } from "@/types";

function mk(overrides: Partial<CourseSchedule> & { id: string }): CourseSchedule {
  return {
    courseId: "c_1",
    dayOfWeek: 1,
    startTime: "08:00",
    endTime: "09:40",
    location: "教二 201",
    weeks: "1-16周",
    ...overrides,
  };
}

describe("isScheduleActive", () => {
  it("支持 1-16周", () => {
    const s = mk({ id: "s1", weeks: "1-16周" });
    expect(isScheduleActive(s, 1)).toBe(true);
    expect(isScheduleActive(s, 8)).toBe(true);
    expect(isScheduleActive(s, 16)).toBe(true);
    expect(isScheduleActive(s, 17)).toBe(false);
    expect(isScheduleActive(s, 0)).toBe(false);
  });

  it("支持 1-8周", () => {
    const s = mk({ id: "s2", weeks: "1-8周" });
    expect(isScheduleActive(s, 1)).toBe(true);
    expect(isScheduleActive(s, 8)).toBe(true);
    expect(isScheduleActive(s, 9)).toBe(false);
    expect(isScheduleActive(s, 12)).toBe(false);
  });

  it("支持 9-16周", () => {
    const s = mk({ id: "s3", weeks: "9-16周" });
    expect(isScheduleActive(s, 8)).toBe(false);
    expect(isScheduleActive(s, 9)).toBe(true);
    expect(isScheduleActive(s, 16)).toBe(true);
    expect(isScheduleActive(s, 17)).toBe(false);
  });

  it("支持单周", () => {
    const s = mk({ id: "s4", weeks: "单周" });
    expect(isScheduleActive(s, 1)).toBe(true);
    expect(isScheduleActive(s, 2)).toBe(false);
    expect(isScheduleActive(s, 3)).toBe(true);
    expect(isScheduleActive(s, 15)).toBe(true);
  });

  it("支持双周", () => {
    const s = mk({ id: "s5", weeks: "双周" });
    expect(isScheduleActive(s, 1)).toBe(false);
    expect(isScheduleActive(s, 2)).toBe(true);
    expect(isScheduleActive(s, 4)).toBe(true);
    expect(isScheduleActive(s, 16)).toBe(true);
  });

  it("支持 excludedWeeks（停课周不生效）", () => {
    const s = mk({ id: "s6", weeks: "1-16周", excludedWeeks: [5] });
    expect(isScheduleActive(s, 4)).toBe(true);
    expect(isScheduleActive(s, 5)).toBe(false);
    expect(isScheduleActive(s, 6)).toBe(true);
  });

  it("缺省 weeks 按 1-16周 处理", () => {
    const s = mk({ id: "s7", weeks: "" });
    expect(isScheduleActive(s, 1)).toBe(true);
    expect(isScheduleActive(s, 16)).toBe(true);
    expect(isScheduleActive(s, 17)).toBe(false);
  });
});

describe("findScheduleConflicts", () => {
  it("同星期 + 时间重叠 + 相同教学周 → 冲突", () => {
    const a = mk({ id: "a", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", weeks: "1-16周" });
    const b = mk({ id: "b", dayOfWeek: 1, startTime: "09:00", endTime: "10:40", weeks: "1-16周" });
    const conflicts = findScheduleConflicts([a, b]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].dayOfWeek).toBe(1);
  });

  it("同星期 + 时间不重叠 → 不冲突", () => {
    const a = mk({ id: "a", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", weeks: "1-16周" });
    const b = mk({ id: "b", dayOfWeek: 1, startTime: "10:00", endTime: "11:40", weeks: "1-16周" });
    expect(findScheduleConflicts([a, b])).toHaveLength(0);
  });

  it("1-8周 与 9-16周 同时间 → 不冲突", () => {
    const a = mk({ id: "a", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", weeks: "1-8周" });
    const b = mk({ id: "b", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", weeks: "9-16周" });
    expect(findScheduleConflicts([a, b])).toHaveLength(0);
  });

  it("单周与双周 → 不冲突", () => {
    const a = mk({ id: "a", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", weeks: "单周" });
    const b = mk({ id: "b", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", weeks: "双周" });
    expect(findScheduleConflicts([a, b])).toHaveLength(0);
  });

  it("excludedWeeks 影响冲突判断", () => {
    // 仅第 5 周可能重叠，但 A 在第 5 周停课 → 无共同生效周 → 不冲突
    const a = mk({ id: "a", weeks: "1-16周", excludedWeeks: [5] });
    const b = mk({ id: "b", weeks: "5-5周" });
    expect(findScheduleConflicts([a, b])).toHaveLength(0);

    // 去掉停课后，第 5 周共同生效 → 冲突
    const a2 = mk({ id: "a2", weeks: "1-16周" });
    expect(findScheduleConflicts([a2, b])).toHaveLength(1);
  });

  it("星期不同 → 不冲突", () => {
    const a = mk({ id: "a", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", weeks: "1-16周" });
    const b = mk({ id: "b", dayOfWeek: 2, startTime: "08:00", endTime: "09:40", weeks: "1-16周" });
    expect(findScheduleConflicts([a, b])).toHaveLength(0);
  });
});
