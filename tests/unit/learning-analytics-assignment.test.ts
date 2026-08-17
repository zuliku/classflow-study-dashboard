import { describe, it, expect } from "vitest";
import { projectAssignmentCompletions } from "@/lib/analytics/assignmentProjection";
import { AnalyticsProjectionEvent } from "@/lib/analytics/types";

function ev(
  type: string,
  entityId: string,
  occurredAt: number,
  data: Record<string, unknown>,
  seq = 1
): AnalyticsProjectionEvent {
  return { type, entityId, occurredAt, sequence: seq, data };
}

// 2026-08-17 周一 18:00 本地
const MON_18 = new Date(2026, 7, 17, 18, 0, 0).getTime();
const DAY = 86400000;

describe("Assignment Projection", () => {
  it("spec B：created 带 DDL → 完成在 DDL 前 = onTime", () => {
    const { completions, uniqueCompletedAssignments } = projectAssignmentCompletions([
      ev("assignment.created", "a1", MON_18 - 2 * DAY, { ddl: "2026-08-20" }),
      ev("assignment.completed", "a1", MON_18, {}),
    ]);
    expect(completions).toHaveLength(1);
    expect(completions[0].onTime).toBe(true);
    expect(completions[0].ddlAtCompletion).toBe("2026-08-20");
    expect(uniqueCompletedAssignments).toBe(1);
  });

  it("spec B：完成在 DDL 后 = late（onTime false，仍计数）", () => {
    const { completions } = projectAssignmentCompletions([
      ev("assignment.created", "a1", MON_18 - 2 * DAY, { ddl: "2026-08-15" }),
      ev("assignment.completed", "a1", MON_18, {}),
    ]);
    expect(completions[0].onTime).toBe(false);
  });

  it("spec B：从未设置 DDL → onTime null，不进入 eligible sample", () => {
    const { completions } = projectAssignmentCompletions([
      ev("assignment.created", "a1", MON_18 - 2 * DAY, { ddl: null }),
      ev("assignment.completed", "a1", MON_18, {}),
    ]);
    expect(completions[0].onTime).toBeNull();
    expect(completions[0].ddlAtCompletion).toBeNull();
  });

  it("spec B：deadline_changed 后按最新 DDL 判断", () => {
    const { completions } = projectAssignmentCompletions([
      ev("assignment.created", "a1", MON_18 - 2 * DAY, { ddl: "2026-08-15" }),
      ev("assignment.deadline_changed", "a1", MON_18 - DAY, { after: "2026-08-25" }),
      ev("assignment.completed", "a1", MON_18, {}),
    ]);
    expect(completions[0].onTime).toBe(true);
    expect(completions[0].ddlAtCompletion).toBe("2026-08-25");
  });

  it("spec B：completed 时 DDL 未知（history coverage 前创建）→ onTime null", () => {
    const { completions } = projectAssignmentCompletions([
      ev("assignment.completed", "a1", MON_18, {}),
    ]);
    expect(completions).toHaveLength(1);
    expect(completions[0].onTime).toBeNull();
  });

  it("spec B：reopened 后再次完成 → 两条 completion；reopened 计一次", () => {
    const { completions, uniqueCompletedAssignments, uniqueReopenedAssignments } =
      projectAssignmentCompletions([
        ev("assignment.created", "a1", MON_18 - 2 * DAY, { ddl: "2026-08-20" }),
        ev("assignment.completed", "a1", MON_18 - DAY, {}),
        ev("assignment.reopened", "a1", MON_18 - DAY / 2, {}),
        ev("assignment.completed", "a1", MON_18, {}),
      ]);
    expect(completions).toHaveLength(2);
    expect(uniqueCompletedAssignments).toBe(1); // distinct id
    expect(uniqueReopenedAssignments).toBe(1);
  });

  it("spec B：reopened 不生成 completion", () => {
    const { completions, uniqueReopenedAssignments } = projectAssignmentCompletions([
      ev("assignment.created", "a1", MON_18 - 2 * DAY, { ddl: "2026-08-20" }),
      ev("assignment.completed", "a1", MON_18 - DAY, {}),
      ev("assignment.reopened", "a1", MON_18, {}),
    ]);
    expect(completions).toHaveLength(1);
    expect(uniqueReopenedAssignments).toBe(1);
  });

  it("spec：distinct 多任务完成去重", () => {
    const { uniqueCompletedAssignments, uniqueReopenedAssignments } = projectAssignmentCompletions([
      ev("assignment.created", "a1", MON_18 - 2 * DAY, { ddl: "2026-08-20" }),
      ev("assignment.completed", "a1", MON_18, {}),
      ev("assignment.created", "a2", MON_18 - 2 * DAY, { ddl: null }),
      ev("assignment.completed", "a2", MON_18, {}),
      ev("assignment.reopened", "a3", MON_18, {}),
    ]);
    expect(uniqueCompletedAssignments).toBe(2);
    expect(uniqueReopenedAssignments).toBe(1);
  });
});
