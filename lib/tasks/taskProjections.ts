/**
 * Phase 0：Today / Plan Backlog / Deadline Feed 投影（纯函数，无 React / 无 Zustand）。
 *
 * 所有 surface 共用同一套分组/排序/去重规则：
 * - Today：逾期 → 今天截止 → 今天做 → 今天有安排，每个任务只出现一次
 * - Plan Backlog：逾期 → 本周到期 → 需要安排，每个任务只出现一次
 * - Deadline Feed：逾期 → 今天 → 未来 warningDays → 更晚
 *
 * submitted/completed 永不进入 Today / Plan 活跃投影。
 */

import { differenceInCalendarDays } from "date-fns";
import { Assignment, Priority, StudyBlock } from "@/types";
import {
  getTaskDeadlineInstant,
  isActiveTask,
  isDoToday,
  isDueToday,
  isTaskOverdue,
  isWaitingTask,
  localDateKey,
} from "@/lib/tasks/taskLifecycle";
import {
  activeBlocksForTask,
  indexActiveStudyBlocksByAssignment,
  plannedActiveMinutes,
  remainingMinutes,
  schedulingState,
  TaskSchedulingState,
  studyBlockMinutes,
} from "@/lib/tasks/taskPlanning";

const PRIORITY_ORDER: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export interface TaskProjectionMeta {
  deadline: Date | null;
  deadlineToday: boolean;
  overdue: boolean;
  doToday: boolean;
  scheduledToday: boolean;
  activeStudyBlockCount: number;
  plannedActiveMinutes: number;
  remainingMinutes: number | null;
  schedulingState: TaskSchedulingState;
}

export interface TaskProjectionItem {
  task: Assignment;
  meta: TaskProjectionMeta;
}

export function buildTaskProjectionMeta(
  task: Assignment,
  blocksById: Map<string, StudyBlock[]>,
  now: Date
): TaskProjectionMeta {
  const deadline = getTaskDeadlineInstant(task);
  const blocks = activeBlocksForTask(task.id, blocksById);
  const today = localDateKey(now);
  return {
    deadline,
    deadlineToday: isDueToday(task, now),
    overdue: isTaskOverdue(task, now),
    doToday: isDoToday(task, now),
    scheduledToday: blocks.some((block) => block.date === today),
    activeStudyBlockCount: blocks.length,
    plannedActiveMinutes: plannedActiveMinutes(task.id, blocksById),
    remainingMinutes: remainingMinutes(task, blocksById),
    schedulingState: schedulingState(task, blocksById),
  };
}

function deadlineTime(item: TaskProjectionItem): number {
  return item.meta.deadline?.getTime() ?? Infinity;
}

function priorityRank(item: TaskProjectionItem): number {
  return PRIORITY_ORDER[item.task.priority] ?? 9;
}

function sortByDeadlineThenPriority(a: TaskProjectionItem, b: TaskProjectionItem): number {
  const deadlineDiff = deadlineTime(a) - deadlineTime(b);
  if (deadlineDiff !== 0) return deadlineDiff;
  return priorityRank(a) - priorityRank(b);
}

function sortByPriorityThenDeadline(a: TaskProjectionItem, b: TaskProjectionItem): number {
  const priorityDiff = priorityRank(a) - priorityRank(b);
  if (priorityDiff !== 0) return priorityDiff;
  return deadlineTime(a) - deadlineTime(b);
}

function earliestTodayBlockStart(
  taskId: string,
  blocksById: Map<string, StudyBlock[]>,
  today: string
): string {
  const starts = activeBlocksForTask(taskId, blocksById)
    .filter((block) => block.date === today)
    .map((block) => block.startTime)
    .sort();
  return starts[0] ?? "99:99";
}

function sumActiveBlocksForDate(
  studyBlocks: readonly StudyBlock[],
  date: string
): number {
  return studyBlocks.reduce(
    (sum, block) =>
      block.planningState !== "released" && block.date === date
        ? sum + studyBlockMinutes(block)
        : sum,
    0
  );
}

export interface TodayProjection {
  groups: {
    overdue: TaskProjectionItem[];
    dueToday: TaskProjectionItem[];
    doToday: TaskProjectionItem[];
    scheduledToday: TaskProjectionItem[];
  };
  /** 去重后的任务数 */
  taskCount: number;
  /** 今天所有 active StudyBlock 分钟（含 standalone） */
  plannedMinutes: number;
  /** 今天任务中尚未安排到今天的剩余分钟（不重复计已有 block） */
  unplannedMinutes: number;
  /** 今天任务中没有估时、无法计算剩余的数量 */
  unplannedUnknownCount: number;
  /** 等待反馈数量（不含 Today 主列表） */
  waitingCount: number;
}

export function buildTodayProjection(
  assignments: readonly Assignment[],
  studyBlocks: readonly StudyBlock[],
  now: Date
): TodayProjection {
  const blocksById = indexActiveStudyBlocksByAssignment(studyBlocks);
  const today = localDateKey(now);
  const groups: TodayProjection["groups"] = {
    overdue: [],
    dueToday: [],
    doToday: [],
    scheduledToday: [],
  };

  for (const task of assignments) {
    if (!isActiveTask(task)) continue;
    const item: TaskProjectionItem = {
      task,
      meta: buildTaskProjectionMeta(task, blocksById, now),
    };
    if (item.meta.overdue) groups.overdue.push(item);
    else if (item.meta.deadlineToday) groups.dueToday.push(item);
    else if (item.meta.doToday) groups.doToday.push(item);
    else if (item.meta.scheduledToday) groups.scheduledToday.push(item);
  }

  groups.overdue.sort(sortByDeadlineThenPriority);
  groups.dueToday.sort(sortByDeadlineThenPriority);
  groups.doToday.sort(sortByPriorityThenDeadline);
  groups.scheduledToday.sort((a, b) => {
    const sa = earliestTodayBlockStart(a.task.id, blocksById, today);
    const sb = earliestTodayBlockStart(b.task.id, blocksById, today);
    if (sa !== sb) return sa.localeCompare(sb);
    return sortByPriorityThenDeadline(a, b);
  });

  let unplannedMinutes = 0;
  let unplannedUnknownCount = 0;
  for (const group of Object.values(groups)) {
    for (const item of group) {
      if (item.meta.scheduledToday) continue;
      if (item.meta.remainingMinutes === null) {
        unplannedUnknownCount += 1;
      } else {
        unplannedMinutes += item.meta.remainingMinutes;
      }
    }
  }

  return {
    groups,
    taskCount:
      groups.overdue.length +
      groups.dueToday.length +
      groups.doToday.length +
      groups.scheduledToday.length,
    plannedMinutes: sumActiveBlocksForDate(studyBlocks, today),
    unplannedMinutes,
    unplannedUnknownCount,
    waitingCount: assignments.filter(isWaitingTask).length,
  };
}

export type PlanBacklogBucket = "overdue" | "dueThisWeek" | "needsScheduling";

export interface PlanBacklogProjection {
  buckets: Record<PlanBacklogBucket, TaskProjectionItem[]>;
  counts: Record<PlanBacklogBucket, number>;
}

export function buildPlanBacklogProjection(
  assignments: readonly Assignment[],
  studyBlocks: readonly StudyBlock[],
  selectedWeekDates: readonly string[],
  now: Date
): PlanBacklogProjection {
  const blocksById = indexActiveStudyBlocksByAssignment(studyBlocks);
  const weekSet = new Set(selectedWeekDates);
  const buckets: PlanBacklogProjection["buckets"] = {
    overdue: [],
    dueThisWeek: [],
    needsScheduling: [],
  };

  for (const task of assignments) {
    if (!isActiveTask(task)) continue;
    const item: TaskProjectionItem = {
      task,
      meta: buildTaskProjectionMeta(task, blocksById, now),
    };

    if (item.meta.overdue) {
      buckets.overdue.push(item);
    } else if (item.meta.deadline && weekSet.has(localDateKey(item.meta.deadline))) {
      buckets.dueThisWeek.push(item);
    } else if (item.meta.schedulingState !== "full") {
      buckets.needsScheduling.push(item);
    }
  }

  buckets.overdue.sort(sortByDeadlineThenPriority);
  buckets.dueThisWeek.sort(sortByDeadlineThenPriority);
  buckets.needsScheduling.sort((a, b) => {
    const deadlineDiff = deadlineTime(a) - deadlineTime(b);
    if (deadlineDiff !== 0) return deadlineDiff;
    const priorityDiff = priorityRank(a) - priorityRank(b);
    if (priorityDiff !== 0) return priorityDiff;
    // 剩余多的排前面；unknown 排最后
    return (b.meta.remainingMinutes ?? -1) - (a.meta.remainingMinutes ?? -1);
  });

  return {
    buckets,
    counts: {
      overdue: buckets.overdue.length,
      dueThisWeek: buckets.dueThisWeek.length,
      needsScheduling: buckets.needsScheduling.length,
    },
  };
}

export type DeadlineFeedGroup = "overdue" | "today" | "soon" | "later";

export interface DeadlineFeedItem {
  task: Assignment;
  deadline: Date;
  group: DeadlineFeedGroup;
}

export interface DeadlineFeed {
  groups: Record<DeadlineFeedGroup, DeadlineFeedItem[]>;
  items: DeadlineFeedItem[];
}

export function buildDeadlineFeed(
  assignments: readonly Assignment[],
  now: Date,
  warningDays: number
): DeadlineFeed {
  const groups: DeadlineFeed["groups"] = {
    overdue: [],
    today: [],
    soon: [],
    later: [],
  };
  const today = localDateKey(now);

  for (const task of assignments) {
    if (!isActiveTask(task)) continue;
    const deadline = getTaskDeadlineInstant(task);
    if (!deadline) continue;

    let group: DeadlineFeedGroup;
    if (deadline.getTime() < now.getTime()) {
      group = "overdue";
    } else if (localDateKey(deadline) === today) {
      group = "today";
    } else {
      const days = differenceInCalendarDays(deadline, now);
      group = days > 0 && days <= warningDays ? "soon" : "later";
    }
    groups[group].push({ task, deadline, group });
  }

  const byDeadline = (a: DeadlineFeedItem, b: DeadlineFeedItem) =>
    a.deadline.getTime() - b.deadline.getTime();
  for (const group of Object.values(groups)) group.sort(byDeadline);

  return {
    groups,
    items: [
      ...groups.overdue,
      ...groups.today,
      ...groups.soon,
      ...groups.later,
    ],
  };
}
