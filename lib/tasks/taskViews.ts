/**
 * Task V2 Workspace 视图层（纯函数，无 React）。
 * Workspace 与 Kiro get_tasks({ scope }) 共用同一 selector —— 业务规则不藏在 JSX。
 * At Risk 视图基于 Deadline Health Engine（planning 数据可选；缺省时 at-risk 为空）。
 */

import { Assignment, CalendarMark, CourseSchedule, Semester, StudyBlock } from "@/types";
import { getTaskDeadline } from "@/lib/tasks/taskSemantics";
import { timeToMinutes } from "@/lib/timeline/timelineGeometry";
import { TaskHealthState } from "@/lib/tasks/taskHealth";
import { deriveAssignmentHealthWithAvailability } from "@/lib/tasks/taskHealthView";

export type TaskWorkspaceView =
  | "focus"
  | "today"
  | "upcoming"
  | "at-risk"
  | "unscheduled"
  | "all"
  | "archive";

export const TASK_WORKSPACE_VIEWS: { id: TaskWorkspaceView; label: string }[] = [
  { id: "focus", label: "聚焦" },
  { id: "today", label: "今天" },
  { id: "upcoming", label: "即将截止" },
  { id: "at-risk", label: "有风险" },
  { id: "unscheduled", label: "待安排" },
  { id: "all", label: "全部" },
  { id: "archive", label: "已归档" },
];

/**
 * Primary Views（Part B）：顶部 Tab 只保留 5 个高频工作区。
 * at-risk（Health 状态）并入 Focus；archive（低频）经「···」进入。
 * 完整 Domain 集合仍为 TASK_WORKSPACE_VIEWS（Kiro Search Scope / 未来 Command Center 复用）。
 */
export const PRIMARY_TASK_WORKSPACE_VIEWS: { id: TaskWorkspaceView; label: string }[] = [
  { id: "focus", label: "聚焦" },
  { id: "today", label: "今天" },
  { id: "upcoming", label: "即将截止" },
  { id: "unscheduled", label: "待安排" },
  { id: "all", label: "全部" },
];

/** Health 计算所需的外部规划数据（可选；缺省时 at-risk 视图为空、行内无 Health 提示） */
export interface TaskHealthPlanningInput {
  schedules: CourseSchedule[];
  calendarMarks: CalendarMark[];
  semester: Semester;
  currentSemesterWeek: number;
}

export interface TaskWorkspaceMeta {
  hasDeadline: boolean;
  deadline?: Date;
  /** 该任务关联 StudyBlock 的计划分钟和（真实 timeToMinutes；非法 block 忽略） */
  scheduledMinutes: number;
  studyBlockCount: number;
  scheduledToday: boolean;
  deadlineToday: boolean;
  overdue: boolean;
  /** Deadline Health（planning 数据提供时才有） */
  health?: TaskHealthState;
}

export interface TaskWorkspaceItem {
  task: Assignment;
  meta: TaskWorkspaceMeta;
}

export const isActiveTask = (a: Assignment): boolean => a.status === "todo" || a.status === "doing";
export const isArchivedTask = (a: Assignment): boolean => a.status === "submitted" || a.status === "completed";

function dayStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function studyBlockMinutes(b: StudyBlock): number {
  const s = timeToMinutes(b.startTime);
  const e = timeToMinutes(b.endTime);
  if (s === null || e === null || e <= s) return 0;
  return e - s;
}

export function buildTaskWorkspaceMeta(
  task: Assignment,
  studyBlocks: StudyBlock[],
  now: Date,
  planning?: TaskHealthPlanningInput
): TaskWorkspaceMeta {
  const deadline = getTaskDeadline(task);
  const blocks = studyBlocks.filter((b) => b.assignmentId === task.id);
  const scheduledMinutes = blocks.reduce((sum, b) => sum + studyBlockMinutes(b), 0);
  const today = dayStr(now);
  const meta: TaskWorkspaceMeta = {
    hasDeadline: deadline !== null,
    deadline: deadline ?? undefined,
    scheduledMinutes,
    studyBlockCount: blocks.length,
    scheduledToday: blocks.some((b) => b.date === today),
    deadlineToday: !!deadline && dayStr(deadline) === today,
    overdue:
      !!deadline &&
      task.status !== "completed" &&
      dayStr(deadline) < today,
  };
  if (planning) {
    meta.health = deriveAssignmentHealthWithAvailability(task, studyBlocks, planning, now).state;
  }
  return meta;
}

/** Focus 排序权重（小 = 前）：overdue > at-risk > 今天截止 > 今天安排 > doing > urgent/high 临近 */
function focusRank(item: TaskWorkspaceItem, now: Date): number {
  const { meta } = item;
  if (meta.overdue) return 0;
  // Part B：At Risk 并入 Focus（Health 判定；overdue 已在 0 位不重复计）
  if (meta.health === "at-risk") return 1;
  if (meta.deadlineToday) return 2;
  if (meta.scheduledToday) return 3;
  if (item.task.status === "doing") return 4;
  const d = meta.deadline;
  if (
    d &&
    (item.task.priority === "urgent" || item.task.priority === "high") &&
    (d.getTime() - now.getTime()) / 86400000 <= 3
  ) {
    return 5;
  }
  return 6;
}

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

/**
 * 视图派生：items + counts（同一规则，UI / Kiro 共用）。
 * - focus：active 且满足「逾期 / at-risk / 今天截止 / 今天安排 / doing / urgent-high 3 天内」，按 focusRank 排序
 * - today：active 且（今天截止 或 今天有 StudyBlock）—— Do Date ≠ Due Date
 * - upcoming：active 且有 DDL 且 deadline 在「今天结束之后」，按 DDL 升序
 * - at-risk：active 且 Health 为 at-risk 或 overdue（基于 Deadline Health Engine；overdue 在前，内部 DDL 早优先）
 * - unscheduled：active 且无任何 StudyBlock（不要求有 DDL）
 * - all：全部任务，active 在前 archive 在后，无 DDL 任务不丢失
 * - archive：submitted + completed
 */
export function deriveTaskWorkspace(
  assignments: Assignment[],
  studyBlocks: StudyBlock[],
  view: TaskWorkspaceView,
  now: Date,
  planning?: TaskHealthPlanningInput
): { items: TaskWorkspaceItem[]; counts: Record<TaskWorkspaceView, number> } {
  const all: TaskWorkspaceItem[] = assignments.map((task) => ({
    task,
    meta: buildTaskWorkspaceMeta(task, studyBlocks, now, planning),
  }));

  const byView = (v: TaskWorkspaceView): TaskWorkspaceItem[] =>
    filterFor(v, all, now);

  return {
    items: byView(view),
    counts: {
      focus: byView("focus").length,
      today: byView("today").length,
      upcoming: byView("upcoming").length,
      "at-risk": byView("at-risk").length,
      unscheduled: byView("unscheduled").length,
      all: all.length,
      archive: byView("archive").length,
    },
  };
}

function filterFor(view: TaskWorkspaceView, all: TaskWorkspaceItem[], now: Date): TaskWorkspaceItem[] {
  const deadlineAsc = (a: TaskWorkspaceItem, b: TaskWorkspaceItem) =>
    (a.meta.deadline?.getTime() ?? Infinity) - (b.meta.deadline?.getTime() ?? Infinity);

  switch (view) {
    case "all": {
      const active = all.filter((it) => isActiveTask(it.task));
      const archived = all.filter((it) => isArchivedTask(it.task));
      const sortActive = (a: TaskWorkspaceItem, b: TaskWorkspaceItem) => {
        const ra = focusRank(a, now);
        const rb = focusRank(b, now);
        if (ra !== rb) return ra - rb;
        const da = a.meta.deadline?.getTime() ?? Infinity;
        const db = b.meta.deadline?.getTime() ?? Infinity;
        if (da !== db) return da - db;
        return (PRIORITY_ORDER[a.task.priority] ?? 9) - (PRIORITY_ORDER[b.task.priority] ?? 9);
      };
      return [...active.sort(sortActive), ...archived];
    }
    case "archive":
      return all.filter((it) => isArchivedTask(it.task));
    case "focus": {
      const items = all.filter(
        (it) =>
          isActiveTask(it.task) &&
          focusRank(it, now) <= 5
      );
      return items.sort((a, b) => {
        const ra = focusRank(a, now);
        const rb = focusRank(b, now);
        if (ra !== rb) return ra - rb;
        const da = a.meta.deadline?.getTime() ?? Infinity;
        const db = b.meta.deadline?.getTime() ?? Infinity;
        if (da !== db) return da - db;
        return (PRIORITY_ORDER[a.task.priority] ?? 9) - (PRIORITY_ORDER[b.task.priority] ?? 9);
      });
    }
    case "today":
      return all
        .filter((it) => isActiveTask(it.task) && (it.meta.deadlineToday || it.meta.scheduledToday))
        .sort(deadlineAsc);
    case "upcoming": {
      const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      return all
        .filter((it) => isActiveTask(it.task) && !!it.meta.deadline && it.meta.deadline > dayEnd)
        .sort(deadlineAsc);
    }
    case "at-risk": {
      // 只包含 Health 判定为 at-risk / overdue 的 active 任务；overdue 在前，内部 DDL 早优先
      const items = all.filter(
        (it) =>
          isActiveTask(it.task) &&
          (it.meta.health === "at-risk" || it.meta.health === "overdue")
      );
      return items.sort((a, b) => {
        const ra = a.meta.health === "overdue" ? 0 : 1;
        const rb = b.meta.health === "overdue" ? 0 : 1;
        if (ra !== rb) return ra - rb;
        return deadlineAsc(a, b);
      });
    }
    case "unscheduled":
      return all
        .filter((it) => isActiveTask(it.task) && it.meta.studyBlockCount === 0)
        .sort(deadlineAsc);
  }
}
