import { describe, it, expect } from "vitest";
import { normalizeTimetableImportDraft, mergeAdjacentTimetableSlots } from "@/lib/ai/timetableImport/draft";
import { buildTimetableImportProposal } from "@/lib/ai/timetableImport/preflight";
import { applyTimetableImport } from "@/lib/ai/timetableImport/executor";
import { TimetableImportDraft } from "@/lib/ai/timetableImport/types";
import { BellScheduleTemplate } from "@/types";

const bell: BellScheduleTemplate = {
  id: "bell_1",
  name: "测试作息",
  periods: Array.from({ length: 12 }, (_, i) => ({
    period: i + 1,
    startTime: `${String(8 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 === 0 ? "00" : "45"}`,
    endTime: `${String(8 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 === 0 ? "45" : "30"}`,
  })),
};

const slot = (overrides: Record<string, unknown> = {}) => ({
  dayOfWeek: 1,
  periodStart: 1,
  periodEnd: 2,
  weekExpression: "1-16周",
  ...overrides,
});

describe("normalizeTimetableImportDraft — 幂等", () => {
  it("normalize(normalize(d)) === normalize(d)", () => {
    const draft: TimetableImportDraft = {
      summary: "s",
      courses: [
        {
          draftKey: "c1",
          name: "国际贸易实务",
          slots: [
            slot({ periodStart: 7, periodEnd: 7, location: "E-114", weekExpression: "1-5,7-17" }),
            slot({ periodStart: 8, periodEnd: 8, location: "E-114", weekExpression: "1-5,7-17" }),
            slot({ dayOfWeek: 3, periodStart: 3, periodEnd: 4, weekExpression: "单周" }),
          ],
        },
      ],
      pendingItems: [{ reason: "ambiguous-cell" as const, description: "d" }],
    };
    const once = normalizeTimetableImportDraft(draft);
    const twice = normalizeTimetableImportDraft(once);
    expect(twice).toEqual(once);
    // 不 mutate 原 draft
    expect(draft.courses[0].slots).toHaveLength(3);
    // 保留 summary / pendingItems
    expect(once.summary).toBe("s");
    expect(once.pendingItems).toHaveLength(1);
  });
});

describe("normalizeTimetableImportDraft — 连续合并", () => {
  it("7-7 + 8-8（同课/同天/同周/同地）→ 7-8", () => {
    const draft: TimetableImportDraft = {
      summary: "s",
      courses: [
        {
          draftKey: "c1",
          name: "国际贸易实务",
          slots: [
            slot({ periodStart: 7, periodEnd: 7 }),
            slot({ periodStart: 8, periodEnd: 8 }),
          ],
        },
      ],
    };
    const n = normalizeTimetableImportDraft(draft);
    expect(n.courses[0].slots).toHaveLength(1);
    expect(n.courses[0].slots[0]).toMatchObject({ periodStart: 7, periodEnd: 8 });
  });

  it("9-10 + 11 → 9-11", () => {
    const draft: TimetableImportDraft = {
      summary: "s",
      courses: [
        {
          draftKey: "c1",
          name: "宝石鉴定与欣赏",
          slots: [
            slot({ dayOfWeek: 3, periodStart: 9, periodEnd: 10, weekExpression: "3-7,9", location: "未定" }),
            slot({ dayOfWeek: 3, periodStart: 11, periodEnd: 11, weekExpression: "3-7,9", location: "未定" }),
          ],
        },
      ],
    };
    const n = normalizeTimetableImportDraft(draft);
    expect(n.courses[0].slots).toHaveLength(1);
    expect(n.courses[0].slots[0]).toMatchObject({ periodStart: 9, periodEnd: 11 });
  });

  it("不同 location 不合并", () => {
    const draft: TimetableImportDraft = {
      summary: "s",
      courses: [
        {
          draftKey: "c1",
          name: "课",
          slots: [slot({ periodStart: 7, periodEnd: 7, location: "A" }), slot({ periodStart: 8, periodEnd: 8, location: "B" })],
        },
      ],
    };
    expect(normalizeTimetableImportDraft(draft).courses[0].slots).toHaveLength(2);
  });

  it("不同 weekExpression 不合并", () => {
    const draft: TimetableImportDraft = {
      summary: "s",
      courses: [
        {
          draftKey: "c1",
          name: "课",
          slots: [
            slot({ periodStart: 7, periodEnd: 7, weekExpression: "1-8周" }),
            slot({ periodStart: 8, periodEnd: 8, weekExpression: "9-16周" }),
          ],
        },
      ],
    };
    expect(normalizeTimetableImportDraft(draft).courses[0].slots).toHaveLength(2);
  });
});

describe("Production 入口 — 模型 7+8 即使不合并，Runtime 稳定 7-8", () => {
  const rawDraft: TimetableImportDraft = {
    summary: "s",
    courses: [
      {
        draftKey: "c1",
        name: "国际贸易实务",
        slots: [
          slot({ periodStart: 7, periodEnd: 7, location: "E-114", weekExpression: "1-5,7-17" }),
          slot({ periodStart: 8, periodEnd: 8, location: "E-114", weekExpression: "1-5,7-17" }),
        ],
      },
    ],
  };

  it("buildTimetableImportProposal：proposal.draft 为 normalized（1 个逻辑 slot 7-8）", () => {
    const r = buildTimetableImportProposal({
      draft: rawDraft,
      sourceAttachmentIds: ["att_1"],
      state: { existingCourses: [], existingSchedules: [], bellSchedules: [bell], activeBellScheduleId: "bell_1" },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.proposal.draft.courses[0].slots).toHaveLength(1);
      expect(r.proposal.draft.courses[0].slots[0]).toMatchObject({ periodStart: 7, periodEnd: 8 });
      expect(r.proposal.preview.counts.slots).toBe(1);
    }
  });

  it("applyTimetableImport：最终 importSchedules schedules.length === 1（非 2）", () => {
    const r = buildTimetableImportProposal({
      draft: rawDraft,
      sourceAttachmentIds: ["att_1"],
      state: { existingCourses: [], existingSchedules: [], bellSchedules: [bell], activeBellScheduleId: "bell_1" },
    });
    if (!r.ok) throw new Error("build failed");
    let schedulesWritten = 0;
    const result = applyTimetableImport(
      r.proposal,
      {
        getState: () => ({ courses: [], schedules: [], bellSchedules: [bell], activeBellScheduleId: "bell_1" }),
        importSchedules: (_courses, schedules) => {
          schedulesWritten = schedules.length;
        },
      },
      { pendingBell: null }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.applied.slots).toBe(1);
      expect(schedulesWritten).toBe(1);
    }
  });
});
