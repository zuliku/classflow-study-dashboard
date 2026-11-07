import { GroupProject, GroupTask } from "@/types";
import { combineLocalDateTime, getLocalDDLDate, getLocalDDLTime, parseLocalDDL } from "@/lib/ddl";

/** 任务进度统一计算：无任务 = 0% */
export function calculateGroupProjectProgress(tasks: GroupTask[]): number {
  if (tasks.length === 0) return 0;
  return Math.round((tasks.filter((t) => t.completed).length / tasks.length) * 100);
}

export type GroupTaskFilter = "all" | "open" | "overdue" | "due-soon" | "completed";

export interface GroupTaskFilterOptions {
  filter?: GroupTaskFilter;
  /** "all" / undefined = 不按负责人过滤；"unassigned" = 未分配 */
  assigneeId?: string;
  query?: string;
  now?: Date;
}

export interface GroupProjectStats {
  total: number;
  completed: number;
  open: number;
  overdue: number;
  /** 未来 7 天内截止（含今天，不含已逾期） */
  dueSoon: number;
  unassigned: number;
  nextDeadline: Date | null;
}

export interface GroupMemberWorkload {
  memberId: string;
  name: string;
  open: number;
  overdue: number;
  completed: number;
  total: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function taskDeadline(task: GroupTask): Date | null {
  return parseLocalDDL(task.ddl);
}

function isTaskOverdue(task: GroupTask, now: Date): boolean {
  if (task.completed) return false;
  const deadline = taskDeadline(task);
  return !!deadline && deadline.getTime() < now.getTime();
}

/** 单一任务过滤事实源（UI / 测试 / 后续导出共用） */
export function filterGroupTasks(tasks: readonly GroupTask[], options: GroupTaskFilterOptions = {}): GroupTask[] {
  const now = options.now ?? new Date();
  const query = (options.query ?? "").trim().toLowerCase();
  const assigneeId = options.assigneeId ?? "all";
  const filter = options.filter ?? "all";
  const soonCutoff = now.getTime() + 7 * DAY_MS;

  return tasks.filter((task) => {
    if (assigneeId === "unassigned") {
      if (task.assigneeId) return false;
    } else if (assigneeId !== "all" && task.assigneeId !== assigneeId) {
      return false;
    }
    if (query && !task.title.toLowerCase().includes(query)) return false;

    if (filter === "completed") return task.completed;
    if (filter === "open") return !task.completed;
    if (filter === "overdue") return isTaskOverdue(task, now);
    if (filter === "due-soon") {
      if (task.completed) return false;
      const deadline = taskDeadline(task);
      return !!deadline && deadline.getTime() >= now.getTime() && deadline.getTime() <= soonCutoff;
    }
    return true;
  });
}

/** 项目健康事实：全部由现有 tasks/members 派生，不写 Store */
export function deriveGroupProjectStats(project: GroupProject, now: Date = new Date()): GroupProjectStats {
  const openTasks = project.tasks.filter((task) => !task.completed);
  const soonCutoff = now.getTime() + 7 * DAY_MS;
  const deadlines = openTasks
    .map(taskDeadline)
    .filter((deadline): deadline is Date => deadline !== null && deadline.getTime() >= now.getTime())
    .sort((a, b) => a.getTime() - b.getTime());

  return {
    total: project.tasks.length,
    completed: project.tasks.length - openTasks.length,
    open: openTasks.length,
    overdue: project.tasks.filter((task) => isTaskOverdue(task, now)).length,
    dueSoon: openTasks.filter((task) => {
      const deadline = taskDeadline(task);
      return !!deadline && deadline.getTime() >= now.getTime() && deadline.getTime() <= soonCutoff;
    }).length,
    unassigned: openTasks.filter((task) => !task.assigneeId).length,
    nextDeadline: deadlines[0] ?? null,
  };
}

/** 成员负载：只统计真实任务关联，未分配任务不在成员行重复计数 */
export function deriveMemberWorkload(project: GroupProject, now: Date = new Date()): GroupMemberWorkload[] {
  return project.members.map((member) => {
    const tasks = project.tasks.filter((task) => task.assigneeId === member.id);
    const open = tasks.filter((task) => !task.completed);
    return {
      memberId: member.id,
      name: member.name,
      open: open.length,
      overdue: tasks.filter((task) => isTaskOverdue(task, now)).length,
      completed: tasks.length - open.length,
      total: tasks.length,
    };
  });
}

/** 本地日期 "YYYY-MM-DD"（不用 toISOString，避免 UTC 漂移） */
export function formatLocalDate(date: Date = new Date()): string {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 旧 GroupTask 形状（assigneeName/assigneeAvatar 冗余字段） */
export interface LegacyGroupTask {
  id: string;
  title: string;
  assigneeName?: string;
  assigneeAvatar?: string;
  ddl: string;
  completed: boolean;
}

/** 统一 GroupTask DDL 为本地格式（旧 Z 数据按墙钟重建，不带 Z） */
export function normalizeLocalDDL(ddl: string): string {
  if (!ddl || !/[zZ]$/.test(ddl.trim())) return ddl;
  const parsed = parseLocalDDL(ddl);
  if (!parsed) return ddl;
  return combineLocalDateTime(getLocalDDLDate(ddl), getLocalDDLTime(ddl));
}

/**
 * legacy → v2 任务转换：
 * - assigneeName 唯一匹配成员 → assigneeId；无法唯一确定 → undefined（不猜）
 * - 移除冗余 assigneeName / assigneeAvatar
 * - DDL 归一为本地格式
 */
export function normalizeGroupTask(
  task: LegacyGroupTask,
  members: { id: string; name: string }[]
): GroupTask {
  let assigneeId = (task as Partial<GroupTask>).assigneeId;
  if (!assigneeId && task.assigneeName) {
    const matches = members.filter((m) => m.name === task.assigneeName);
    if (matches.length === 1) assigneeId = matches[0].id;
  }

  const { assigneeName: _name, assigneeAvatar: _avatar, ...rest } = task;
  return {
    ...rest,
    ddl: normalizeLocalDDL(task.ddl),
    assigneeId,
  };
}

/** 项目级归一化（persist 迁移 / 备份恢复共用） */
export function normalizeGroupProject(project: GroupProject): GroupProject {
  const members = (project.members ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    avatarUrl: m.avatarUrl,
    role: m.role,
    major: m.major,
  }));
  const tasks = (project.tasks ?? []).map((t) =>
    normalizeGroupTask(t as unknown as LegacyGroupTask, members)
  );
  return {
    ...project,
    members,
    tasks,
    progress: calculateGroupProjectProgress(tasks),
  };
}
