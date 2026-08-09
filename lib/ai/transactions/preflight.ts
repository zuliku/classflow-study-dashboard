/**
 * Change Set Preflight（Task 8）：
 *  - 逐项对 projected state 预检（前序修改可见）
 *  - 同实体同字段重复写 → 拒绝（contradictory plan）
 *  - 最终完整性：transaction 不新增 fatal integrity issue（report, never guess）
 *  - Risk 完全由 ClassFlow 计算（模型不得影响）
 */

import { AppState } from "@/store/useAppStore";
import {
  ChangeSetActionInput,
  ChangeSetPreflightResult,
  ChangeSetRisk,
  KIRO_TRANSACTION_SAFE_TOOL_NAMES,
  MAX_CHANGE_SET_ACTIONS,
  TransactionSafeToolName,
} from "@/lib/ai/transactions/types";
import { prepareKiroWriteTool, PreparedWriteAction } from "@/lib/ai/tools/write/prepare";
import { findDataIntegrityIssues, classifyIntegrityIssues, DataSnapshot } from "@/lib/dataIntegrity";

function toSnapshot(state: AppState): DataSnapshot {
  return {
    courses: state.courses,
    schedules: state.schedules,
    assignments: state.assignments,
    calendarMarks: state.calendarMarks,
    groupProjects: state.groupProjects,
  };
}

function fatalCount(state: AppState): number {
  return classifyIntegrityIssues(findDataIntegrityIssues(toSnapshot(state))).fatal.length;
}

/** 同实体同字段重复写检测：记录每个字段最后一次写入；再次写同一字段 → contradictory */
const FIELD_OF_TOOL: Record<TransactionSafeToolName, string | null> = {
  update_assignment: "title",
  set_assignment_ddl: "ddl",
  set_assignment_priority: "priority",
  set_assignment_status: "status",
  set_assignment_progress: "progress",
  toggle_assignment_subtask: null, // toggle 允许重复
  delete_assignment: null, // delete 后续操作会自然失败/矛盾由实体缺失覆盖
  move_schedule: "time",
  resize_schedule: "time",
  update_schedule: "time",
  exclude_schedule_week: "excluded",
  delete_schedule: null,
  update_course: "info",
  update_group_project: "info",
  update_group_member: "role",
  update_group_task: "title",
  assign_group_task: "assignee",
  set_group_task_ddl: "ddl",
  toggle_group_task: null,
};

export function preflightChangeSet(
  input: { actions: ChangeSetActionInput[] },
  state: AppState
): ChangeSetPreflightResult {
  if (!Array.isArray(input.actions) || input.actions.length === 0) {
    return { ok: false, failedActionIndex: 0, code: "INVALID_INPUT", message: "Change Set 至少需要 1 项操作。" };
  }
  if (input.actions.length > MAX_CHANGE_SET_ACTIONS) {
    return {
      ok: false,
      failedActionIndex: 0,
      code: "TRANSACTION_TOO_LARGE",
      message: `一组修改最多 ${MAX_CHANGE_SET_ACTIONS} 项。`,
    };
  }

  const baselineFatal = fatalCount(state);
  let projected: AppState = state;
  const prepared: PreparedWriteAction[] = [];
  const seenFields = new Map<string, string>();

  for (let i = 0; i < input.actions.length; i++) {
    const action = input.actions[i];
    if (!action || !KIRO_TRANSACTION_SAFE_TOOL_NAMES.includes(action.tool as TransactionSafeToolName)) {
      return {
        ok: false,
        failedActionIndex: i,
        code: "TRANSACTION_UNSUPPORTED",
        message: `第 ${i + 1} 项操作使用的工具不支持原子执行。`,
      };
    }

    const prep = prepareKiroWriteTool(action.tool, action.input, projected);
    if (!prep.ok) {
      return { ok: false, failedActionIndex: i, code: prep.code, message: prep.message, details: prep.details };
    }

    // 同实体同字段重复写 → contradictory plan
    const field = FIELD_OF_TOOL[action.tool as TransactionSafeToolName];
    if (field) {
      const key = `${prep.view.entityType}:${prep.view.entityId}:${field}`;
      if (seenFields.has(key)) {
        return {
          ok: false,
          failedActionIndex: i,
          code: "TRANSACTION_CONTRADICTORY",
          message: `对「${prep.view.title}」的同一字段存在互相覆盖的修改，请重新规划。`,
        };
      }
      seenFields.set(key, action.tool);
    }

    prepared.push(prep);
    projected = prep.project(projected);
  }

  // 完整性：transaction 不得新增 fatal integrity issue
  if (fatalCount(projected) > baselineFatal) {
    return {
      ok: false,
      failedActionIndex: 0,
      code: "TRANSACTION_INTEGRITY",
      message: "这组修改会导致数据完整性问题（如孤儿引用），因此没有执行。",
    };
  }

  const risk: ChangeSetRisk = input.actions.some((a) => a.tool.startsWith("delete_"))
    ? "destructive"
    : input.actions.length >= 5
      ? "bulk"
      : "normal";

  return {
    ok: true,
    actions: prepared,
    risk,
    preview: prepared.map((p) => p.view),
    projected,
  };
}

/** 需要确认：destructive 或 bulk（Risk 完全由 ClassFlow 决定） */
export function changeSetRequiresConfirm(risk: ChangeSetRisk): boolean {
  return risk === "destructive" || risk === "bulk";
}

/** preview → 用户可读的确认文案（不展示 tool name / JSON） */
export function changeSetConfirmText(preview: { entityType: string; operation: string; tool: string }[]): string[] {
  const grouped = new Map<string, number>();
  for (const v of preview) {
    const label = ACTION_GROUP_LABELS[v.tool] ?? "修改";
    grouped.set(label, (grouped.get(label) ?? 0) + 1);
  }
  return Array.from(grouped.entries()).map(([label, n]) => `${label} ${n} 项`);
}

const ACTION_GROUP_LABELS: Record<string, string> = {
  set_assignment_ddl: "调整任务截止时间",
  set_assignment_priority: "修改任务优先级",
  set_assignment_status: "修改任务状态",
  set_assignment_progress: "修改任务进度",
  update_assignment: "修改任务信息",
  toggle_assignment_subtask: "切换任务子步骤",
  delete_assignment: "删除任务",
  move_schedule: "移动课程",
  resize_schedule: "调整课程时长",
  update_schedule: "调整课程排课",
  exclude_schedule_week: "排除教学周",
  delete_schedule: "删除排课",
  update_course: "修改课程信息",
  update_group_project: "修改小组项目",
  update_group_member: "修改小组成员",
  update_group_task: "修改小组任务",
  assign_group_task: "调整任务分配",
  set_group_task_ddl: "调整小组任务截止时间",
  toggle_group_task: "切换小组任务状态",
};
