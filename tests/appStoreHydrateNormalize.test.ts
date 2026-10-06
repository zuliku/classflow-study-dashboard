// @vitest-environment jsdom
/**
 * 主 store hydrate 归一（脏数据熔断）：
 * courses / schedules / marks / overrides 此前 cast-only，缺字段即崩渲染；
 * 现逐条归一（id 系缺失丢弃，其余补默认），经真实 rehydrate 路径验证。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "@/store/useAppStore";
import { buildFullDemoData } from "@/lib/dev/fullDemoData";

const KEY = "classflow-storage-v2";

function seed(state: Record<string, unknown>) {
  localStorage.setItem(KEY, JSON.stringify({ state, version: 8 }));
}

async function rehydrate() {
  // @ts-expect-error — persist 存在于 store
  await (useAppStore.persist as unknown as { rehydrate: () => Promise<void> }).rehydrate();
}

beforeEach(() => {
  localStorage.clear();
});

describe("hydrate normalize（脏数据不崩）", () => {
  it("缺 name 的课程丢弃；缺 materials 的补 []；非法 material 条目剔除", async () => {
    seed({
      courses: [
        { id: "c-bad" },
        { id: "c1", name: "高数", materials: [{ id: "m1", title: "讲义" }, null, "junk"] },
      ],
      schedules: [],
      calendarMarks: [],
      scheduleOccurrenceOverrides: [],
    });
    await rehydrate();
    const courses = useAppStore.getState().courses;
    expect(courses.map((c) => c.id)).toEqual(["c1"]);
    expect(courses[0].materials).toEqual([{ id: "m1", title: "讲义" }]);
    expect(courses[0].teacher).toBe("");
  });

  it("缺 courseId 的排课丢弃；dayOfWeek 越界收敛到 1-7", async () => {
    seed({
      courses: [],
      schedules: [
        { id: "s-bad" },
        { id: "s1", courseId: "c1", dayOfWeek: 9, startTime: "08:00", endTime: "09:40", location: "", weeks: "" },
      ],
      calendarMarks: [],
      scheduleOccurrenceOverrides: [],
    });
    await rehydrate();
    const schedules = useAppStore.getState().schedules;
    expect(schedules.map((s) => s.id)).toEqual(["s1"]);
    expect(schedules[0].dayOfWeek).toBe(7);
  });

  it("非法 mark/override 丢弃，合法保留", async () => {
    seed({
      courses: [],
      schedules: [],
      calendarMarks: [
        { id: "mk-bad" },
        { id: "mk1", date: "2026-01-01", type: "weird", title: "考试" },
      ],
      scheduleOccurrenceOverrides: [
        { id: "o-bad", kind: "cancel" },
        { id: "o1", kind: "cancel", courseId: "c1", baseScheduleId: "s1", week: 3 },
      ],
    });
    await rehydrate();
    const marks = useAppStore.getState().calendarMarks;
    // mk1 type 非法 → 回落 activity；注意 DDL 自动 mark 可能追加，此处只断言包含关系
    const mk1 = marks.find((m) => m.id === "mk1");
    expect(mk1?.type).toBe("activity");
    expect(marks.some((m) => m.id === "mk-bad")).toBe(false);
    const overrides = useAppStore.getState().scheduleOccurrenceOverrides;
    expect(overrides.map((o) => o.id)).toEqual(["o1"]);
  });

  it("用户资料脏字段归一（name:null→\"\"，学分非数→0），非对象回落空资料", async () => {
    seed({
      userProfile: { name: null, avatarUrl: 123, college: "经管", completedCredits: NaN, totalCredits: "x" },
      courses: [],
      schedules: [],
      calendarMarks: [],
      scheduleOccurrenceOverrides: [],
    });
    await rehydrate();
    const p = useAppStore.getState().userProfile;
    expect(p.name).toBe("");
    expect(p.avatarUrl).toBe("");
    expect(p.college).toBe("经管");
    expect(p.completedCredits).toBe(0);
    expect(p.totalCredits).toBe(0);
  });

  it("非法学习计划丢弃（缺一半时间/坏日期格式），合法保留并裁剪未知字段", async () => {
    seed({
      courses: [],
      schedules: [],
      calendarMarks: [],
      scheduleOccurrenceOverrides: [],
      studyBlocks: [
        { id: "b-bad-nodate", title: "坏块" },
        { id: "b-bad-time", title: "坏块", date: "2026-10-01", startTime: "9点" },
        { id: "b-bad-date", title: "坏块", date: "10/01", startTime: "09:00", endTime: "10:00" },
        { id: "b1", title: "复习", date: "2026-10-01", startTime: "09:00", endTime: "10:00", source: "weird", extra: 1 },
      ],
    });
    await rehydrate();
    const blocks = useAppStore.getState().studyBlocks;
    expect(blocks.map((b) => b.id)).toEqual(["b1"]);
    expect(blocks[0].source).toBeUndefined();
    expect((blocks[0] as Record<string, unknown>).extra).toBeUndefined();
  });

  it("作息方案坏节次整表丢弃；学期 totalWeeks 非正整数回落默认学期", async () => {
    seed({
      courses: [],
      schedules: [],
      calendarMarks: [],
      scheduleOccurrenceOverrides: [],
      bellSchedules: [
        { id: "bell-bad", name: "坏表", periods: [{ period: "一", startTime: "08:00" }] },
        { id: "bell1", name: "好表", periods: [{ period: 1, startTime: "08:00", endTime: "08:45" }] },
      ],
      activeBellScheduleId: "bell-bad",
      semester: { id: "s", name: "坏学期", startDate: "2026-09-01", totalWeeks: 0 },
    });
    await rehydrate();
    const bells = useAppStore.getState().bellSchedules;
    expect(bells.map((b) => b.id)).toEqual(["bell1"]);
    // active 指向被丢弃的表 → 回落 null；坏学期 → 回落默认学期（totalWeeks ≥ 1）
    expect(useAppStore.getState().activeBellScheduleId).toBeNull();
    expect(useAppStore.getState().semester.totalWeeks).toBeGreaterThanOrEqual(1);
  });
});

describe("restoreAppData 脏备份归一（与 hydrate 同口径）", () => {
  it("非法课程/排课/计划/作息/override 丢弃，合法保留；坏学期保留当前", async () => {
    const base = buildFullDemoData();
    const baseCourseCount = base.courses.length;
    const baseScheduleCount = base.schedules.length;
    const currentSemester = useAppStore.getState().semester;
    useAppStore.getState().restoreAppData({
      ...base,
      userProfile: { name: null, avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 } as never,
      semester: { id: "s", name: "坏学期", startDate: "2026-09-01", totalWeeks: 0 } as never,
      courses: [...base.courses, { junk: 1 }, { id: "c-bad" }] as never,
      schedules: [...base.schedules, { id: "s-bad" }] as never,
      studyBlocks: [...(base.studyBlocks ?? []), { id: "b-bad", title: "坏块" }] as never,
      scheduleOccurrenceOverrides: [{ id: "o-bad", kind: "cancel" }] as never,
      bellSchedules: [{ id: "bell-bad", name: "坏表", periods: [{ period: "一" }] }] as never,
    });
    const s = useAppStore.getState();
    expect(s.userProfile.name).toBe("");
    expect(s.semester.id).toBe(currentSemester.id);
    expect(Number.isFinite(s.currentSemesterWeek)).toBe(true);
    expect(s.courses).toHaveLength(baseCourseCount);
    expect(s.courses.some((c) => c.id === "c-bad")).toBe(false);
    expect(s.schedules).toHaveLength(baseScheduleCount);
    // 计划经 terminal reconcile 可能增减，只断言坏块被丢弃、 resultante 均为合法 id
    const baseBlockIds = new Set((base.studyBlocks ?? []).map((b) => b.id));
    expect(s.studyBlocks.some((b) => b.id === "b-bad")).toBe(false);
    expect(s.studyBlocks.every((b) => baseBlockIds.has(b.id))).toBe(true);
    expect(s.scheduleOccurrenceOverrides).toHaveLength(0);
    expect(s.bellSchedules).toHaveLength(0);
  });
});
