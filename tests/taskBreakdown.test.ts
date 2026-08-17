import { describe, it, expect } from "vitest";
import {
  applyTaskBreakdown,
  parseTaskBreakdownProposal,
  TaskBreakdownProposalSchema,
} from "@/lib/tasks/taskBreakdown";
import { Assignment } from "@/types";

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

function mkState(assignments: Assignment[]) {
  const updated: Assignment[] = [];
  return {
    assignments,
    updateAssignment: (a: Assignment) => {
      updated.push(a);
      const idx = assignments.findIndex((x) => x.id === a.id);
      if (idx >= 0) assignments[idx] = a;
    },
    updated,
  };
}

describe("TaskBreakdownProposalSchema / parseTaskBreakdownProposal", () => {
  it("合法 Proposal 通过并归一化", () => {
    const raw = {
      assignmentId: "a1",
      suggestedEstimatedMinutes: 180,
      subtasks: [
        { title: "明确研究问题", estimatedMinutes: 30 },
        { title: "整理并清洗数据", estimatedMinutes: 60 },
        { title: "完成回归与稳健性检验", estimatedMinutes: 60 },
        { title: "撰写结果与结论", estimatedMinutes: 30 },
      ],
      rationale: ["按实证报告标准流程拆解"],
    };
    expect(TaskBreakdownProposalSchema.safeParse(raw).success).toBe(true);
    const p = parseTaskBreakdownProposal(raw);
    expect(p).not.toBeNull();
    expect(p!.subtasks).toHaveLength(4);
    expect(p!.suggestedEstimatedMinutes).toBe(180);
  });

  it("subtasks 2～8 项：1 项 / 9 项非法", () => {
    expect(parseTaskBreakdownProposal({ assignmentId: "a1", subtasks: [{ title: "x" }] })).toBeNull();
    expect(
      parseTaskBreakdownProposal({
        assignmentId: "a1",
        subtasks: Array.from({ length: 9 }, (_, i) => ({ title: `s${i}` })),
      })
    ).toBeNull();
  });

  it("title 1～120 字符：空 / 超长非法", () => {
    expect(
      parseTaskBreakdownProposal({ assignmentId: "a1", subtasks: [{ title: "" }, { title: "b" }] })
    ).toBeNull();
    expect(
      parseTaskBreakdownProposal({
        assignmentId: "a1",
        subtasks: [{ title: "x".repeat(121) }, { title: "b" }],
      })
    ).toBeNull();
  });

  it("suggestedEstimatedMinutes 1～10080：0 / 负数 / 超长非法", () => {
    expect(
      parseTaskBreakdownProposal({ assignmentId: "a1", suggestedEstimatedMinutes: 0 })
    ).toBeNull();
    expect(
      parseTaskBreakdownProposal({ assignmentId: "a1", suggestedEstimatedMinutes: -5 })
    ).toBeNull();
    expect(
      parseTaskBreakdownProposal({ assignmentId: "a1", suggestedEstimatedMinutes: 10081 })
    ).toBeNull();
  });

  it("subtasks 与 suggestedEstimatedMinutes 至少一项", () => {
    expect(parseTaskBreakdownProposal({ assignmentId: "a1" })).toBeNull();
    // 仅估时（无步骤）合法 → 支持「估计任务耗时」场景
    expect(parseTaskBreakdownProposal({ assignmentId: "a1", suggestedEstimatedMinutes: 60 })).not.toBeNull();
  });
});

describe("applyTaskBreakdown", () => {
  it("无既有步骤：追加 = 写入全部新步骤，progress 0 / todo", () => {
    const state = mkState([mk("a1", {})]);
    const result = applyTaskBreakdown(
      { assignmentId: "a1", subtaskTitles: ["步骤一", "步骤二"], mode: "append" },
      state
    );
    expect(result.ok).toBe(true);
    const a = state.assignments[0];
    expect(a.subtasks).toHaveLength(2);
    expect(a.subtasks![0].title).toBe("步骤一");
    expect(a.subtasks![0].completed).toBe(false);
    expect(a.subtasks![0].id).toBeTruthy();
    expect(a.progress).toBe(0);
    expect(a.status).toBe("todo");
    expect(a.estimatedMinutes).toBeUndefined();
  });

  it("已有步骤：append 保留原步骤与进度，新步骤追加", () => {
    const state = mkState([
      mk("a1", {
        status: "doing",
        progress: 50,
        subtasks: [
          { id: "st1", title: "旧步骤", completed: true },
          { id: "st2", title: "旧步骤2", completed: false },
        ],
      }),
    ]);
    const result = applyTaskBreakdown(
      { assignmentId: "a1", subtaskTitles: ["新步骤"], mode: "append" },
      state
    );
    expect(result.ok).toBe(true);
    const a = state.assignments[0];
    expect(a.subtasks).toHaveLength(3);
    expect(a.subtasks!.map((s) => s.title)).toEqual(["旧步骤", "旧步骤2", "新步骤"]);
    expect(a.progress).toBe(50); // 追加不重算进度
    expect(a.status).toBe("doing");
  });

  it("已有步骤：replace 移除旧步骤（含已完成），进度重算 → 0 / todo，并写 estimate", () => {
    const state = mkState([
      mk("a1", {
        status: "doing",
        progress: 100,
        estimatedMinutes: 120,
        subtasks: [
          { id: "st1", title: "已完成步骤", completed: true },
          { id: "st2", title: "旧步骤", completed: true },
        ],
      }),
    ]);
    const result = applyTaskBreakdown(
      { assignmentId: "a1", subtaskTitles: ["新A", "新B"], mode: "replace", estimatedMinutes: 180 },
      state
    );
    expect(result.ok).toBe(true);
    const a = state.assignments[0];
    expect(a.subtasks!.map((s) => s.title)).toEqual(["新A", "新B"]);
    expect(a.subtasks!.every((s) => !s.completed)).toBe(true);
    expect(a.progress).toBe(0);
    expect(a.status).toBe("todo");
    expect(a.estimatedMinutes).toBe(180);
  });

  it("未确认估时：不写 estimatedMinutes（保留原有）", () => {
    const state = mkState([mk("a1", { estimatedMinutes: 90 })]);
    const result = applyTaskBreakdown(
      { assignmentId: "a1", subtaskTitles: ["s1", "s2"], mode: "append" },
      state
    );
    expect(result.ok).toBe(true);
    expect(state.assignments[0].estimatedMinutes).toBe(90);
  });

  it("submitted / completed 任务禁止 Apply", () => {
    for (const status of ["submitted", "completed"] as const) {
      const state = mkState([mk("a1", { status, subtasks: [] })]);
      const result = applyTaskBreakdown(
        { assignmentId: "a1", subtaskTitles: ["s1", "s2"], mode: "replace" },
        state
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("NOT_ACTIVE");
    }
  });

  it("任务不存在 → NOT_FOUND", () => {
    const state = mkState([]);
    const result = applyTaskBreakdown(
      { assignmentId: "nope", subtaskTitles: ["s1", "s2"], mode: "append" },
      state
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NOT_FOUND");
  });

  it("空步骤标题被过滤，全空 → EMPTY", () => {
    const state = mkState([mk("a1", {})]);
    const result = applyTaskBreakdown(
      { assignmentId: "a1", subtaskTitles: ["  ", ""], mode: "append" },
      state
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("EMPTY");
  });

  it("Undo 恢复完整快照：Subtasks / estimatedMinutes / progress / status", () => {
    const state = mkState([
      mk("a1", {
        status: "doing",
        progress: 50,
        estimatedMinutes: 90,
        subtasks: [{ id: "st1", title: "原步骤", completed: true }],
      }),
    ]);
    const result = applyTaskBreakdown(
      { assignmentId: "a1", subtaskTitles: ["新A", "新B"], mode: "replace", estimatedMinutes: 180 },
      state
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(state.assignments[0].subtasks).toHaveLength(2);
    result.undo();
    const a = state.assignments[0];
    expect(a.subtasks).toEqual([{ id: "st1", title: "原步骤", completed: true }]);
    expect(a.estimatedMinutes).toBe(90);
    expect(a.progress).toBe(50);
    expect(a.status).toBe("doing");
  });
});
