import { describe, it, expect } from "vitest";
import { CourseSchedule } from "@/types";
import { deriveNextCourseSession } from "@/lib/courses/nextSession";

const sched = (overrides: Partial<CourseSchedule> = {}): CourseSchedule => ({
  id: "s1",
  courseId: "c1",
  dayOfWeek: 2, // 周二
  startTime: "14:00",
  endTime: "15:40",
  location: "经管楼 B302",
  weeks: "1-16周",
  excludedWeeks: [],
  ...overrides,
});

describe("deriveNextCourseSession", () => {
  it("同一周内返回下一节尚未开始的课", () => {
    const now = new Date(2026, 7, 10); // 周一 2026-08-10
    const next = deriveNextCourseSession("c1", [sched()], 1, now);
    expect(next).toEqual({
      dayOfWeek: 2,
      startTime: "14:00",
      endTime: "15:40",
      location: "经管楼 B302",
    });
  });

  it("今天已经上过的课不算下一节", () => {
    const now = new Date(2026, 7, 11, 16, 0); // 周二 16:00（14:00 的课已结束）
    const next = deriveNextCourseSession("c1", [sched()], 1, now);
    expect(next).toBeNull();
  });

  it("正在进行的课不算下一节", () => {
    const now = new Date(2026, 7, 11, 14, 30); // 周二 14:30（14:00–15:40 上课中）
    const next = deriveNextCourseSession("c1", [sched()], 1, now);
    expect(next).toBeNull();
  });

  it("单双周 / excludedWeeks 遵循 isScheduleActive", () => {
    const now = new Date(2026, 7, 10); // 周一
    // 双周课：第 1 周（单周）不生效
    const odd = deriveNextCourseSession("c1", [sched({ weeks: "双周" })], 1, now);
    expect(odd).toBeNull();
    // 排除周：第 2 周排除 → 不生效
    const excluded = deriveNextCourseSession(
      "c1",
      [sched({ weeks: "1-16周", excludedWeeks: [2] })],
      2,
      now
    );
    expect(excluded).toBeNull();
    // 第 3 周正常生效
    const active = deriveNextCourseSession("c1", [sched({ excludedWeeks: [2] })], 3, now);
    expect(active?.startTime).toBe("14:00");
  });
});
