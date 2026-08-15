/**
 * Learning History Query Engine（Part 2）。
 * 消费 Part 1 的 IndexedDB events；Kiro / Analytics 共用同一 deterministic engine。
 * 策略：选择最具限制性的 index → cursor → 内存应用剩余 filters → 稳定排序（occurredAt, sequence）→ limit。
 */

import {
  LearningHistoryEntityType,
  LearningHistoryEvent,
  LearningHistoryEventType,
  LearningHistorySource,
} from "@/lib/history/types";
import { openLearningHistoryDB } from "@/lib/history/store";

export interface LearningHistoryQuery {
  /** epoch ms（含） */
  from?: number;
  /** epoch ms（含） */
  to?: number;
  eventTypes?: LearningHistoryEventType[];
  semesterId?: string;
  courseId?: string;
  assignmentId?: string;
  entityType?: LearningHistoryEntityType;
  source?: LearningHistorySource;
  /** 默认 100；Core 层不设 hard max（Kiro tool 层 clamp 200） */
  limit?: number;
  order?: "asc" | "desc";
}

export interface ResolvedLearningHistoryQuery extends Required<Pick<LearningHistoryQuery, "limit" | "order">> {
  from?: number;
  to?: number;
  eventTypes?: LearningHistoryEventType[];
  semesterId?: string;
  courseId?: string;
  assignmentId?: string;
  entityType?: LearningHistoryEntityType;
  source?: LearningHistorySource;
}

export function resolveLearningHistoryQuery(query: LearningHistoryQuery): ResolvedLearningHistoryQuery {
  return {
    ...query,
    limit: query.limit ?? 100,
    order: query.order ?? "desc",
  };
}

function matchesFilters(event: LearningHistoryEvent, q: ResolvedLearningHistoryQuery): boolean {
  if (q.from !== undefined && event.occurredAt < q.from) return false;
  if (q.to !== undefined && event.occurredAt > q.to) return false;
  if (q.eventTypes && q.eventTypes.length > 0 && !q.eventTypes.includes(event.type)) return false;
  if (q.semesterId !== undefined && event.semesterId !== q.semesterId) return false;
  if (q.courseId !== undefined && event.courseId !== q.courseId) return false;
  if (q.assignmentId !== undefined && event.assignmentId !== q.assignmentId) return false;
  if (q.entityType !== undefined && event.entityType !== q.entityType) return false;
  if (q.source !== undefined && event.source !== q.source) return false;
  return true;
}

/**
 * 收集满足 filter 的全部事件（无 limit；aggregate 与 query 共用）。
 * 选择最佳 index：assignmentId / courseId / semesterId / entityType / 单 type / 时间范围。
 */
export async function collectLearningHistoryEvents(
  q: ResolvedLearningHistoryQuery
): Promise<LearningHistoryEvent[]> {
  const db = await openLearningHistoryDB();
  const tx = db.transaction("events", "readonly");
  const store = tx.objectStore("events");
  const out: LearningHistoryEvent[] = [];

  // 优先精确实体 index（最具限制性）
  if (q.assignmentId !== undefined) {
    const req = store.index("assignmentId").getAll(q.assignmentId);
    await new Promise<void>((resolve, reject) => {
      req.onsuccess = () => {
        for (const e of (req.result as LearningHistoryEvent[] | undefined) ?? []) {
          if (matchesFilters(e, q)) out.push(e);
        }
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    return out;
  }
  if (q.courseId !== undefined) {
    const req = store.index("courseId").getAll(q.courseId);
    await new Promise<void>((resolve, reject) => {
      req.onsuccess = () => {
        for (const e of (req.result as LearningHistoryEvent[] | undefined) ?? []) {
          if (matchesFilters(e, q)) out.push(e);
        }
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    return out;
  }
  if (q.semesterId !== undefined) {
    const req = store.index("semesterId").getAll(q.semesterId);
    await new Promise<void>((resolve, reject) => {
      req.onsuccess = () => {
        for (const e of (req.result as LearningHistoryEvent[] | undefined) ?? []) {
          if (matchesFilters(e, q)) out.push(e);
        }
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    return out;
  }
  if (q.entityType !== undefined) {
    const req = store.index("entityType").getAll(q.entityType);
    await new Promise<void>((resolve, reject) => {
      req.onsuccess = () => {
        for (const e of (req.result as LearningHistoryEvent[] | undefined) ?? []) {
          if (matchesFilters(e, q)) out.push(e);
        }
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    return out;
  }
  if (q.eventTypes && q.eventTypes.length === 1) {
    const req = store.index("type").getAll(q.eventTypes[0]);
    await new Promise<void>((resolve, reject) => {
      req.onsuccess = () => {
        for (const e of (req.result as LearningHistoryEvent[] | undefined) ?? []) {
          if (matchesFilters(e, q)) out.push(e);
        }
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    return out;
  }

  // 时间范围 → occurredAt index cursor（避免 getAll entire DB）
  const range = q.from !== undefined || q.to !== undefined
    ? IDBKeyRange.bound(q.from ?? -Infinity, q.to ?? Infinity)
    : null;
  const index = store.index("occurredAt");
  const cursorReq = range ? index.openCursor(range) : index.openCursor();
  await new Promise<void>((resolve, reject) => {
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        const e = cursor.value as LearningHistoryEvent;
        if (matchesFilters(e, q)) out.push(e);
        cursor.continue();
      } else {
        resolve();
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
  return out;
}

/** 稳定排序：occurredAt → sequence（同一 mutation 的多事件保序） */
export function sortLearningHistoryEvents(
  events: LearningHistoryEvent[],
  order: "asc" | "desc"
): LearningHistoryEvent[] {
  return events.slice().sort((a, b) => {
    if (a.occurredAt !== b.occurredAt) {
      return order === "desc" ? b.occurredAt - a.occurredAt : a.occurredAt - b.occurredAt;
    }
    return order === "desc" ? b.sequence - a.sequence : a.sequence - b.sequence;
  });
}

/** Core Query：collect + stable sort + limit */
export async function queryLearningHistory(query: LearningHistoryQuery): Promise<LearningHistoryEvent[]> {
  const resolved = resolveLearningHistoryQuery(query);
  const events = await collectLearningHistoryEvents(resolved);
  const sorted = sortLearningHistoryEvents(events, resolved.order);
  return sorted.slice(0, resolved.limit);
}
