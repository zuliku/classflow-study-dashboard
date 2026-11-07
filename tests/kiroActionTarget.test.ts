import { describe, expect, it } from "vitest";
import { resolveKiroActionTarget } from "@/lib/kiro/actionTarget";
import type { WriteToolResult } from "@/lib/ai/tools/write/types";

type Action = Extract<WriteToolResult, { ok: true }>["action"];

function action(overrides: Partial<Action>): Action {
  return {
    tool: "create_assignment",
    entityType: "assignment",
    entityId: "a1",
    title: "任务",
    operation: "update",
    canUndo: true,
    ...overrides,
  };
}

const state = {
  groupProjects: [
    {
      id: "gp1",
      courseId: "c1",
      title: "项目",
      description: "",
      progress: 0,
      updatedAt: "2026-08-10",
      members: [{ id: "gm1", name: "成员", role: "leader" as const }],
      tasks: [{ id: "gt1", title: "任务", ddl: "2026-08-10T23:59:00", completed: false }],
    },
  ],
};

describe("resolveKiroActionTarget", () => {
  it("assignment / course / study-block / reminder → 真实实体", () => {
    expect(resolveKiroActionTarget(action({}), state)).toEqual({
      kind: "assignment",
      assignmentId: "a1",
    });
    expect(
      resolveKiroActionTarget(action({ entityType: "course", entityId: "c1" }), state)
    ).toEqual({ kind: "course", courseId: "c1" });
    expect(
      resolveKiroActionTarget(action({ entityType: "study-block", entityId: "sb1" }), state)
    ).toEqual({ kind: "study-block", blockId: "sb1" });
    expect(
      resolveKiroActionTarget(action({ entityType: "reminder", entityId: "r1" }), state)
    ).toEqual({ kind: "reminder", reminderId: "r1" });
  });

  it("group-task / group-member 必须能反查到所属项目", () => {
    expect(
      resolveKiroActionTarget(
        action({ entityType: "group-task", entityId: "gt1" }),
        state
      )
    ).toEqual({ kind: "group-task", projectId: "gp1", taskId: "gt1" });
    expect(
      resolveKiroActionTarget(
        action({ entityType: "group-member", entityId: "gm1" }),
        state
      )
    ).toEqual({ kind: "group-member", projectId: "gp1", memberId: "gm1" });
  });

  it("已删除 / 无法唯一解析 → null（不显示查看）", () => {
    expect(
      resolveKiroActionTarget(
        action({ entityType: "group-task", entityId: "gone" }),
        state
      )
    ).toBeNull();
    expect(
      resolveKiroActionTarget(
        action({ entityType: "change-set", entityId: "cs" }),
        state
      )
    ).toBeNull();
    expect(
      resolveKiroActionTarget(
        action({ operation: "delete", entityId: "a1" }),
        state
      )
    ).toBeNull();
  });
});
