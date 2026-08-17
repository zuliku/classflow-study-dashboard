import { describe, it, expect } from "vitest";
import { CourseSchedule, ScheduleOccurrenceOverride } from "@/types";
import {
  resolveCourseOccurrencesForWeek,
  validateScheduleOccurrenceOverride,
} from "@/lib/scheduleOccurrences";

const schedule = (overrides: Partial<CourseSchedule> = {}): CourseSchedule => ({
  id: "s1",
  courseId: "c1",
  dayOfWeek: 3, // 周三
  startTime: "10:00",
  endTime: "11:40",
  location: "教101",
  weeks: "1-16周",
  ...overrides,
});

/** 测试 helper：避免判别联合 spread 的 TS 限制（字段在用例中语义完整） */
const override = (o: object): ScheduleOccurrenceOverride => o as ScheduleOccurrenceOverride;

const state = {
  schedules: [schedule()],
  overrides: [] as ScheduleOccurrenceOverride[],
  totalWeeks: 16,
  courses: [{ id: "c1", name: "数据结构" }, { id: "c2", name: "英语" }],
};

function week6Schedules(totalWeeks = 16) {
  return resolveCourseOccurrencesForWeek({
    schedules: state.schedules,
    overrides: state.overrides,
    week: 6,
    totalWeeks,
  });
}

describe("resolveCourseOccurrencesForWeek", () => {
  it("Case 1：cancel 第 6 周 → week6 隐藏，week5/7 仍显示", () => {
    state.overrides = [override({ id: "occ_1", kind: "cancel", courseId: "c1", baseScheduleId: "s1", week: 6 })];
    const w6 = week6Schedules();
    expect(w6).toHaveLength(0);
    for (const w of [5, 7]) {
      const r = resolveCourseOccurrencesForWeek({ schedules: state.schedules, overrides: state.overrides, week: w, totalWeeks: 16 });
      expect(r).toHaveLength(1);
      expect(r[0].source).toBe("base");
      expect(r[0].dayOfWeek).toBe(3);
    }
  });

  it("Case 2：move 第 6 周 → 原位置隐藏 + 目标位置出现（第 5/7 周不变）", () => {
    state.overrides = [
      override({
        kind: "move",
        courseId: "c1",
        baseScheduleId: "s1",
        week: 6,
        dayOfWeek: 6,
        startTime: "14:00",
        endTime: "15:40",
        location: "计算机楼302",
      }),
    ];
    const w6 = week6Schedules();
    expect(w6).toHaveLength(1);
    expect(w6[0]).toMatchObject({ source: "moved", dayOfWeek: 6, startTime: "14:00", endTime: "15:40", baseScheduleId: "s1" });
    expect(w6[0].week).toBe(6);
    for (const w of [5, 7]) {
      const r = resolveCourseOccurrencesForWeek({ schedules: state.schedules, overrides: state.overrides, week: w, totalWeeks: 16 });
      expect(r).toHaveLength(1);
      expect(r[0].source).toBe("base");
      expect(r[0].dayOfWeek).toBe(3);
    }
  });

  it("Case 3：extra 只出现在目标周", () => {
    state.overrides = [
      override({ id: "occ_1", kind: "extra", courseId: "c2", week: 6, dayOfWeek: 7, startTime: "19:00", endTime: "20:00", location: "教201" }),
    ];
    const w6 = week6Schedules();
    const w7 = resolveCourseOccurrencesForWeek({ schedules: state.schedules, overrides: state.overrides, week: 7, totalWeeks: 16 });
    expect(w6).toHaveLength(2); // base + extra
    expect(w6.find((o) => o.source === "extra")).toMatchObject({ dayOfWeek: 7, startTime: "19:00", endTime: "20:00", courseId: "c2" });
    expect(w7.some((o) => o.source === "extra")).toBe(false);
  });

  it("Case 4：单双周仍正确（单周课仅单周出现）", () => {
    state.overrides = [];
    const odd = resolveCourseOccurrencesForWeek({ schedules: [schedule({ weeks: "单周" })], overrides: [], week: 1, totalWeeks: 16 });
    const even = resolveCourseOccurrencesForWeek({ schedules: [schedule({ weeks: "单周" })], overrides: [], week: 2, totalWeeks: 16 });
    expect(odd).toHaveLength(1);
    expect(even).toHaveLength(0);
  });

  it("Case 5：excludedWeeks 与 override 共存：excluded 周 base 不出现，但 extra 仍出现", () => {
    state.overrides = [
      override({ id: "occ_1", kind: "extra", courseId: "c1", week: 3, dayOfWeek: 5, startTime: "18:00", endTime: "19:00", location: "" }),
    ];
    const r = resolveCourseOccurrencesForWeek({
      schedules: [schedule({ excludedWeeks: [3] })],
      overrides: state.overrides,
      week: 3,
      totalWeeks: 16,
    });
    // base 因 excludedWeeks 隐藏；extra 与 override 无关照常出现
    expect(r.some((o) => o.source === "base")).toBe(false);
    expect(r.some((o) => o.source === "extra")).toBe(true);
  });
});

describe("validateScheduleOccurrenceOverride", () => {
  it("Case 6：move target 与另一课程该周 effective 冲突 → reject", () => {
    const v = validateScheduleOccurrenceOverride(
      {
        kind: "move",
        courseId: "c1",
        baseScheduleId: "s1",
        week: 6,
        dayOfWeek: 4,
        startTime: "10:00",
        endTime: "11:40",
      },
      {
        ...state,
        schedules: [
          schedule(),
          schedule({ id: "s2", courseId: "c2", dayOfWeek: 4, startTime: "10:00", endTime: "11:40" }),
        ],
      }
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.code).toBe("CONFLICT");
  });

  it("Case 7：同 baseScheduleId + week 重复 override → reject（不叠加）", () => {
    const v = validateScheduleOccurrenceOverride(
      { kind: "move", courseId: "c1", baseScheduleId: "s1", week: 6, dayOfWeek: 5, startTime: "14:00", endTime: "15:00" },
      {
        ...state,
        overrides: [override({ id: "occ_1", kind: "cancel", courseId: "c1", baseScheduleId: "s1", week: 6 })],
      }
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.code).toBe("DUPLICATE");
  });

  it("move 不把自己正在替换的 original 算作冲突", () => {
    const v = validateScheduleOccurrenceOverride(
      { kind: "move", courseId: "c1", baseScheduleId: "s1", week: 6, dayOfWeek: 3, startTime: "10:00", endTime: "11:40" },
      state
    );
    expect(v.ok).toBe(true);
  });

  it("学期范围外 week → INVALID_INPUT", () => {
    const v = validateScheduleOccurrenceOverride(
      { kind: "extra", courseId: "c1", week: 17, dayOfWeek: 1, startTime: "10:00", endTime: "11:00" },
      state
    );
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.code).toBe("INVALID_INPUT");
  });
});
