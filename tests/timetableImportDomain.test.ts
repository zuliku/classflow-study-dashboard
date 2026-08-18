import { describe, it, expect, vi } from "vitest";
import { buildTimetableImportProposal } from "@/lib/ai/timetableImport/preflight";
import { applyTimetableImport } from "@/lib/ai/timetableImport/executor";
import { TimetableImportProposal, TimetableImportStoreDeps } from "@/lib/ai/timetableImport/types";
import { BellScheduleTemplate } from "@/types";

const bell: BellScheduleTemplate = {
  id: "bell_1",
  name: "测试作息",
  periods: [
    { period: 1, startTime: "08:00", endTime: "08:45" },
    { period: 2, startTime: "08:55", endTime: "09:40" },
    { period: 3, startTime: "10:00", endTime: "10:45" },
    { period: 4, startTime: "10:55", endTime: "11:40" },
  ],
};

const draft = {
  summary: "从 1 张图片识别",
  courses: [
    {
      draftKey: "c1",
      name: "高等数学",
      code: "MATH-101",
      teacher: "王老师",
      slots: [
        { dayOfWeek: 1, periodStart: 1, periodEnd: 2, weekExpression: "1-5,7-17", location: "教三 201" },
        { dayOfWeek: 3, periodStart: 3, periodEnd: 4, weekExpression: "单周" },
      ],
    },
    {
      draftKey: "c2",
      name: "大学英语",
      slots: [{ dayOfWeek: 2, periodStart: 1, periodEnd: 2, weekExpression: "1-16周" }],
    },
  ],
};

function makeProposal(overrides: Partial<TimetableImportProposal> = {}): TimetableImportProposal {
  const base = buildTimetableImportProposal({
    draft: { ...draft, ...overrides.draft },
    sourceAttachmentIds: ["att_1"],
    state: {
      existingCourses: [],
      existingSchedules: [],
      bellSchedules: [bell],
      activeBellScheduleId: "bell_1",
    },
  });
  if (!base.ok) throw new Error("proposal build failed: " + JSON.stringify(base));
  return base.proposal;
}

function makeDeps(overrides: Partial<TimetableImportStoreDeps["getState"]> = {}) {
  const importSchedules = vi.fn();
  const deps: TimetableImportStoreDeps = {
    getState: () => ({
      courses: overrides.courses ?? [],
      schedules: overrides.schedules ?? [],
      bellSchedules: overrides.bellSchedules ?? [bell],
      activeBellScheduleId: overrides.activeBellScheduleId ?? "bell_1",
    }),
    importSchedules,
  };
  return { deps, importSchedules };
}

describe("buildTimetableImportProposal", () => {
  it("无图片附件 → SOURCE_REQUIRED", () => {
    const r = buildTimetableImportProposal({
      draft: draft as never,
      sourceAttachmentIds: [],
      state: { existingCourses: [], existingSchedules: [], bellSchedules: [], activeBellScheduleId: null },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("SOURCE_REQUIRED");
  });

  it("正常构建：preview 解析节次 + counts", () => {
    const p = makeProposal();
    expect(p.preview.ok).toBe(true);
    expect(p.preview.counts.courses).toBe(2);
    expect(p.preview.counts.slots).toBe(3);
    expect(p.preview.resolvedCourses[0].slots[0]).toMatchObject({
      startTime: "08:00",
      endTime: "09:40",
      weekExpression: "1-5,7-17",
    });
  });

  it("缺 Bell Schedule → preview 有 missing-period-template blocker（proposal 仍可创建）", () => {
    const r = buildTimetableImportProposal({
      draft: draft as never,
      sourceAttachmentIds: ["att_1"],
      state: { existingCourses: [], existingSchedules: [], bellSchedules: [], activeBellScheduleId: null },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.proposal.preview.ok).toBe(false);
      expect(r.proposal.preview.counts.blockers).toBeGreaterThan(0);
      expect(r.proposal.preview.issues[0].code).toBe("missing-period-template");
    }
  });

  it("模型 draft 不含真实 ID（schema 无 id 字段——类型层面保证）", () => {
    // 类型契约：TimetableImportCourseDraft 无 courseId/scheduleId/startTime/endTime 字段
    const p = makeProposal();
    const serialized = JSON.stringify(p.draft);
    expect(serialized).not.toContain("courseId");
    expect(serialized).not.toContain("scheduleId");
  });
});

describe("applyTimetableImport", () => {
  it("成功：一次性写入全部课程/排课（真实 ID + courseId 引用）", () => {
    const { deps, importSchedules } = makeDeps();
    const p = makeProposal();
    const r = applyTimetableImport(p, deps);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.applied).toEqual({ courses: 2, slots: 3 });
      expect(r.courseIds).toHaveLength(2);
      expect(r.scheduleIds).toHaveLength(3);
      expect(importSchedules).toHaveBeenCalledTimes(1);
      const [courses, schedules] = importSchedules.mock.calls[0];
      expect(courses[0].id).toMatch(/^c_/);
      expect(schedules[0].courseId).toMatch(/^c_/);
      expect(schedules[0]).toMatchObject({ startTime: "08:00", endTime: "09:40" });
    }
  });

  it("skip 某课程 → 只导入剩余课程", () => {
    const { deps, importSchedules } = makeDeps();
    const p = makeProposal();
    const r = applyTimetableImport(p, deps, { skipCourseKeys: new Set(["c2"]) });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.applied).toEqual({ courses: 1, slots: 2 });
      expect(importSchedules.mock.calls[0][0][0].name).toBe("高等数学");
    }
  });

  it("store 变化（新增已有课程）→ fingerprint stale → 0 mutation", () => {
    const { deps, importSchedules } = makeDeps({
      courses: [{ id: "c_x", name: "其它课程", code: "X-1", teacher: "李" }],
    });
    const p = makeProposal();
    const r = applyTimetableImport(p, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("STALE");
    expect(importSchedules).not.toHaveBeenCalled();
  });

  it("blockers 未解决（缺 Bell Schedule）→ BLOCKED，0 mutation", () => {
    const { deps, importSchedules } = makeDeps({ bellSchedules: [], activeBellScheduleId: null });
    const p = makeProposal();
    const r = applyTimetableImport(p, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("BLOCKED");
    expect(importSchedules).not.toHaveBeenCalled();
  });

  it("全部 skip → EMPTY_SELECTION，0 mutation", () => {
    const { deps, importSchedules } = makeDeps();
    const p = makeProposal();
    const r = applyTimetableImport(p, deps, { skipCourseKeys: new Set(["c1", "c2"]) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("EMPTY_SELECTION");
    expect(importSchedules).not.toHaveBeenCalled();
  });
});
