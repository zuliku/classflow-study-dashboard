import { describe, it, expect } from "vitest";
import { resolvePeriodTime, createEmptyBellSchedule } from "@/lib/scheduleImport/periodResolver";
import { findImportDuplicateCourse, isReliableCode } from "@/lib/scheduleImport/duplicate";
import { preflightScheduleImport } from "@/lib/scheduleImport/preflight";
import { computeScheduleImportFingerprint } from "@/lib/scheduleImport/fingerprint";
import { BellScheduleTemplate, ImportableCourseDraft } from "@/lib/scheduleImport/types";

const bell: BellScheduleTemplate = {
  id: "bell_1",
  name: "测试作息",
  periods: [
    { period: 1, startTime: "08:00", endTime: "08:45" },
    { period: 2, startTime: "08:55", endTime: "09:40" },
    { period: 3, startTime: "10:00", endTime: "10:45" },
    { period: 4, startTime: "10:55", endTime: "11:40" },
    { period: 5, startTime: "14:00", endTime: "14:45" },
    { period: 6, startTime: "14:55", endTime: "15:40" },
    { period: 7, startTime: "16:00", endTime: "16:45" },
  ],
};

describe("periodResolver — 节次→时间（AI 不猜时间）", () => {
  it("第1-2节 → 第1节开始 ~ 第2节结束", () => {
    expect(resolvePeriodTime(bell, 1, 2)).toEqual({ startTime: "08:00", endTime: "09:40" });
  });

  it("第3-4节", () => {
    expect(resolvePeriodTime(bell, 3, 4)).toEqual({ startTime: "10:00", endTime: "11:40" });
  });

  it("第7节（单节）", () => {
    expect(resolvePeriodTime(bell, 7)).toEqual({ startTime: "16:00", endTime: "16:45" });
  });

  it("无 Bell Schedule → null（不猜测）", () => {
    expect(resolvePeriodTime(null, 1, 2)).toBeNull();
    expect(resolvePeriodTime(createEmptyBellSchedule(), 1, 2)).toBeNull();
  });

  it("节次号不存在 → null", () => {
    expect(resolvePeriodTime(bell, 8)).toBeNull();
  });
});

describe("duplicate — 重复课程检测", () => {
  it("可信 code 优先", () => {
    const dup = findImportDuplicateCourse(
      { name: "高数", code: "MATH-101", teacher: "王" },
      [{ name: "高等数学", code: "MATH-101", teacher: "李" }]
    );
    expect(dup?.name).toBe("高等数学");
  });

  it("无可信 code → name + teacher", () => {
    const dup = findImportDuplicateCourse(
      { name: "高等数学", teacher: "王老师" },
      [{ name: "高等数学", teacher: "王老师" }]
    );
    expect(dup).not.toBeNull();
  });

  it("name 相同但 teacher 不同 → 不重复", () => {
    const dup = findImportDuplicateCourse(
      { name: "高等数学", teacher: "王老师" },
      [{ name: "高等数学", teacher: "李老师" }]
    );
    expect(dup).toBeNull();
  });

  it("ICS/CSV/JSON 自动码不可信", () => {
    expect(isReliableCode("ICS-3")).toBe(false);
    expect(isReliableCode("CSV-12")).toBe(false);
    expect(isReliableCode("JSON-1")).toBe(false);
    expect(isReliableCode("MATH-101")).toBe(true);
    expect(isReliableCode("")).toBe(false);
  });
});

const course = (name: string, overrides: Partial<ImportableCourseDraft> = {}): ImportableCourseDraft => ({
  draftKey: `k_${name}`,
  name,
  slots: [{ dayOfWeek: 1, periodStart: 1, periodEnd: 2, weekExpression: "1-16周" }],
  ...overrides,
});

describe("preflightScheduleImport", () => {
  it("正常：解析节次 + 周次归一 + 0 issue", () => {
    const res = preflightScheduleImport({
      courses: [
        course("高数", {
          code: "MATH-101",
          teacher: "王老师",
          slots: [
            { dayOfWeek: 1, periodStart: 1, periodEnd: 2, weekExpression: "1-5，7-17" },
            { dayOfWeek: 3, periodStart: 3, periodEnd: 4, weekExpression: "单周" },
          ],
        }),
      ],
      existingCourses: [],
      existingSchedules: [],
      bell,
    });
    expect(res.ok).toBe(true);
    expect(res.counts).toEqual({ courses: 1, slots: 2, blockers: 0, warnings: 0 });
    expect(res.resolvedCourses[0].slots[0]).toMatchObject({
      startTime: "08:00",
      endTime: "09:40",
      weekExpression: "1-5,7-17",
    });
    expect(res.resolvedCourses[0].slots[1].weekExpression).toBe("单周");
  });

  it("缺 Bell Schedule → missing-period-template blocker", () => {
    const res = preflightScheduleImport({
      courses: [course("高数")],
      existingCourses: [],
      existingSchedules: [],
      bell: null,
    });
    expect(res.ok).toBe(false);
    expect(res.counts.blockers).toBe(1);
    expect(res.issues[0].code).toBe("missing-period-template");
  });

  it("非法周次表达式 → invalid-week-expression blocker", () => {
    const res = preflightScheduleImport({
      courses: [course("高数", { slots: [{ dayOfWeek: 1, periodStart: 1, periodEnd: 2, weekExpression: "？？？" }] })],
      existingCourses: [],
      existingSchedules: [],
      bell,
    });
    expect(res.ok).toBe(false);
    expect(res.issues[0].code).toBe("invalid-week-expression");
  });

  it("已有时间（手动导入）无需 Bell Schedule", () => {
    const res = preflightScheduleImport({
      courses: [
        course("英语", {
          slots: [{ dayOfWeek: 2, startTime: "08:00", endTime: "09:40", weekExpression: "1-16周" }],
        }),
      ],
      existingCourses: [],
      existingSchedules: [],
      bell: null,
    });
    expect(res.ok).toBe(true);
    expect(res.counts.courses).toBe(1);
  });

  it("与已有排课冲突 → schedule-conflict warning", () => {
    const res = preflightScheduleImport({
      courses: [
        course("高数", { slots: [{ dayOfWeek: 1, startTime: "08:00", endTime: "09:40", weekExpression: "1-16周" }] }),
      ],
      existingCourses: [],
      existingSchedules: [
        { id: "s_exist", courseId: "c_x", dayOfWeek: 1, startTime: "08:30", endTime: "10:00", location: "", weeks: "1-16周" },
      ],
      bell: null,
    });
    expect(res.ok).toBe(true); // conflict 是 warning 非 blocker
    expect(res.issues.some((i) => i.code === "schedule-conflict")).toBe(true);
    expect(res.counts.warnings).toBeGreaterThan(0);
  });

  it("与已有课程重复 → duplicate-course warning", () => {
    const res = preflightScheduleImport({
      courses: [course("高等数学", { code: "MATH-101", teacher: "王老师" })],
      existingCourses: [{ name: "高等数学", code: "MATH-101", teacher: "王老师" }],
      existingSchedules: [],
      bell,
    });
    expect(res.issues.some((i) => i.code === "duplicate-course")).toBe(true);
    expect(res.counts.warnings).toBe(1);
  });

  it("缺课程名称 → missing-information blocker（不静默丢弃）", () => {
    const res = preflightScheduleImport({
      courses: [course("", { slots: [{ dayOfWeek: 1, periodStart: 1, periodEnd: 2, weekExpression: "1-16周" }] })],
      existingCourses: [],
      existingSchedules: [],
      bell,
    });
    expect(res.ok).toBe(false);
    expect(res.issues[0].code).toBe("missing-information");
  });

  it("fingerprint：内容相同稳定，不同变化；store 变化（已有课程）变化", () => {
    const a = preflightScheduleImport({ courses: [course("高数")], existingCourses: [], existingSchedules: [], bell });
    const b = preflightScheduleImport({ courses: [course("高数")], existingCourses: [], existingSchedules: [], bell });
    const c = preflightScheduleImport({
      courses: [course("高数", { slots: [{ dayOfWeek: 2, periodStart: 3, periodEnd: 4, weekExpression: "1-16周" }] })],
      existingCourses: [],
      existingSchedules: [],
      bell,
    });
    const d = preflightScheduleImport({
      courses: [course("高数")],
      existingCourses: [{ name: "其它课", code: "X", teacher: "李" }],
      existingSchedules: [],
      bell,
    });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
    // store 变化（已有课程新增）→ fingerprint 变化 → stale
    expect(a.fingerprint).not.toBe(d.fingerprint);
    // bell 变化不改变 fingerprint（派生时间不属于指纹）
    const noBell = preflightScheduleImport({ courses: [course("高数")], existingCourses: [], existingSchedules: [], bell: null });
    expect(a.fingerprint).toBe(noBell.fingerprint);
  });
});

describe("preflightScheduleImport — strictWeeks（Vision 课表导入）", () => {
  const slotWith = (overrides: Record<string, unknown>) => ({
    dayOfWeek: 1,
    periodStart: 1,
    periodEnd: 2,
    weekExpression: "1-16周",
    ...overrides,
  });

  it("Vision 缺周次 → missing-information blocker（不得自动 1-16）", () => {
    const res = preflightScheduleImport(
      {
        courses: [course("高数", { slots: [slotWith({ weekExpression: "" }) as never] })],
        existingCourses: [],
        existingSchedules: [],
        bell,
      },
      { strictWeeks: true }
    );
    expect(res.ok).toBe(false);
    expect(res.issues[0].code).toBe("missing-information");
    expect(res.resolvedCourses).toHaveLength(0);
  });

  it("Vision 部分非法周次 → invalid-week-expression blocker（不部分导入）", () => {
    const res = preflightScheduleImport(
      {
        courses: [course("高数", { slots: [slotWith({ weekExpression: "1-5,7-?" }) as never] })],
        existingCourses: [],
        existingSchedules: [],
        bell,
      },
      { strictWeeks: true }
    );
    expect(res.ok).toBe(false);
    expect(res.issues[0].code).toBe("invalid-week-expression");
  });

  it("Vision 合法复杂周次 → 通过并归一", () => {
    const res = preflightScheduleImport(
      {
        courses: [course("高数", { slots: [slotWith({ weekExpression: "1-5，7-17" }) as never] })],
        existingCourses: [],
        existingSchedules: [],
        bell,
      },
      { strictWeeks: true }
    );
    expect(res.ok).toBe(true);
    expect(res.resolvedCourses[0].slots[0].weekExpression).toBe("1-5,7-17");
  });

  it("legacy（无 strictWeeks）缺周次 → 默认 1-16（传统导入兼容）", () => {
    const res = preflightScheduleImport({
      courses: [course("高数", { slots: [slotWith({ weekExpression: "" }) as never] })],
      existingCourses: [],
      existingSchedules: [],
      bell,
    });
    expect(res.ok).toBe(true);
    expect(res.resolvedCourses[0].slots[0].weekExpression).toBe("1-16");
  });
});
