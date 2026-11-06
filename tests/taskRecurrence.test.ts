import { describe, it, expect } from "vitest";
import { Assignment } from "@/types";
import {
  buildNextRecurringAssignment,
  buildNextRecurringAssignmentV2,
  getNextRecurringDDL,
  getNextRecurringDoDateAfter,
  getNextRecurringOccurrenceAfter,
} from "@/lib/tasks/taskRecurrence";
import { normalizeAssignment } from "@/lib/tasks/taskSemantics";

function mk(id: string, patch: Partial<Assignment>): Assignment {
  return {
    id,
    courseId: "c1",
    title: id,
    description: "",
    priority: "medium",
    status: "todo",
    progress: 0,
    tags: [],
    ...patch,
  };
}

describe("getNextRecurringDDL（本地墙钟，无 UTC 漂移）", () => {
  it("daily → +1 天，HH:mm 保留", () => {
    expect(getNextRecurringDDL("2026-08-10T23:59:00", "daily")).toBe("2026-08-11T23:59:00");
    expect(getNextRecurringDDL("2026-08-10T09:00:00", "daily")).toBe("2026-08-11T09:00:00");
  });

  it("weekly → +7 天（08-10 → 08-17）", () => {
    expect(getNextRecurringDDL("2026-08-10T23:59:00", "weekly")).toBe("2026-08-17T23:59:00");
  });

  it("biweekly → +14 天", () => {
    expect(getNextRecurringDDL("2026-08-10T23:59:00", "biweekly")).toBe("2026-08-24T23:59:00");
  });

  it("monthly 正常：08-10 → 09-10", () => {
    expect(getNextRecurringDDL("2026-08-10T23:59:00", "monthly")).toBe("2026-09-10T23:59:00");
  });

  it("monthly 月末 clamp：1月31日 → 2月28日", () => {
    expect(getNextRecurringDDL("2026-01-31T23:59:00", "monthly")).toBe("2026-02-28T23:59:00");
  });

  it("monthly 闰年：2028-01-31 → 2028-02-29", () => {
    expect(getNextRecurringDDL("2028-01-31T23:59:00", "monthly")).toBe("2028-02-29T23:59:00");
  });

  it("monthly 3月31日 → 4月30日（不溢出到 5 月）", () => {
    expect(getNextRecurringDDL("2026-03-31T23:59:00", "monthly")).toBe("2026-04-30T23:59:00");
  });

  it("monthly 12月 → 次年 1月（年份边界）", () => {
    expect(getNextRecurringDDL("2026-12-15T08:30:00", "monthly")).toBe("2027-01-15T08:30:00");
  });

  it("非法 ddl → null；无 recurrence → null", () => {
    expect(getNextRecurringDDL("not-a-date", "weekly")).toBeNull();
    expect(getNextRecurringDDL(undefined, "weekly")).toBeNull();
    expect(getNextRecurringDDL("2026-08-10T23:59:00", undefined)).toBeNull();
  });

  it("不修改输入（纯函数）", () => {
    const ddl = "2026-08-10T23:59:00";
    getNextRecurringDDL(ddl, "monthly");
    expect(ddl).toBe("2026-08-10T23:59:00");
  });
});

describe("buildNextRecurringAssignment", () => {
  const current = mk("a1", {
    title: "计量经济学周作业",
    description: "教材 P96 习题",
    ddl: "2026-08-10T23:59:00",
    estimatedMinutes: 90,
    priority: "high",
    tags: ["课后习题"],
    materialIds: ["m1"],
    recurrence: "weekly",
    recurrenceSeriesId: "rs_1",
    status: "completed",
    progress: 100,
    subtasks: [
      { id: "st_old1", title: "习题 3", completed: true },
      { id: "st_old2", title: "习题 5", completed: false },
    ],
  });

  it("状态重置 todo / progress 0 / DDL +7d / 系列字段继承", () => {
    const next = buildNextRecurringAssignment(current);
    expect(next).not.toBeNull();
    if (!next) return;
    expect(next.status).toBe("todo");
    expect(next.progress).toBe(0);
    expect(next.ddl).toBe("2026-08-17T23:59:00");
    expect(next.recurrence).toBe("weekly");
    expect(next.recurrenceSeriesId).toBe("rs_1");
    expect(next.recurrenceParentId).toBe("a1");
    expect(next.courseId).toBe("c1");
    expect(next.title).toBe("计量经济学周作业");
    expect(next.description).toBe("教材 P96 习题");
    expect(next.estimatedMinutes).toBe(90);
    expect(next.priority).toBe("high");
    expect(next.tags).toEqual(["课后习题"]);
  });

  it("subtasks：标题保留、completed 全 false、ID 全新（不与旧 occurrence 共用）", () => {
    const next = buildNextRecurringAssignment(current)!;
    expect(next.subtasks!.map((s) => s.title)).toEqual(["习题 3", "习题 5"]);
    expect(next.subtasks!.every((s) => s.completed === false)).toBe(true);
    expect(next.subtasks!.map((s) => s.id)).not.toEqual(["st_old1", "st_old2"]);
    expect(new Set(next.subtasks!.map((s) => s.id)).size).toBe(2);
  });

  it("materialIds 保留（新数组引用）", () => {
    const next = buildNextRecurringAssignment(current)!;
    expect(next.materialIds).toEqual(["m1"]);
    expect(next.materialIds).not.toBe(current.materialIds);
  });

  it("无 recurrence → null；status 非 completed → null；无效 ddl → null", () => {
    expect(buildNextRecurringAssignment(mk("x", { status: "completed" }))).toBeNull();
    expect(buildNextRecurringAssignment(mk("x", { recurrence: "weekly", ddl: "2026-08-10T23:59:00", status: "doing" }))).toBeNull();
    expect(buildNextRecurringAssignment(mk("x", { recurrence: "weekly", status: "completed" }))).toBeNull();
    expect(
      buildNextRecurringAssignment(mk("x", { recurrence: "weekly", ddl: "bad", status: "completed" }))
    ).toBeNull();
  });
});

describe("Phase 0 recurrence V2（保留节奏、跳过错过周期）", () => {
  const after = (value: string) => new Date(value);

  it("weekly 周一 DDL，周三提交 → 下周一（不是周三 +7）", () => {
    expect(
      getNextRecurringOccurrenceAfter(
        "2026-11-02T23:59:00", // 周一
        "weekly",
        after("2026-11-04T12:00:00")
      )
    ).toBe("2026-11-09T23:59:00");
  });

  it("提前提交：当前 DDL 还在未来 → 仍生成下一个周期，不复制当前 DDL", () => {
    expect(
      getNextRecurringOccurrenceAfter(
        "2026-11-09T23:59:00",
        "weekly",
        after("2026-11-07T12:00:00")
      )
    ).toBe("2026-11-16T23:59:00");
  });

  it("逾期 3 周后提交 → 跳过已错过周期，生成 terminal 之后的下一个周期", () => {
    expect(
      getNextRecurringOccurrenceAfter(
        "2026-11-02T23:59:00",
        "weekly",
        after("2026-11-24T10:00:00")
      )
    ).toBe("2026-11-30T23:59:00");
  });

  it("monthly 月末 clamp 在 V2 中保持", () => {
    expect(
      getNextRecurringOccurrenceAfter(
        "2026-01-31T23:59:00",
        "monthly",
        after("2026-02-01T10:00:00")
      )
    ).toBe("2026-02-28T23:59:00");
  });

  it("doDate 按同一节奏推进", () => {
    expect(
      getNextRecurringDoDateAfter("2026-11-02", "weekly", after("2026-11-04T12:00:00"))
    ).toBe("2026-11-09");
  });

  it("buildNextRecurringAssignmentV2：submitted 可触发，复制 submissionRequired/doDate", () => {
    const current = mk("a1", {
      status: "submitted",
      ddl: "2026-11-02T23:59:00",
      doDate: "2026-11-02",
      recurrence: "weekly",
      recurrenceSeriesId: "rs_1",
      submissionRequired: true,
      submittedAt: "2026-11-04T12:00:00",
    });
    const next = buildNextRecurringAssignmentV2(current, after("2026-11-04T12:00:00"))!;
    expect(next.status).toBe("todo");
    expect(next.ddl).toBe("2026-11-09T23:59:00");
    expect(next.doDate).toBe("2026-11-09");
    expect(next.submissionRequired).toBe(true);
    expect(next.recurrenceParentId).toBe("a1");
    expect(next.submittedAt).toBeUndefined();
    expect(next.completedAt).toBeUndefined();
  });

  it("buildNextRecurringAssignmentV2：active 任务 / 无 recurrence / 无效 DDL → null", () => {
    expect(
      buildNextRecurringAssignmentV2(
        mk("x", { status: "doing", recurrence: "weekly", ddl: "2026-11-02T23:59:00" }),
        after("2026-11-04T12:00:00")
      )
    ).toBeNull();
    expect(buildNextRecurringAssignmentV2(mk("x", { status: "submitted" }), after("2026-11-04T12:00:00"))).toBeNull();
  });
});

describe("normalizeAssignment（persistence 兼容）", () => {
  it("合法 recurrence 字段保留；recurrenceParentId 保留", () => {
    const a = normalizeAssignment(
      mk("a1", { ddl: "2026-08-10T23:59:00", recurrence: "weekly", recurrenceSeriesId: "rs_1", recurrenceParentId: "a0" })
    );
    expect(a.recurrence).toBe("weekly");
    expect(a.recurrenceSeriesId).toBe("rs_1");
    expect(a.recurrenceParentId).toBe("a0");
  });

  it("非法 recurrence（hourly）→ undefined", () => {
    const a = normalizeAssignment(
      mk("a1", { ddl: "2026-08-10T23:59:00", recurrence: "hourly" as Assignment["recurrence"] })
    );
    expect(a.recurrence).toBeUndefined();
    expect(a.recurrenceSeriesId).toBeUndefined();
  });

  it("无 DDL + weekly 非法组合 → recurrence 清洗为 undefined", () => {
    const a = normalizeAssignment(mk("a1", { recurrence: "weekly" }));
    expect(a.recurrence).toBeUndefined();
    expect(a.recurrenceSeriesId).toBeUndefined();
  });

  it("旧数据（无 recurrence 字段）→ 完全兼容", () => {
    const a = normalizeAssignment({ id: "a1", courseId: "c1", title: "旧任务", description: "", priority: "medium", status: "todo", progress: 0, tags: [] });
    expect(a.recurrence).toBeUndefined();
    expect(a.recurrenceSeriesId).toBeUndefined();
    expect(a.recurrenceParentId).toBeUndefined();
  });

  it("有 recurrence 但缺 seriesId（其他入口）→ Domain 层补稳定系列 ID", () => {
    const a1 = normalizeAssignment(mk("a1", { ddl: "2026-08-10T23:59:00", recurrence: "daily" }));
    const a2 = normalizeAssignment(mk("a2", { ddl: "2026-08-11T23:59:00", recurrence: "daily" }));
    expect(a1.recurrenceSeriesId).toBeTruthy();
    expect(a1.recurrenceSeriesId).not.toBe(a2.recurrenceSeriesId);
    expect(a1.recurrenceSeriesId!.startsWith("rs")).toBe(true);
  });
});
