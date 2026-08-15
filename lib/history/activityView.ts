/**
 * Entity Activity Timeline —— 纯 View Projection（read-only）。
 * 消费真实 Learning History（lib/history/*），不读 Zustand 当前状态“推测”历史。
 * - scope："assignment" | "course"：过滤噪音、选择文案与可见事件
 * - 文案使用 event snapshot（assignmentTitleSnapshot / courseNameSnapshot / event.data），
 *   禁止 retroactively 用当前实体标题替换历史快照
 * - same-mutation 去重：同一 assignmentId + occurredAt + source 下 completed/reopened
 *   抑制同组 status_changed（仅 View 层，不删除 IndexedDB 事件）
 * - 时间/分组：本地墙钟；event.localDate 是已记录事实（不重新用 UTC 边界推导）
 */

import { LearningHistoryEvent } from "@/lib/history/types";
import {
  flushLearningHistoryQueue,
} from "@/lib/history/recorder";
import {
  getLearningHistoryCoverage,
} from "@/lib/history/store";
import {
  queryLearningHistory,
} from "@/lib/history/query";
import { formatEstimatedMinutes } from "@/lib/tasks/taskSemantics";
import { formatFocusDurationMs } from "@/lib/focus/focusView";

export type ActivityScope = "assignment" | "course";
export type ActivityTone = "neutral" | "positive" | "warning";
export type ActivityCategory = "task" | "schedule" | "study" | "focus" | "course";
export type ActivitySource = "kiro" | "system" | "import";

export interface ActivityRow {
  id: string;
  occurredAt: number;
  localDate: string;
  title: string;
  detail?: string;
  tone: ActivityTone;
  /** manual → undefined（UI 不显示 badge） */
  source?: ActivitySource;
  category: ActivityCategory;
}

const STATUS_LABELS: Record<string, string> = {
  todo: "待完成",
  doing: "进行中",
  submitted: "已提交",
  completed: "已完成",
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: "紧急",
  high: "高",
  medium: "中",
  low: "低",
};

const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/** "YYYY-MM-DDTHH:mm[:ss]" → "8月18日 20:00"；非法 → null */
export function formatActivityDeadline(ddl: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(ddl);
  if (!m) return null;
  return `${Number(m[2])}月${Number(m[3])}日 ${m[4]}:${m[5]}`;
}

/** "YYYY-MM-DD" → "8月17日"（同年）；跨年 → "2025年12月3日" */
export function formatActivityDateCN(localDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!m) return localDate;
  const now = new Date();
  const sameYear = now.getFullYear() === Number(m[1]);
  return sameYear
    ? `${Number(m[2])}月${Number(m[3])}日`
    : `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 行时间：同一天 → "14:32"；同年跨天 → "8月14日 14:32"；更旧 → "2026年8月1日 09:20" */
export function formatActivityTime(occurredAt: number, localDate: string, now: Date = new Date()): string {
  const d = new Date(occurredAt);
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  if (localDate === today) return time;
  return `${formatActivityDateCN(localDate)} ${time}`;
}

/** 分组 label：今天 / 昨天 / 8月15日 / 2025年12月3日 */
export function formatActivityGroupLabel(localDate: string, now: Date = new Date()): string {
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  if (localDate === today) return "今天";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yStr = `${yesterday.getFullYear()}-${pad2(yesterday.getMonth() + 1)}-${pad2(yesterday.getDate())}`;
  if (localDate === yStr) return "昨天";
  return formatActivityDateCN(localDate);
}

// ---------- Event allowlist ----------

const ASSIGNMENT_SCOPE_TYPES = new Set([
  "assignment.created",
  "assignment.status_changed",
  "assignment.completed",
  "assignment.reopened",
  "assignment.deadline_changed",
  "assignment.estimate_changed",
  "assignment.priority_changed",
  "assignment.deleted",
  "assignment.restored",
  "study_block.created",
  "study_block.updated",
  "study_block.deleted",
  "focus.completed",
]);

const COURSE_SCOPE_TYPES = new Set([
  "course.created",
  "course.updated",
  "schedule.created",
  "schedule.updated",
  "schedule.deleted",
  "assignment.created",
  "assignment.completed",
  "assignment.reopened",
  "assignment.deleted",
  "assignment.restored",
  "assignment.deadline_changed",
  "study_block.created",
  "study_block.updated",
  "study_block.deleted",
  "focus.completed",
]);

function isAllowed(event: LearningHistoryEvent, scope: ActivityScope): boolean {
  return (scope === "assignment" ? ASSIGNMENT_SCOPE_TYPES : COURSE_SCOPE_TYPES).has(event.type);
}

// ---------- Same-mutation suppression（completed/reopened 抑制 status_changed） ----------

function applyStatusDuplicateSuppression(events: LearningHistoryEvent[]): LearningHistoryEvent[] {
  const suppress = new Set<string>();
  const groups = new Map<string, LearningHistoryEvent[]>();
  for (const e of events) {
    if (e.assignmentId === undefined) continue;
    const key = `${e.assignmentId}|${e.occurredAt}|${e.source}`;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }
  for (const group of Array.from(groups.values())) {
    const hasCompleted = group.some((e) => e.type === "assignment.completed");
    const hasReopened = group.some((e) => e.type === "assignment.reopened");
    if (!hasCompleted && !hasReopened) continue;
    for (const e of group) {
      if (e.type === "assignment.status_changed") suppress.add(e.id);
    }
  }
  return events.filter((e) => !suppress.has(e.id));
}

// ---------- Row builders ----------

function row(
  event: LearningHistoryEvent,
  title: string,
  detail: string | undefined,
  category: ActivityCategory,
  tone: ActivityTone = "neutral"
): ActivityRow {
  return {
    id: event.id,
    occurredAt: event.occurredAt,
    localDate: event.localDate,
    title,
    detail,
    tone,
    source: event.source === "manual" ? undefined : event.source,
    category,
  };
}

function studyBlockTimeDetail(data: {
  date?: string;
  startTime?: string;
  endTime?: string;
}): string | undefined {
  const parts: string[] = [];
  if (data.date) parts.push(formatActivityDateCN(data.date));
  if (data.startTime || data.endTime) {
    parts.push(`${data.startTime ?? "?"}–${data.endTime ?? "?"}`);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function buildRow(event: LearningHistoryEvent, scope: ActivityScope): ActivityRow | null {
  switch (event.type) {
    case "assignment.created":
      return row(event, "创建任务", undefined, "task");
    case "assignment.completed":
      return row(event, "完成任务", undefined, "task", "positive");
    case "assignment.reopened":
      return row(event, "重新打开任务", undefined, "task");
    case "assignment.status_changed": {
      const d = event.data as { from: string; to: string };
      return row(
        event,
        `状态从「${STATUS_LABELS[d.from] ?? d.from}」改为「${STATUS_LABELS[d.to] ?? d.to}」`,
        undefined,
        "task"
      );
    }
    case "assignment.deadline_changed": {
      const d = event.data as { before: string | null; after: string | null };
      let detail: string | undefined;
      if (d.before === null && d.after !== null) {
        detail = `设置截止时间为 ${formatActivityDeadline(d.after) ?? d.after}`;
      } else if (d.before !== null && d.after === null) {
        detail = "移除截止时间";
      } else {
        detail = `将截止时间调整为 ${formatActivityDeadline(d.after ?? "") ?? d.after}`;
      }
      return row(event, "调整任务截止时间", detail, "task");
    }
    case "assignment.priority_changed": {
      const d = event.data as { before: string; after: string };
      return row(
        event,
        `优先级从「${PRIORITY_LABELS[d.before] ?? d.before}」改为「${PRIORITY_LABELS[d.after] ?? d.after}」`,
        undefined,
        "task"
      );
    }
    case "assignment.estimate_changed": {
      const d = event.data as { before: number | null; after: number | null };
      const before =
        d.before === null ? "未设置" : (formatEstimatedMinutes(d.before) ?? `${d.before} 分钟`);
      const after =
        d.after === null ? "未设置" : (formatEstimatedMinutes(d.after) ?? `${d.after} 分钟`);
      const title = `预计耗时从${before === "未设置" ? "" : " "}${before}调整为${
        after === "未设置" ? "" : " "
      }${after}`;
      return row(event, title, undefined, "task");
    }
    case "assignment.deleted":
      return row(event, "删除任务", undefined, "task", "warning");
    case "assignment.restored":
      return row(event, "恢复任务", undefined, "task");
    case "study_block.created": {
      const d = event.data as { date?: string; startTime?: string; endTime?: string };
      return row(event, "安排学习时间", studyBlockTimeDetail(d), "study");
    }
    case "study_block.updated": {
      const d = event.data as { date?: string; startTime?: string; endTime?: string };
      return row(event, "调整学习安排", studyBlockTimeDetail(d), "study");
    }
    case "study_block.deleted":
      return row(event, "移除学习安排", undefined, "study", "warning");
    case "focus.completed": {
      const d = event.data as { actualActiveMs?: number };
      // 统一 Focus duration 口径（V1.1）：与 Follow-up / Execution / Toast 同一 formatter
      const minutes =
        typeof d.actualActiveMs === "number"
          ? formatFocusDurationMs(d.actualActiveMs)
          : null;
      return row(event, "完成专注", minutes ?? undefined, "focus", "positive");
    }
    case "course.created":
      return row(event, "创建课程", undefined, "course");
    case "course.updated": {
      const d = event.data as {
        before?: Record<string, unknown>;
        after?: Record<string, unknown>;
      };
      const FIELD_LABELS: Record<string, string> = {
        name: "名称",
        code: "代码",
        teacher: "教师",
        classroom: "教室",
        credit: "学分",
      };
      const changed =
        d.before && d.after
          ? Object.keys(FIELD_LABELS).filter(
              (k) => (d.before as Record<string, unknown>)[k] !== (d.after as Record<string, unknown>)[k]
            )
          : [];
      const detail =
        changed.length > 0 ? changed.map((k) => FIELD_LABELS[k]).join(" · ") : undefined;
      return row(event, "更新课程信息", detail, "course");
    }
    case "schedule.created": {
      const d = event.data as { dayOfWeek?: number; startTime?: string; endTime?: string; location?: string };
      const parts: string[] = [];
      if (typeof d.dayOfWeek === "number" && d.dayOfWeek >= 1 && d.dayOfWeek <= 7) {
        parts.push(WEEKDAY_LABELS[d.dayOfWeek - 1]);
      }
      if (d.startTime || d.endTime) parts.push(`${d.startTime ?? "?"}–${d.endTime ?? "?"}`);
      if (d.location) parts.push(d.location);
      return row(event, "添加上课时段", parts.length > 0 ? parts.join(" · ") : undefined, "schedule");
    }
    case "schedule.updated":
      return row(event, "调整上课时段", undefined, "schedule");
    case "schedule.deleted":
      return row(event, "删除上课时段", undefined, "schedule", "warning");
    default:
      return null;
  }
}

/** Course scope：assignment milestone 使用历史 snapshot 标题 */
function buildCourseAssignmentRow(event: LearningHistoryEvent): ActivityRow | null {
  const snapshot = event.assignmentTitleSnapshot;
  switch (event.type) {
    case "assignment.created":
      return row(event, "创建任务", snapshot, "task");
    case "assignment.completed":
      return row(event, "完成任务", snapshot, "task", "positive");
    case "assignment.reopened":
      return row(event, "重新打开任务", snapshot, "task");
    case "assignment.deleted":
      return row(event, "删除任务", snapshot, "task", "warning");
    case "assignment.restored":
      return row(event, "恢复任务", snapshot, "task");
    case "assignment.deadline_changed": {
      const d = event.data as { after: string | null };
      const when = d.after ? formatActivityDeadline(d.after) ?? d.after : "移除截止时间";
      return row(event, "调整任务截止时间", snapshot ? `${snapshot} · ${when}` : when, "task");
    }
    default:
      return null;
  }
}

/**
 * 纯投影：LearningHistoryEvent[] → ActivityRow[]（scope 决定 allowlist 与文案）。
 * 输入不被 mutate；不读取 IndexedDB；所有文案来自事件自身。
 */
export function projectActivityEvents(
  events: LearningHistoryEvent[],
  scope: ActivityScope
): ActivityRow[] {
  const filtered = events.filter((e) => isAllowed(e, scope));
  const deduped = applyStatusDuplicateSuppression(filtered);
  const out: ActivityRow[] = [];
  for (const e of deduped) {
    const r =
      scope === "assignment" ? buildRow(e, scope) : e.type.startsWith("assignment.") ? buildCourseAssignmentRow(e) : buildRow(e, scope);
    if (r) out.push(r);
  }
  return out;
}

/** UI 展示上限：query 21（第 21 条仅判断 hasMore）；默认显示 5，展开后最多 20 */
export const ACTIVITY_QUERY_LIMIT = 21;
export const ACTIVITY_INLINE_LIMIT = 5;
export const ACTIVITY_EXPANDED_LIMIT = 20;

export interface EntityActivityLoadResult {
  rows: ActivityRow[];
  hasMore: boolean;
  coverageStartedAt: number | null;
}

/**
 * 实体 Activity 加载器（Hook 的可测核心）：
 * - flush queue → bounded query（assignmentId/courseId index）→ coverage → projection
 * - 单实体一次查询；不逐行查 IndexedDB
 */
export async function loadEntityActivity(input: {
  assignmentId?: string;
  courseId?: string;
  limit?: number;
}): Promise<EntityActivityLoadResult> {
  const { assignmentId, courseId } = input;
  const limit = input.limit ?? ACTIVITY_QUERY_LIMIT;
  await flushLearningHistoryQueue();
  const scope: ActivityScope = assignmentId !== undefined ? "assignment" : "course";
  const events = await queryLearningHistory({
    ...(assignmentId !== undefined ? { assignmentId } : { courseId }),
    order: "desc",
    limit,
  });
  const rows = projectActivityEvents(events, scope).slice(0, ACTIVITY_EXPANDED_LIMIT);
  const coverage = await getLearningHistoryCoverage();
  return {
    rows,
    hasMore: events.length > ACTIVITY_EXPANDED_LIMIT,
    coverageStartedAt: coverage?.historyStartedAt ?? null,
  };
}
