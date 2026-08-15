/**
 * Kiro Learning History Read Tools（Part 2，Browser async executor）。
 * 只读：query_learning_history / summarize_learning_history。
 * History 是本地数据：IndexedDB 查询只在 Browser 执行；Server 只提供 schema/description。
 */

import { LearningHistoryEvent } from "@/lib/history/types";
import {
  LearningHistoryGroupBy,
  aggregateLearningHistory,
} from "@/lib/history/aggregate";
import { queryLearningHistory } from "@/lib/history/query";
import { ReadToolResult } from "@/lib/ai/tools/read/executor";

export interface LearningHistoryRawOutputItem {
  type: string;
  occurredAt: number;
  localDate: string;
  source: string;
  semesterWeek: number | null;
  courseId?: string;
  courseName?: string;
  assignmentId?: string;
  assignmentTitle?: string;
  data: unknown;
}

/** 输出 model-friendly：去除 schemaVersion/timezoneOffsetMinutes/internal id/IndexedDB keys */
export function toRawOutputItem(event: LearningHistoryEvent): LearningHistoryRawOutputItem {
  return {
    type: event.type,
    occurredAt: event.occurredAt,
    localDate: event.localDate,
    source: event.source,
    semesterWeek: event.semesterWeek,
    courseId: event.courseId,
    courseName: event.courseNameSnapshot,
    assignmentId: event.assignmentId,
    assignmentTitle: event.assignmentTitleSnapshot,
    data: event.data,
  };
}

export type KiroLearningHistoryOutput = "OUT_OF_RANGE" | "INVALID_INPUT" | "READ_FAILED";

function fail(code: KiroLearningHistoryOutput, message: string): ReadToolResult<unknown> {
  return { ok: false, code, message };
}

/** 本地墙钟 day 解析："YYYY-MM-DD" → 00:00:00（start）或 23:59:59.999（end） */
export function parseLocalDay(s: string, endOfDay: boolean): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  return endOfDay ? d.getTime() + 86_400_000 - 1 : d.getTime();
}

/** 默认 / 上限（毫秒） */
const QUERY_DEFAULT_RANGE_MS = 30 * 86_400_000;
const QUERY_HARD_RANGE_MS = 90 * 86_400_000;
const SUMMARY_DEFAULT_RANGE_MS = 28 * 86_400_000;
const SUMMARY_HARD_RANGE_MS = 366 * 86_400_000;
const RAW_RESULT_HARD_MAX = 200;

export async function executeQueryLearningHistory(input: unknown): Promise<ReadToolResult<unknown>> {
  const raw = input as {
    from?: string;
    to?: string;
    eventTypes?: string[];
    courseId?: string;
    assignmentId?: string;
    source?: string;
    limit?: number;
  } | null;
  if (!raw || typeof raw !== "object") {
    return fail("INVALID_INPUT", "输入不合法。");
  }
  const now = Date.now();
  const parsedTo = raw.to !== undefined ? parseLocalDay(raw.to, true) : now;
  if (parsedTo === null) return fail("INVALID_INPUT", "日期范围不合法（YYYY-MM-DD）。");
  const toMs = parsedTo;
  const parsedFrom = raw.from !== undefined ? parseLocalDay(raw.from, false) : toMs - QUERY_DEFAULT_RANGE_MS;
  if (parsedFrom === null || parsedFrom > toMs) {
    return fail("INVALID_INPUT", "日期范围不合法（YYYY-MM-DD）。");
  }
  const fromMs = parsedFrom;
  if (toMs - fromMs > QUERY_HARD_RANGE_MS) {
    return fail("OUT_OF_RANGE", "原始历史查询最多 90 天。长时间范围请使用 summarize_learning_history。");
  }
  const limit = Math.min(raw.limit ?? 100, RAW_RESULT_HARD_MAX);
  try {
    const events = await queryLearningHistory({
      from: fromMs,
      to: toMs,
      eventTypes: (raw.eventTypes as LearningHistoryEvent["type"][] | undefined)?.filter(
        (t): t is LearningHistoryEvent["type"] => typeof t === "string"
      ),
      courseId: raw.courseId,
      assignmentId: raw.assignmentId,
      source: raw.source as LearningHistoryEvent["source"],
      limit,
      order: "desc",
    });
    return { ok: true, data: { events: events.map(toRawOutputItem), limit } };
  } catch (err) {
    return fail("READ_FAILED", "历史查询失败。");
  }
}

export async function executeSummarizeLearningHistory(input: unknown): Promise<ReadToolResult<unknown>> {
  const raw = input as {
    from?: string;
    to?: string;
    courseId?: string;
    groupBy?: LearningHistoryGroupBy;
  } | null;
  if (!raw || typeof raw !== "object") {
    return fail("INVALID_INPUT", "输入不合法。");
  }
  const now = Date.now();
  const parsedTo = raw.to !== undefined ? parseLocalDay(raw.to, true) : now;
  if (parsedTo === null) return fail("INVALID_INPUT", "日期范围不合法（YYYY-MM-DD）。");
  const toMs = parsedTo;
  const parsedFrom = raw.from !== undefined ? parseLocalDay(raw.from, false) : toMs - SUMMARY_DEFAULT_RANGE_MS;
  if (parsedFrom === null || parsedFrom > toMs) {
    return fail("INVALID_INPUT", "日期范围不合法（YYYY-MM-DD）。");
  }
  const fromMs = parsedFrom;
  if (toMs - fromMs > SUMMARY_HARD_RANGE_MS) {
    return fail("OUT_OF_RANGE", "学习历史汇总最长支持 366 天。");
  }
  try {
    const summary = await aggregateLearningHistory({
      from: fromMs,
      to: toMs,
      courseId: raw.courseId,
      groupBy: raw.groupBy ?? "none",
    });
    return { ok: true, data: summary };
  } catch (err) {
    return fail("READ_FAILED", "历史汇总失败。");
  }
}
