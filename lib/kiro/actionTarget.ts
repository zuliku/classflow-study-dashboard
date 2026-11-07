/**
 * Kiro Action Card → 实体深链（事实 UI 的下一步）。
 *
 * 只读解析：不写 Store；navigation 由组件层执行。
 * 目的：用户看到 Kiro 修改成功后，可以立即核对真实实体，而不是只能撤销。
 */

import type { AppState } from "@/store/useAppStore";
import type { WriteToolResult } from "@/lib/ai/tools/write/types";

type WriteAction = Extract<WriteToolResult, { ok: true }>["action"];

export type KiroActionTarget =
  | { kind: "assignment"; assignmentId: string }
  | { kind: "course"; courseId: string }
  | { kind: "group-project"; projectId: string }
  | { kind: "group-task"; projectId: string; taskId: string }
  | { kind: "group-member"; projectId: string; memberId: string }
  | { kind: "study-block"; blockId: string }
  | { kind: "calendar-mark"; markId: string }
  | { kind: "reminder"; reminderId: string };

/** entityType/entityId → 可导航目标；无法唯一解析（change-set / 已删除实体）→ null */
export function resolveKiroActionTarget(
  action: WriteAction,
  state: Pick<AppState, "groupProjects">
): KiroActionTarget | null {
  // 删除后的实体不存在，不提供「查看」死链。
  if (action.operation === "delete") return null;
  switch (action.entityType) {
    case "assignment":
      return { kind: "assignment", assignmentId: action.entityId };
    case "course":
      return { kind: "course", courseId: action.entityId };
    case "study-block":
      return { kind: "study-block", blockId: action.entityId };
    case "calendar-mark":
      return { kind: "calendar-mark", markId: action.entityId };
    case "reminder":
      return { kind: "reminder", reminderId: action.entityId };
    case "group-project":
      return { kind: "group-project", projectId: action.entityId };
    case "group-task": {
      const project = state.groupProjects.find((candidate) =>
        candidate.tasks.some((task) => task.id === action.entityId)
      );
      return project
        ? { kind: "group-task", projectId: project.id, taskId: action.entityId }
        : null;
    }
    case "group-member": {
      const project = state.groupProjects.find((candidate) =>
        candidate.members.some((member) => member.id === action.entityId)
      );
      return project
        ? { kind: "group-member", projectId: project.id, memberId: action.entityId }
        : null;
    }
    default:
      return null;
  }
}
