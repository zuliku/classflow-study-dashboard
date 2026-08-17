import { describe, it, expect } from "vitest";
import { CourseSchedule, Semester } from "@/types";
import { computeWeekCourseLoad } from "@/lib/studyLoad";

const semester: Semester = {
  id: "s1",
  name: "2026春",
  startDate: "2026-02-23", // 周一
  totalWeeks: 16,
};

const sched = (overrides: Partial<CourseSchedule>): CourseSchedule => ({
  id: "s1",
  courseId: "c1",
  dayOfWeek: 1,
  startTime: "08:00",
  endTime: "09:40",
  location: "教室",
  weeks: "1-16周",
  ...overrides,
});

describe("computeWeekCourseLoad", () => {
  it("totalHours / 每日 hours / count 正确（基于 endTime-startTime）", () => {
    const schedules = [
      sched({ id: "s1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40" }), // 1.67h
      sched({ id: "s2", dayOfWeek: 1, startTime: "10:00", endTime: "11:40" }), // 1.67h
      sched({ id: "s3", dayOfWeek: 3, startTime: "14:00", endTime: "15:40" }), // 1.67h
    ];
    const load = computeWeekCourseLoad(schedules, semester, 1);
    expect(load.totalHours).toBe(5);
    expect(load.days[0]).toEqual({ day: "周一", hours: 3.3, count: 2 });
    expect(load.days[2]).toEqual({ day: "周三", hours: 1.7, count: 1 });
    expect(load.days[4]).toEqual({ day: "周五", hours: 0, count: 0 });
  });

  it("totalSessions / averageHours 正确", () => {
    const schedules = [
      sched({ id: "s1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40" }),
      sched({ id: "s2", dayOfWeek: 2, startTime: "08:00", endTime: "09:40" }),
      sched({ id: "s3", dayOfWeek: 3, startTime: "08:00", endTime: "09:40" }),
      sched({ id: "s4", dayOfWeek: 4, startTime: "08:00", endTime: "09:40" }),
      sched({ id: "s5", dayOfWeek: 5, startTime: "08:00", endTime: "09:40" }),
      sched({ id: "s6", dayOfWeek: 6, startTime: "08:00", endTime: "09:40" }),
      sched({ id: "s7", dayOfWeek: 7, startTime: "08:00", endTime: "09:40" }),
    ];
    const load = computeWeekCourseLoad(schedules, semester, 1);
    expect(load.totalSessions).toBe(7);
    expect(load.averageHours).toBe(1.7); // 11.7 / 7 ≈ 1.67 → 1.7
  });

  it("busiestDay 返回最忙一天（并列取第一个）", () => {
    const schedules = [
      sched({ id: "s1", dayOfWeek: 1, startTime: "08:00", endTime: "11:40" }), // 3.7h 周一
      sched({ id: "s2", dayOfWeek: 2, startTime: "08:00", endTime: "09:40" }), // 1.7h 周二
      sched({ id: "s3", dayOfWeek: 5, startTime: "08:00", endTime: "11:40" }), // 3.7h 周五（并列，取周一）
    ];
    const load = computeWeekCourseLoad(schedules, semester, 1);
    expect(load.busiestDay).toEqual({ day: "周一", hours: 3.7 });
  });

  it("教学周外返回合理的 0 数据", () => {
    const schedules = [sched({ id: "s1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40" })];
    const load = computeWeekCourseLoad(schedules, semester, 20);
    expect(load.isInSemester).toBe(false);
    expect(load.totalHours).toBe(0);
    expect(load.totalSessions).toBe(0);
    expect(load.averageHours).toBe(0);
    expect(load.busiestDay).toBeNull();
    expect(load.days).toHaveLength(7);
    expect(load.days.every((d) => d.hours === 0 && d.count === 0)).toBe(true);
  });

  it("inactive schedules 不计入（如 9-16周 的课在第 1 周不生效）", () => {
    const schedules = [
      sched({ id: "s1", dayOfWeek: 1, weeks: "1-8周", startTime: "08:00", endTime: "09:40" }),
      sched({ id: "s2", dayOfWeek: 1, weeks: "9-16周", startTime: "10:00", endTime: "11:40" }),
    ];
    const week1 = computeWeekCourseLoad(schedules, semester, 1);
    expect(week1.days[0]).toEqual({ day: "周一", hours: 1.7, count: 1 });
    expect(week1.totalSessions).toBe(1);
    const week9 = computeWeekCourseLoad(schedules, semester, 9);
    expect(week9.days[0]).toEqual({ day: "周一", hours: 1.7, count: 1 });
  });

  it("excludedWeeks 继续正确（停课周不计入）", () => {
    const schedules = [
      sched({ id: "s1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", excludedWeeks: [2] }),
    ];
    const week2 = computeWeekCourseLoad(schedules, semester, 2);
    expect(week2.days[0]).toEqual({ day: "周一", hours: 0, count: 0 });
    expect(week2.totalSessions).toBe(0);
    const week3 = computeWeekCourseLoad(schedules, semester, 3);
    expect(week3.days[0]).toEqual({ day: "周一", hours: 1.7, count: 1 });
  });

  it("非法时间（两端均不可解析）返回 0 小时，但仍计入 count", () => {
    const schedules = [sched({ id: "s1", dayOfWeek: 1, startTime: "xx:yy", endTime: "zz:zz" })];
    const load = computeWeekCourseLoad(schedules, semester, 1);
    expect(load.days[0].count).toBe(1);
    expect(load.days[0].hours).toBe(0);
  });
});
