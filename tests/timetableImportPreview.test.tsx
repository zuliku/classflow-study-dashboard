// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, act, waitFor, cleanup } from "@testing-library/react";

// ResizeObserver polyfill
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).ResizeObserver = RO;

import { useAppStore } from "@/store/useAppStore";
import { buildTimetableImportProposal } from "@/lib/ai/timetableImport/preflight";
import { TimetableImportProposalCard } from "@/components/kiro/TimetableImportProposalCard";
import { TimetableImportProposal } from "@/lib/ai/timetableImport/types";
import { BellScheduleTemplate } from "@/types";

const bell: BellScheduleTemplate = {
  id: "bell_1",
  name: "测试作息",
  periods: [
    { period: 1, startTime: "08:00", endTime: "08:45" },
    { period: 2, startTime: "08:55", endTime: "09:40" },
  ],
};

const draft = {
  summary: "课表识别",
  courses: [
    {
      draftKey: "c1",
      name: "高等数学",
      teacher: "王老师",
      slots: [{ dayOfWeek: 1, periodStart: 1, periodEnd: 2, weekExpression: "1-5,7-17", location: "教三 201" }],
    },
    {
      draftKey: "c2",
      name: "大学英语",
      slots: [{ dayOfWeek: 2, periodStart: 1, periodEnd: 2, weekExpression: "1-16周" }],
    },
  ],
};

function makeProposalNoBell(): TimetableImportProposal {
  const r = buildTimetableImportProposal({
    draft: draft as never,
    sourceAttachmentIds: ["att_1"],
    state: { existingCourses: [], existingSchedules: [], bellSchedules: [], activeBellScheduleId: null },
  });
  if (!r.ok) throw new Error("build failed");
  return r.proposal;
}

function makeProposalWithDuplicate(): TimetableImportProposal {
  const r = buildTimetableImportProposal({
    draft: draft as never,
    sourceAttachmentIds: ["att_1"],
    state: {
      existingCourses: [{ name: "高等数学", code: "", teacher: "王老师" }],
      existingSchedules: [],
      bellSchedules: [bell],
      activeBellScheduleId: "bell_1",
    },
  });
  if (!r.ok) throw new Error("build failed");
  return r.proposal;
}

function makeProposalWithPending(): TimetableImportProposal {
  const r = buildTimetableImportProposal({
    draft: { ...draft, pendingItems: [{ reason: "ambiguous-cell" as const, description: "第8门课程名称模糊" }] },
    sourceAttachmentIds: ["att_1"],
    state: { existingCourses: [], existingSchedules: [], bellSchedules: [bell], activeBellScheduleId: "bell_1" },
  });
  if (!r.ok) throw new Error("build failed");
  return r.proposal;
}

function resetStore() {
  useAppStore.setState({
    courses: [],
    schedules: [],
    bellSchedules: [],
    activeBellScheduleId: null,
  } as never);
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  cleanup();
});

describe("TimetableImportProposalCard — 识别数量（P0-2）", () => {
  it("无 Bell 时摘要仍显示识别数量（而非 0/0）", () => {
    const p = makeProposalNoBell();
    render(<TimetableImportProposalCard proposal={p} />);
    expect(screen.getByText(/识别到 2 门课程 · 2 个上课时段/)).toBeTruthy();
  });
});

describe("TimetableImportPreviewDialog — Bell Schedule 保存后实时更新（P0-1）", () => {
  it("无 Bell → blocker + Apply disabled；保存 Bell → blocker 消失 + Apply enabled", async () => {
    const p = makeProposalNoBell();
    render(<TimetableImportProposalCard proposal={p} />);
    fireEvent.click(screen.getByText("查看导入预览"));

    // 无 Bell：blocker + disabled
    expect(screen.getByText(/尚未设置学校作息时间/)).toBeTruthy();
    const applyBtn = screen.getByText(/导入所选课程/) as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);

    // 设置 Bell Schedule（模拟 Dialog 内保存 → store 更新 → currentPreflight 重算）
    act(() => {
      useAppStore.getState().upsertBellSchedule(bell);
      useAppStore.getState().setActiveBellSchedule(bell.id);
    });

    // currentPreflight 重算：blocker 消失、具体时间出现、Apply enabled
    await waitFor(() => {
      expect(screen.getByText(/学校作息时间：测试作息/)).toBeTruthy();
      expect(screen.queryByText(/尚未设置学校作息时间/)).toBeNull();
    });
    expect(screen.getAllByText(/08:00–09:40/).length).toBeGreaterThanOrEqual(1); // 第1-2节解析
    const applyBtn2 = screen.getByText(/导入所选课程/) as HTMLButtonElement;
    expect(applyBtn2.disabled).toBe(false);
  });
});

describe("TimetableImportPreviewDialog — duplicate 默认 skip（P0-4）", () => {
  it("重复课程初始 checkbox 为 skip（不勾选）", () => {
    const p = makeProposalWithDuplicate();
    render(<TimetableImportProposalCard proposal={p} />);
    fireEvent.click(screen.getByText("查看导入预览"));
    const checks = screen.getAllByRole("checkbox") as HTMLInputElement[];
    // 高等数学（duplicate）未勾选（默认 skip）；大学英语勾选
    expect(checks[0].checked).toBe(false);
    expect(checks[1].checked).toBe(true);
  });
});

describe("TimetableImportPreviewDialog — Pending Apply gate（P0-3）", () => {
  it("pending 未处理 → Apply disabled；忽略后可继续", () => {
    // 预置 Bell（Dialog currentPreflight 依赖真实 store 的 bell）
    act(() => {
      useAppStore.getState().upsertBellSchedule(bell);
      useAppStore.getState().setActiveBellSchedule(bell.id);
    });
    const p = makeProposalWithPending();
    render(<TimetableImportProposalCard proposal={p} />);
    // pending > 0 → Card 不允许快速导入
    expect(screen.queryByText(/导入全部课程/)).toBeNull();
    fireEvent.click(screen.getByText("查看导入预览"));

    expect(screen.getByText(/1 项未处理/)).toBeTruthy();
    const applyBtn = screen.getByText(/还有 1 项需确认/) as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);

    // 忽略此项 → gate 解除
    fireEvent.click(screen.getByText("忽略此项"));
    const applyBtn2 = screen.getByText("导入所选课程") as HTMLButtonElement;
    expect(applyBtn2.disabled).toBe(false);
  });
});
