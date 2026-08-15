import { describe, it, expect } from "vitest";
import { Assignment } from "@/types";
import {
  buildCourseTaskRow,
  COURSE_TASK_STATUS_LABEL,
  expandableSlice,
  formatCourseStats,
  formatMaterialMeta,
  sortCourseAssignments,
} from "@/lib/courseDetailView";

const NOW = new Date(2026, 7, 15, 10, 0, 0);

function mkA(patch: Partial<Assignment>): Assignment {
  return {
    id: "a1",
    courseId: "c1",
    title: "任务",
    description: "",
    priority: "medium",
    status: "todo",
    progress: 0,
    tags: [],
    ...patch,
  } as Assignment;
}

describe("COURSE_TASK_STATUS_LABEL", () => {
  it("四种状态中文标签", () => {
    expect(COURSE_TASK_STATUS_LABEL.todo).toBe("待完成");
    expect(COURSE_TASK_STATUS_LABEL.doing).toBe("进行中");
    expect(COURSE_TASK_STATUS_LABEL.submitted).toBe("已提交");
    expect(COURSE_TASK_STATUS_LABEL.completed).toBe("已完成");
  });
});

describe("buildCourseTaskRow", () => {
  it("有 DDL：M月d日；逾期判定基于 now", () => {
    const row = buildCourseTaskRow(mkA({ ddl: "2026-08-15T09:00:00" }), NOW);
    expect(row.deadlineLabel).toBe("8月15日");
    expect(row.overdue).toBe(true);
    expect(row.hasDdl).toBe(true);
    const future = buildCourseTaskRow(mkA({ ddl: "2026-08-18T23:59:00" }), NOW);
    expect(future.overdue).toBe(false);
  });

  it("无 DDL → 无截止时间 / 非逾期", () => {
    const row = buildCourseTaskRow(mkA({ ddl: undefined }), NOW);
    expect(row.deadlineLabel).toBe("无截止时间");
    expect(row.overdue).toBe(false);
    expect(row.hasDdl).toBe(false);
  });
});

describe("sortCourseAssignments（view-level，不改输入）", () => {
  it("组序：todo/doing → submitted → completed（同 key 时 id 兜底，deterministic）", () => {
    const input = [
      mkA({ id: "c", status: "completed" }),
      mkA({ id: "s", status: "submitted" }),
      mkA({ id: "d", status: "doing" }),
      mkA({ id: "t", status: "todo" }),
    ];
    const sorted = sortCourseAssignments(input);
    // active 组（todo/doing）内部：全部 key 相等 → id 升序兜底
    expect(sorted.map((a) => a.id)).toEqual(["d", "t", "s", "c"]);
    // 不 mutate 输入
    expect(input.map((a) => a.id)).toEqual(["c", "s", "d", "t"]);
  });

  it("active 组内：已逾期最先，其次最近未来，无 DDL 最后", () => {
    const input = [
      mkA({ id: "no-ddl" }),
      mkA({ id: "far", ddl: "2026-08-25T10:00:00" }),
      mkA({ id: "near", ddl: "2026-08-16T10:00:00" }),
      mkA({ id: "overdue", ddl: "2026-08-10T10:00:00" }),
    ];
    const sorted = sortCourseAssignments(input);
    expect(sorted.map((a) => a.id)).toEqual(["overdue", "near", "far", "no-ddl"]);
  });

  it("同组同 key：标题 localeCompare 兜底（deterministic）", () => {
    const input = [
      mkA({ id: "b", title: "乙任务", ddl: "2026-08-16T10:00:00" }),
      mkA({ id: "a", title: "甲任务", ddl: "2026-08-16T10:00:00" }),
    ];
    expect(sortCourseAssignments(input).map((a) => a.id)).toEqual(["a", "b"]);
  });
});

describe("expandableSlice", () => {
  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  it("<= limit 全展示；> limit 默认前 limit", () => {
    expect(expandableSlice([1, 2, 3], false).visible).toEqual([1, 2, 3]);
    expect(expandableSlice([1, 2, 3], false).hiddenCount).toBe(0);
    const s = expandableSlice(items, false);
    expect(s.visible).toEqual([1, 2, 3, 4, 5]);
    expect(s.hiddenCount).toBe(3);
  });
  it("expanded 全量", () => {
    const s = expandableSlice(items, true);
    expect(s.visible).toEqual(items);
    expect(s.hiddenCount).toBe(0);
  });
});

describe("formatCourseStats / formatMaterialMeta", () => {
  it("1 个时段 · 4 个任务 · 2 份资料", () => {
    expect(formatCourseStats(1, 4, 2)).toBe("1 个时段 · 4 个任务 · 2 份资料");
  });

  it("资料 meta：size · uploadDate；缺失字段省略", () => {
    expect(formatMaterialMeta({ size: "2.4 MB", uploadDate: "08月08日" })).toBe("2.4 MB · 08月08日");
    expect(formatMaterialMeta({ uploadDate: "08月08日" })).toBe("08月08日");
  });
});
