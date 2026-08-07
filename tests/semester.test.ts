import { describe, it, expect } from "vitest";
import { getSemesterWeek, getWeekDateRange, getWeekStart } from "@/lib/semester";
import { Semester } from "@/types";
import { format, differenceInCalendarDays } from "date-fns";

const semester: Semester = {
  id: "sem_test",
  name: "2026年春季学期",
  startDate: "2026-02-23", // 周一（学期第 1 周起始日）
  totalWeeks: 16,
};

describe("getSemesterWeek", () => {
  it("开学当天为第 1 周", () => {
    expect(getSemesterWeek("2026-02-23", semester)).toBe(1);
  });

  it("后续教学周（同月内）", () => {
    expect(getSemesterWeek("2026-03-02", semester)).toBe(2); // 第 2 周周一
    expect(getSemesterWeek("2026-03-05", semester)).toBe(2); // 第 2 周周中
    expect(getSemesterWeek("2026-03-09", semester)).toBe(3); // 第 3 周周一
  });

  it("跨月份计算", () => {
    expect(getSemesterWeek("2026-04-01", semester)).toBe(6);
    expect(getSemesterWeek("2026-05-01", semester)).toBe(10);
  });

  it("学期开始前的日期返回 <=0", () => {
    expect(getSemesterWeek("2026-02-16", semester)).toBe(0);
    expect(getSemesterWeek("2026-02-22", semester)).toBe(0);
    expect(getSemesterWeek("2026-01-01", semester)).toBeLessThanOrEqual(0);
  });

  it("学期结束后返回超出 totalWeeks 的周次（不截断）", () => {
    expect(getSemesterWeek("2026-06-22", semester)).toBe(18);
    expect(getSemesterWeek("2026-06-22", semester)).toBeGreaterThan(semester.totalWeeks);
  });
});

describe("getWeekStart / getWeekDateRange", () => {
  it("第 1 周为开学周周一至周日", () => {
    const days = getWeekDateRange(semester, 1);
    expect(days).toHaveLength(7);
    expect(format(days[0], "yyyy-MM-dd")).toBe("2026-02-23");
    expect(format(days[6], "yyyy-MM-dd")).toBe("2026-03-01");
  });

  it("第 3 周跨过月份边界", () => {
    const days = getWeekDateRange(semester, 3);
    expect(format(days[0], "yyyy-MM-dd")).toBe("2026-03-09");
    expect(format(days[6], "yyyy-MM-dd")).toBe("2026-03-15");
  });

  it("第 6 周跨月份（3 月底 → 4 月初）", () => {
    const days = getWeekDateRange(semester, 6);
    expect(format(days[0], "yyyy-MM-dd")).toBe("2026-03-30");
    expect(format(days[6], "yyyy-MM-dd")).toBe("2026-04-05");
  });

  it("任意连续两天相差 1 天", () => {
    const days = getWeekDateRange(semester, 4);
    for (let i = 1; i < days.length; i++) {
      expect(differenceInCalendarDays(days[i], days[i - 1])).toBe(1);
    }
  });

  it("getWeekStart 与周区间首日一致", () => {
    expect(format(getWeekStart(semester, 16), "yyyy-MM-dd")).toBe(
      format(getWeekDateRange(semester, 16)[0], "yyyy-MM-dd")
    );
  });
});
