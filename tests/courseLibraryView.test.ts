import { describe, it, expect } from "vitest";
import { CourseTaskRowView } from "@/lib/courseDetailView";
import {
  buildCourseLibraryTaskView,
  isCourseAttentionTask,
} from "@/lib/courses/courseLibraryView";

const T0 = 1_000_000;

function row(patch: Partial<CourseTaskRowView>): CourseTaskRowView {
  return {
    id: "a1",
    title: "任务",
    status: "todo",
    statusLabel: "待办",
    deadlineLabel: "无截止时间",
    overdue: false,
    hasDdl: false,
    ...patch,
  };
}

describe("isCourseAttentionTask", () => {
  it("todo / doing → attention", () => {
    expect(isCourseAttentionTask("todo")).toBe(true);
    expect(isCourseAttentionTask("doing")).toBe(true);
  });

  it("submitted / completed → not attention", () => {
    expect(isCourseAttentionTask("submitted")).toBe(false);
    expect(isCourseAttentionTask("completed")).toBe(false);
  });
});

describe("buildCourseLibraryTaskView", () => {
  it("todo → attention；doing → attention", () => {
    const v = buildCourseLibraryTaskView([
      row({ id: "a1", status: "todo" }),
      row({ id: "a2", status: "doing" }),
    ]);
    expect(v.attentionCount).toBe(2);
    expect(v.totalCount).toBe(2);
    expect(v.overdueCount).toBe(0);
  });

  it("submitted / completed → 不算待处理（但计入 total，Popover 完整列表用）", () => {
    const v = buildCourseLibraryTaskView([
      row({ id: "a1", status: "todo" }),
      row({ id: "a2", status: "submitted" }),
      row({ id: "a3", status: "completed" }),
    ]);
    expect(v.attentionCount).toBe(1);
    expect(v.totalCount).toBe(3);
  });

  it("overdue submitted 不计入 overdueCount（旧 DDL 不误算）", () => {
    const v = buildCourseLibraryTaskView([
      row({ id: "a1", status: "submitted", overdue: true }),
      row({ id: "a2", status: "completed", overdue: true }),
    ]);
    expect(v.attentionCount).toBe(0);
    expect(v.overdueCount).toBe(0);
  });

  it("overdue todo/doing 计入 overdueCount", () => {
    const v = buildCourseLibraryTaskView([
      row({ id: "a1", status: "todo", overdue: true }),
      row({ id: "a2", status: "doing", overdue: false }),
      row({ id: "a3", status: "todo", overdue: true }),
      row({ id: "a4", status: "completed", overdue: true }),
    ]);
    expect(v.attentionCount).toBe(3);
    expect(v.overdueCount).toBe(2);
  });

  it("混合 fixture：4 total / 2 active / 1 submitted / 1 completed", () => {
    const v = buildCourseLibraryTaskView([
      row({ id: "a1", status: "todo", overdue: true }),
      row({ id: "a2", status: "doing" }),
      row({ id: "a3", status: "submitted" }),
      row({ id: "a4", status: "completed" }),
    ]);
    expect(v.totalCount).toBe(4);
    expect(v.attentionCount).toBe(2);
    expect(v.overdueCount).toBe(1);
    expect(v.attentionRows.map((r) => r.id)).toEqual(["a1", "a2"]);
  });

  it("空数组 → 全 0；attentionRows 保持调用方顺序", () => {
    const v = buildCourseLibraryTaskView([]);
    expect(v).toEqual({ attentionRows: [], attentionCount: 0, overdueCount: 0, totalCount: 0 });
    const ordered = buildCourseLibraryTaskView([
      row({ id: "b", status: "doing" }),
      row({ id: "a", status: "todo" }),
    ]);
    expect(ordered.attentionRows.map((r) => r.id)).toEqual(["b", "a"]);
  });
});
