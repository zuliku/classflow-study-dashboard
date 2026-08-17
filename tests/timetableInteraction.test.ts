import { describe, it, expect } from "vitest";
import { CourseSchedule } from "@/types";
import {
  snapMinutes,
  minutesToTime,
  getScheduleDuration,
  clampScheduleMove,
  pointerToMinutes,
  pointerToDayIndex,
  calculateDraggedSchedule,
  calculateResizedSchedule,
  validateScheduleCandidate,
  TIMETABLE_DAY_START_MINUTES,
  TIMETABLE_DAY_END_MINUTES,
  TIMETABLE_TOTAL_MINUTES,
  MIN_SCHEDULE_DURATION,
} from "@/lib/timetableInteraction";

const sched = (overrides: Partial<CourseSchedule> = {}): CourseSchedule => ({
  id: "s1",
  courseId: "c1",
  dayOfWeek: 1,
  startTime: "10:00",
  endTime: "11:40",
  location: "教三 305",
  weeks: "1-16周",
  excludedWeeks: [5],
  ...overrides,
});

describe("15 分钟 Snap", () => {
  it("14:08 → 14:15；14:21 → 14:15；14:23 → 14:30", () => {
    expect(snapMinutes(8 * 60 + 8)).toBe(8 * 60 + 15);
    expect(snapMinutes(14 * 60 + 21)).toBe(14 * 60 + 15);
    expect(snapMinutes(14 * 60 + 23)).toBe(14 * 60 + 30);
  });

  it("整数分钟保持不动", () => {
    expect(snapMinutes(14 * 60 + 15)).toBe(14 * 60 + 15);
    expect(snapMinutes(10 * 60)).toBe(600);
  });
});

describe("分钟 ↔ 时间映射", () => {
  it("minutesToTime 双向一致", () => {
    expect(minutesToTime(8 * 60)).toBe("08:00");
    expect(minutesToTime(21 * 60)).toBe("21:00");
    expect(minutesToTime(14 * 60 + 15)).toBe("14:15");
    expect(minutesToTime(0)).toBe("00:00");
  });

  it("pointerToMinutes 映射 grid rect", () => {
    // rect: top=0 height=780 → 顶部 08:00，底部 21:00
    expect(pointerToMinutes(0, 0, 780)).toBe(TIMETABLE_DAY_START_MINUTES);
    expect(pointerToMinutes(780, 0, 780)).toBe(TIMETABLE_DAY_END_MINUTES);
    // 中点 14:30
    expect(pointerToMinutes(390, 0, 780)).toBe(14 * 60 + 30);
  });

  it("pointerToDayIndex 映射星期列（周一=0，越界 clamp）", () => {
    expect(pointerToDayIndex(0, 0, 700)).toBe(0);
    expect(pointerToDayIndex(350, 0, 700)).toBe(3);
    expect(pointerToDayIndex(700, 0, 700)).toBe(6);
    expect(pointerToDayIndex(-100, 0, 700)).toBe(0);
    expect(pointerToDayIndex(9999, 0, 700)).toBe(6);
  });
});

describe("Move：保持时长 + 边界 clamp", () => {
  it("10:00–11:40 拖到 14:17 → 吸附为 14:15–15:55，时长不变", () => {
    const base = sched();
    const moved = calculateDraggedSchedule(base, 14 * 60 + 17, 0, 3);
    expect(moved.startTime).toBe("14:15");
    expect(moved.endTime).toBe("15:55");
    expect(getScheduleDuration(moved)).toBe(getScheduleDuration(base));
  });

  it("拖到 07:00 → start clamp 到 08:00（下界）", () => {
    const moved = calculateDraggedSchedule(sched(), 7 * 60, 0, 1);
    expect(moved.startTime).toBe("08:00");
    expect(moved.endTime).toBe("09:40");
  });

  it("拖到 22:00 → end 不超 21:00（上界）", () => {
    const moved = calculateDraggedSchedule(sched(), 22 * 60, 0, 1);
    expect(moved.startTime).toBe("19:20");
    expect(moved.endTime).toBe("21:00");
  });

  it("clampScheduleMove 直接边界检查", () => {
    expect(clampScheduleMove(sched(), 7 * 60)).toBe(TIMETABLE_DAY_START_MINUTES);
    expect(clampScheduleMove(sched(), 22 * 60)).toBe(TIMETABLE_DAY_END_MINUTES - 100);
  });
});

describe("Resize：只改 endTime，15 分钟吸附，最短 30 分钟", () => {
  it("14:15–15:55 拉到底部 16:23 → 14:15–16:30", () => {
    const base = sched({ startTime: "14:15", endTime: "15:55" });
    const resized = calculateResizedSchedule(base, 16 * 60 + 23);
    expect(resized.startTime).toBe("14:15");
    expect(resized.dayOfWeek).toBe(base.dayOfWeek);
    expect(resized.endTime).toBe("16:30");
  });

  it("结束时间不能早于 start + 30 分钟", () => {
    const base = sched({ startTime: "14:15", endTime: "15:55" });
    const resized = calculateResizedSchedule(base, 14 * 60 + 10);
    expect(resized.endTime).toBe("14:45");
  });

  it("结束时间 clamp 到 21:00 上界", () => {
    const base = sched({ startTime: "14:15", endTime: "15:55" });
    const resized = calculateResizedSchedule(base, 22 * 60 + 8);
    expect(resized.endTime).toBe("21:00");
  });

  it("贴近 21:00 的课程（20:45 起）仍保证 end > start", () => {
    const base = sched({ startTime: "20:45", endTime: "21:00" });
    const resized = calculateResizedSchedule(base, 21 * 60 + 30);
    expect(resized.endTime).toBe("21:00");
  });
});

describe("Candidate 保持身份字段", () => {
  it("Move 保留 id / courseId / location / weeks / excludedWeeks", () => {
    const base = sched({ excludedWeeks: [5], weeks: "单周" });
    const moved = calculateDraggedSchedule(base, 15 * 60, 0, 5);
    expect(moved.id).toBe("s1");
    expect(moved.courseId).toBe("c1");
    expect(moved.location).toBe("教三 305");
    expect(moved.weeks).toBe("单周");
    expect(moved.excludedWeeks).toEqual([5]);
  });

  it("Resize 保留 id / weeks / excludedWeeks", () => {
    const base = sched({ excludedWeeks: [5], weeks: "1-8周" });
    const resized = calculateResizedSchedule(base, 18 * 60);
    expect(resized.id).toBe("s1");
    expect(resized.weeks).toBe("1-8周");
    expect(resized.excludedWeeks).toEqual([5]);
    expect(resized.dayOfWeek).toBe(1);
  });
});

describe("冲突校验（复用 findScheduleConflicts）", () => {
  const other = sched({
    id: "s2",
    courseId: "c2",
    dayOfWeek: 3,
    startTime: "14:00",
    endTime: "15:40",
  });

  it("无重叠 → valid", () => {
    const candidate = sched({ id: "s1", dayOfWeek: 5, startTime: "10:00", endTime: "11:40" });
    expect(validateScheduleCandidate(candidate, [other], "s1").valid).toBe(true);
  });

  it("同星期 + 时间重叠 → invalid，并返回冲突", () => {
    const candidate = sched({ id: "s1", dayOfWeek: 3, startTime: "14:30", endTime: "16:00" });
    const { valid, conflict } = validateScheduleCandidate(candidate, [other], "s1");
    expect(valid).toBe(false);
    expect(conflict).not.toBeNull();
  });

  it("自身原 schedule 被排除（不与自己冲突）", () => {
    const self = sched({ id: "s1", dayOfWeek: 3, startTime: "14:30", endTime: "16:00" });
    // others 含自己原时段：candidate 与「自己」重叠不应判为冲突
    const { valid } = validateScheduleCandidate(
      { ...self, startTime: "14:30", endTime: "16:00" },
      [self],
      "s1"
    );
    expect(valid).toBe(true);
  });

  it("无共同生效周 → 不冲突（1-8周 vs 9-16周）", () => {
    const a = sched({ id: "s1", dayOfWeek: 3, weeks: "1-8周", startTime: "14:00", endTime: "15:40" });
    const b = sched({ id: "s2", dayOfWeek: 3, weeks: "9-16周", startTime: "14:30", endTime: "16:00" });
    expect(validateScheduleCandidate(b, [a], "s2").valid).toBe(true);
  });
});

describe("常量一致性", () => {
  it("工作区 08:00–21:00，共 780 分钟", () => {
    expect(TIMETABLE_DAY_START_MINUTES).toBe(8 * 60);
    expect(TIMETABLE_DAY_END_MINUTES).toBe(21 * 60);
    expect(TIMETABLE_TOTAL_MINUTES).toBe(780);
    expect(MIN_SCHEDULE_DURATION).toBe(30);
  });

  it("getScheduleDuration 非法时间回退最短时长", () => {
    expect(getScheduleDuration(sched({ startTime: "xx:yy", endTime: "10:00" }))).toBe(30);
    expect(getScheduleDuration(sched())).toBe(100);
  });
});
