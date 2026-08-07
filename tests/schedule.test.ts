import { describe, it, expect, beforeEach } from "vitest";
import { isScheduleActive, timeToMinutes, isValidTimeRange, hasTimeOverlap } from "@/lib/schedule";
import { findScheduleConflicts } from "@/lib/conflicts";
import { useAppStore } from "@/store/useAppStore";
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

  it("编辑 Slot 的候选冲突：替换原时段后检测", () => {
    // 编辑场景：s2 从 10:00 改为 08:30，应检测到与 s1 冲突
    const s1 = mk({ id: "s1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", weeks: "1-16周" });
    const s2 = mk({ id: "s2", dayOfWeek: 1, startTime: "10:00", endTime: "11:40", weeks: "1-16周" });
    const original = [s1, s2];

    const candidate: CourseSchedule = { ...s2, startTime: "08:30", endTime: "10:00" };
    const conflicts = findScheduleConflicts([
      ...original.filter((s) => s.id !== s2.id),
      candidate,
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].scheduleA.id === candidate.id || conflicts[0].scheduleB.id === candidate.id).toBe(true);
  });

  it("编辑 Slot 改为不重叠时间 → 候选无冲突", () => {
    const s1 = mk({ id: "s1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", weeks: "1-16周" });
    const s2 = mk({ id: "s2", dayOfWeek: 1, startTime: "10:00", endTime: "11:40", weeks: "1-16周" });
    const candidate: CourseSchedule = { ...s2, startTime: "14:00", endTime: "15:40" };
    expect(
      findScheduleConflicts([s1, candidate]).length
    ).toBe(0);
  });
});

describe("timeToMinutes / isValidTimeRange / hasTimeOverlap", () => {
  it("timeToMinutes 正常转换与非法输入", () => {
    expect(timeToMinutes("08:00")).toBe(480);
    expect(timeToMinutes("23:59")).toBe(1439);
    expect(timeToMinutes("24:00")).toBeNull();
    expect(timeToMinutes("8:00")).toBeNull();
    expect(timeToMinutes("abc")).toBeNull();
  });

  it("isValidTimeRange 校验格式与先后顺序", () => {
    expect(isValidTimeRange("08:00", "09:40")).toBe(true);
    expect(isValidTimeRange("09:40", "08:00")).toBe(false); // 结束早于开始
    expect(isValidTimeRange("08:00", "08:00")).toBe(false); // 相等
    expect(isValidTimeRange("", "09:40")).toBe(false);
    expect(isValidTimeRange("08:00", "")).toBe(false);
  });

  it("hasTimeOverlap 区间重叠判断", () => {
    expect(hasTimeOverlap("08:00", "09:40", "09:00", "10:40")).toBe(true); // 部分重叠
    expect(hasTimeOverlap("08:00", "10:00", "09:00", "11:00")).toBe(true); // 包含
    expect(hasTimeOverlap("08:00", "09:40", "10:00", "11:40")).toBe(false); // 相邻不重叠
    expect(hasTimeOverlap("08:00", "09:40", "09:40", "11:00")).toBe(false); // 端点相接不算
    expect(hasTimeOverlap("08:00", "09:40", "bad", "11:00")).toBe(false); // 非法输入
  });
});

describe("updateSchedule 回归（store）", () => {
  beforeEach(() => {
    useAppStore.getState().resetAllDataToDefault();
  });

  it("编辑普通字段保留 excludedWeeks，且不影响其他时段", () => {
    // 给 s1 注入停课周
    useAppStore.setState((st) => ({
      schedules: st.schedules.map((s) =>
        s.id === "s1" ? { ...s, excludedWeeks: [5] } : s
      ),
    }));
    const s2Before = useAppStore.getState().schedules.find((s) => s.id === "s2")!;

    const s1 = useAppStore.getState().schedules.find((s) => s.id === "s1")!;
    useAppStore.getState().updateSchedule({
      ...s1,
      dayOfWeek: 2,
      startTime: "09:00",
      endTime: "10:40",
      location: "新教室 101",
      weeks: "1-8周",
    });

    const after = useAppStore.getState();
    const s1After = after.schedules.find((s) => s.id === "s1")!;
    expect(s1After.dayOfWeek).toBe(2);
    expect(s1After.startTime).toBe("09:00");
    expect(s1After.endTime).toBe("10:40");
    expect(s1After.location).toBe("新教室 101");
    expect(s1After.weeks).toBe("1-8周");
    expect(s1After.excludedWeeks).toEqual([5]); // 停课状态保留

    const s2After = after.schedules.find((s) => s.id === "s2")!;
    expect(s2After).toEqual(s2Before); // 其他时段不受影响
    expect(after.schedules).toHaveLength(12); // 数量不变（只更新不增删）
  });

  it("删除一个时段不影响课程与其他时段", () => {
    const store = useAppStore.getState();
    store.deleteSchedule("s1");
    const after = useAppStore.getState();
    expect(after.schedules.find((s) => s.id === "s1")).toBeUndefined();
    expect(after.schedules).toHaveLength(11);
    expect(after.courses.find((c) => c.id === "c_1")).toBeTruthy(); // 课程保留
  });
});
