import { describe, it, expect } from "vitest";
import { CourseSchedule, StudyBlock } from "@/types";
import {
  analyzeStudyBlockPlacement,
  courseOverlapSuffix,
} from "@/lib/timeline/studyBlockPlacement";

const schedule = (overrides: Partial<CourseSchedule> = {}): CourseSchedule => ({
  id: "sch_1",
  courseId: "c1",
  dayOfWeek: 2, // 周二
  startTime: "10:00",
  endTime: "11:40",
  location: "",
  weeks: "1-16周",
  excludedWeeks: [],
  ...overrides,
});

const block = (overrides: Partial<StudyBlock> = {}): StudyBlock => ({
  id: "b1",
  title: "复习",
  date: "2026-08-11", // 周二
  startTime: "10:30",
  endTime: "11:30",
  source: "manual",
  ...overrides,
});

const state = {
  schedules: [schedule()],
  studyBlocks: [],
  courses: [{ id: "c1", name: "计算机网络" }],
  currentSemesterWeek: 1,
};

describe("analyzeStudyBlockPlacement", () => {
  it("StudyBlock 与 Course overlap → hardConflict=null，courseOverlaps=1（soft）", () => {
    const r = analyzeStudyBlockPlacement(block(), state);
    expect(r.hardConflict).toBeNull();
    expect(r.courseOverlaps).toHaveLength(1);
    expect(r.courseOverlaps[0]).toMatchObject({
      courseId: "c1",
      courseName: "计算机网络",
      startTime: "10:00",
      endTime: "11:40",
    });
  });

  it("StudyBlock 与 StudyBlock overlap → hardConflict != null", () => {
    const r = analyzeStudyBlockPlacement(block(), {
      ...state,
      studyBlocks: [block({ id: "other", title: "英语作文", startTime: "11:00", endTime: "12:00" })],
    });
    expect(r.hardConflict).not.toBeNull();
    expect(r.hardConflict?.title).toBe("英语作文");
  });

  it("同时与 Course + StudyBlock overlap → 两者都返回", () => {
    const r = analyzeStudyBlockPlacement(block(), {
      ...state,
      studyBlocks: [block({ id: "other", title: "英语作文", startTime: "11:00", endTime: "12:00" })],
    });
    expect(r.hardConflict).not.toBeNull();
    expect(r.courseOverlaps.length).toBeGreaterThanOrEqual(1);
  });

  it("无 overlap → hardConflict=null，courseOverlaps=[]", () => {
    const r = analyzeStudyBlockPlacement(
      block({ startTime: "14:00", endTime: "15:00" }),
      state
    );
    expect(r.hardConflict).toBeNull();
    expect(r.courseOverlaps).toEqual([]);
  });

  it("自身 block 不与自己冲突（move 场景排除 id）", () => {
    const r = analyzeStudyBlockPlacement(block({ id: "b1" }), {
      ...state,
      studyBlocks: [block({ id: "b1" })],
    });
    expect(r.hardConflict).toBeNull();
  });

  it("week 活动性：单周课在第 1 周生效；excludedWeeks 命中不产生 overlap", () => {
    // 单周课：第 1 周（单周）生效 → overlap
    const single = analyzeStudyBlockPlacement(block(), {
      ...state,
      schedules: [schedule({ weeks: "单周" })],
    });
    expect(single.courseOverlaps).toHaveLength(1);
    // 双周课：第 1 周不生效 → 无 overlap
    const double = analyzeStudyBlockPlacement(block(), {
      ...state,
      schedules: [schedule({ weeks: "双周" })],
    });
    expect(double.courseOverlaps).toHaveLength(0);
    // excludedWeeks 命中 → 无 overlap
    const excluded = analyzeStudyBlockPlacement(block(), {
      ...state,
      schedules: [schedule({ excludedWeeks: [1] })],
    });
    expect(excluded.courseOverlaps).toHaveLength(0);
  });
});

describe("courseOverlapSuffix", () => {
  it("无重叠返回空", () => {
    expect(courseOverlapSuffix([])).toBe("");
  });
  it("1 门课程返回单数文案", () => {
    expect(courseOverlapSuffix([{ courseName: "计算机网络" } as never])).toBe("，与《计算机网络》时间重叠");
  });
  it("多门课程返回计数文案", () => {
    expect(courseOverlapSuffix([{ courseName: "A" } as never, { courseName: "B" } as never])).toBe(
      "，与 2 门课程时间重叠"
    );
  });
});
