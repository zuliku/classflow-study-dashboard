// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).ResizeObserver = RO;

import { normalizeTimetableImportDraft } from "@/lib/ai/timetableImport/draft";
import { buildTimetableImportProposal } from "@/lib/ai/timetableImport/preflight";
import { TimetableImportProposalCard } from "@/components/kiro/TimetableImportProposalCard";
import { useAppStore } from "@/store/useAppStore";
import { BellScheduleTemplate, CourseSchedule } from "@/types";
import { TimetableImportDraft } from "@/lib/ai/timetableImport/types";

const bell: BellScheduleTemplate = {
  id: "bell_hardening",
  name: "测试作息",
  periods: [
    { period: 1, startTime: "08:00", endTime: "08:45" },
    { period: 2, startTime: "08:55", endTime: "09:40" },
    { period: 7, startTime: "14:00", endTime: "14:45" },
    { period: 8, startTime: "14:55", endTime: "15:40" },
    { period: 9, startTime: "16:00", endTime: "16:45" },
    { period: 10, startTime: "16:55", endTime: "17:40" },
    { period: 11, startTime: "18:30", endTime: "19:15" },
  ],
};

const slot = (overrides: Record<string, unknown> = {}) => ({
  dayOfWeek: 1,
  periodStart: 1,
  periodEnd: 2,
  weekExpression: "1-16周",
  location: "A-101",
  ...overrides,
});

describe("Timetable normalization — input order independent", () => {
  it("8 + 7（同课/同天/同周/同地）乱序仍归一化为 7-8", () => {
    const draft: TimetableImportDraft = {
      summary: "reverse",
      courses: [
        {
          draftKey: "c1",
          name: "课程A",
          slots: [
            slot({ periodStart: 8, periodEnd: 8 }),
            slot({ periodStart: 7, periodEnd: 7 }),
          ],
        },
      ],
    };

    const normalized = normalizeTimetableImportDraft(draft);
    expect(normalized.courses[0].slots).toHaveLength(1);
    expect(normalized.courses[0].slots[0]).toMatchObject({ periodStart: 7, periodEnd: 8 });
    expect(draft.courses[0].slots.map((s) => s.periodStart)).toEqual([8, 7]);
  });

  it("11 + 9-10 乱序仍归一化为 9-11", () => {
    const draft: TimetableImportDraft = {
      summary: "reverse range",
      courses: [
        {
          draftKey: "c1",
          name: "课程A",
          slots: [
            slot({ periodStart: 11, periodEnd: 11, dayOfWeek: 3, weekExpression: "3-7,9", location: "未定" }),
            slot({ periodStart: 9, periodEnd: 10, dayOfWeek: 3, weekExpression: "3-7,9", location: "未定" }),
          ],
        },
      ],
    };

    const normalized = normalizeTimetableImportDraft(draft);
    expect(normalized.courses[0].slots).toHaveLength(1);
    expect(normalized.courses[0].slots[0]).toMatchObject({ periodStart: 9, periodEnd: 11 });
  });
});

const existingConflict: CourseSchedule = {
  id: "existing_schedule",
  courseId: "existing_course",
  dayOfWeek: 1,
  startTime: "08:00",
  endTime: "09:40",
  location: "B-201",
  weeks: "1-16周",
};

function makeConflictProposal() {
  const result = buildTimetableImportProposal({
    draft: {
      summary: "conflict",
      courses: [
        {
          draftKey: "c1",
          name: "新课程",
          slots: [slot({ periodStart: 1, periodEnd: 2 })],
        },
      ],
    },
    sourceAttachmentIds: ["att_conflict"],
    state: {
      existingCourses: [],
      existingSchedules: [existingConflict],
      bellSchedules: [bell],
      activeBellScheduleId: bell.id,
    },
  });
  if (!result.ok) throw new Error("proposal build failed");
  return result.proposal;
}

beforeEach(() => {
  useAppStore.setState({
    courses: [],
    schedules: [existingConflict],
    bellSchedules: [bell],
    activeBellScheduleId: bell.id,
  } as never);
});

afterEach(() => {
  cleanup();
});

describe("TimetableImportProposalCard — conflict requires preview", () => {
  it("schedule-conflict warning 禁止 Quick Apply；打开 Preview 后仍可明确导入", () => {
    const proposal = makeConflictProposal();
    expect(proposal.preview.issues.some((i) => i.code === "schedule-conflict")).toBe(true);

    render(<TimetableImportProposalCard proposal={proposal} />);

    expect(screen.queryByText(/导入全部课程/)).toBeNull();
    fireEvent.click(screen.getByText("查看导入预览"));

    expect(screen.getAllByText(/与已有排课或其它导入课程时间重叠/).length).toBeGreaterThan(0);
    const apply = screen.getByText("导入所选课程") as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
  });
});
