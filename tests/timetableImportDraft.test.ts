import { describe, it, expect } from "vitest";
import { getTimetableDraftCounts, mergeAdjacentTimetableSlots } from "@/lib/ai/timetableImport/draft";
import { TimetableImportCourseDraft, TimetableImportDraft } from "@/lib/ai/timetableImport/types";

const slot = (overrides: Partial<TimetableImportCourseDraft["slots"][number]> = {}) => ({
  dayOfWeek: 1,
  periodStart: 1,
  periodEnd: 2,
  weekExpression: "1-16周",
  ...overrides,
});

const course = (overrides: Partial<TimetableImportCourseDraft> = {}): TimetableImportCourseDraft => ({
  draftKey: "c1",
  name: "高数",
  slots: [slot()],
  ...overrides,
});

describe("getTimetableDraftCounts — Extraction Counts（与 preflight 无关）", () => {
  it("识别数量来自 draft（即使无 Bell 也显示真实数量）", () => {
    const draft: TimetableImportDraft = {
      summary: "x",
      courses: [course(), course({ draftKey: "c2", name: "英语", slots: [slot(), slot({ dayOfWeek: 3 })] })],
      pendingItems: [{ reason: "ambiguous-cell", description: "d" }],
    };
    expect(getTimetableDraftCounts(draft)).toEqual({ courses: 2, slots: 3, pending: 1 });
  });

  it("无 pending → 0", () => {
    expect(getTimetableDraftCounts({ summary: "x", courses: [] })).toEqual({ courses: 0, slots: 0, pending: 0 });
  });
});

describe("mergeAdjacentTimetableSlots — 连续相同单元格合并", () => {
  it("第7节 + 第8节（同课/同天/同周次/同地点）→ 7-8", () => {
    const merged = mergeAdjacentTimetableSlots([
      course({
        slots: [
          slot({ dayOfWeek: 1, periodStart: 7, periodEnd: 7 }),
          slot({ dayOfWeek: 1, periodStart: 8, periodEnd: 8 }),
        ],
      }),
    ]);
    expect(merged[0].slots).toHaveLength(1);
    expect(merged[0].slots[0]).toMatchObject({ periodStart: 7, periodEnd: 8 });
  });

  it("第9-10节 + 第11节 → 9-11", () => {
    const merged = mergeAdjacentTimetableSlots([
      course({
        slots: [
          slot({ dayOfWeek: 3, periodStart: 9, periodEnd: 10 }),
          slot({ dayOfWeek: 3, periodStart: 11, periodEnd: 11 }),
        ],
      }),
    ]);
    expect(merged[0].slots).toHaveLength(1);
    expect(merged[0].slots[0]).toMatchObject({ periodStart: 9, periodEnd: 11 });
  });

  it("周次不同不合并（1-8 与 9-16）", () => {
    const merged = mergeAdjacentTimetableSlots([
      course({
        slots: [
          slot({ periodStart: 1, periodEnd: 2, weekExpression: "1-8周" }),
          slot({ periodStart: 3, periodEnd: 4, weekExpression: "9-16周" }),
        ],
      }),
    ]);
    expect(merged[0].slots).toHaveLength(2);
  });

  it("地点不同不合并", () => {
    const merged = mergeAdjacentTimetableSlots([
      course({
        slots: [
          slot({ periodStart: 7, periodEnd: 7, location: "教一 101" }),
          slot({ periodStart: 8, periodEnd: 8, location: "教二 202" }),
        ],
      }),
    ]);
    expect(merged[0].slots).toHaveLength(2);
  });

  it("星期不同不合并", () => {
    const merged = mergeAdjacentTimetableSlots([
      course({
        slots: [
          slot({ dayOfWeek: 1, periodStart: 7, periodEnd: 7 }),
          slot({ dayOfWeek: 2, periodStart: 8, periodEnd: 8 }),
        ],
      }),
    ]);
    expect(merged[0].slots).toHaveLength(2);
  });

  it("周次表达归一后相同可合并（1-16周 vs 1-16）", () => {
    const merged = mergeAdjacentTimetableSlots([
      course({
        slots: [
          slot({ periodStart: 7, periodEnd: 7, weekExpression: "1-16周" }),
          slot({ periodStart: 8, periodEnd: 8, weekExpression: "1-16" }),
        ],
      }),
    ]);
    expect(merged[0].slots).toHaveLength(1);
  });

  it("非连续不合并", () => {
    const merged = mergeAdjacentTimetableSlots([
      course({
        slots: [
          slot({ periodStart: 1, periodEnd: 2 }),
          slot({ periodStart: 5, periodEnd: 5 }),
        ],
      }),
    ]);
    expect(merged[0].slots).toHaveLength(2);
  });
});
