import { GroupProject, GroupTask } from "@/types";
import { combineLocalDateTime, getLocalDDLDate, getLocalDDLTime, parseLocalDDL } from "@/lib/ddl";

/** 任务进度统一计算：无任务 = 0% */
export function calculateGroupProjectProgress(tasks: GroupTask[]): number {
  if (tasks.length === 0) return 0;
  return Math.round((tasks.filter((t) => t.completed).length / tasks.length) * 100);
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
