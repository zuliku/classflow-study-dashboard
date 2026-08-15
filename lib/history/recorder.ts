/**
 * Learning History Recorder（Part 1）：
 * - serialized queue：保证 mutation 顺序写入；Reset 也在队列内，避免 async clear race
 * - History 失败 best effort：业务 mutation 已成功，History 失败不影响业务（dev warn / prod silent）
 * - 禁止全局 mutable source：source 只能通过显式 MutationContext
 */

import { Semester } from "@/types";
import {
  LearningHistoryEvent,
  LearningHistoryEventBase,
  LearningHistoryEventType,
  LearningHistorySource,
} from "@/lib/history/types";
import {
  computeSemesterWeek,
  localDateOf,
  timezoneOffsetMinutesOf,
} from "@/lib/history/time";
import { appendLearningHistoryEvents } from "@/lib/history/store";
import { createId } from "@/lib/utils";

export interface LearningMutationContext {
  source?: LearningHistorySource;
  occurredAt?: number;
}

export interface ResolvedLearningMutationContext {
  source: LearningHistorySource;
  occurredAt: number;
}

/** UI 默认 manual；Kiro/System/Import 由调用方显式传入 */
export function resolveLearningMutationContext(
  context?: LearningMutationContext
): ResolvedLearningMutationContext {
  return {
    source: context?.source ?? "manual",
    occurredAt: context?.occurredAt ?? Date.now(),
  };
}

export interface LearningEventEnvironment {
  semester: Semester;
}

export interface LearningEventBuildInput {
  type: LearningHistoryEventType;
  entityType: LearningHistoryEventBase["entityType"];
  entityId: string;
  data: unknown;
  context: ResolvedLearningMutationContext;
  environment: LearningEventEnvironment;
  courseId?: string;
  assignmentId?: string;
  courseNameSnapshot?: string;
  assignmentTitleSnapshot?: string;
}

let sequenceCounter = 0;

/**
 * 构造完整事件（含 base 快照：semester / week / localDate / timezone）。
 * 不要直接构造 base；统一走此入口保证字段一致。
 */
export function buildLearningHistoryEvent(
  input: LearningEventBuildInput
): LearningHistoryEvent {
  const { context, environment } = input;
  const semesterWeek = computeSemesterWeek(context.occurredAt, environment.semester);
  sequenceCounter += 1;
  return {
    id: createId("lh"),
    schemaVersion: 1,
    type: input.type,
    occurredAt: context.occurredAt,
    localDate: localDateOf(context.occurredAt),
    timezoneOffsetMinutes: timezoneOffsetMinutesOf(context.occurredAt),
    source: context.source,
    entityType: input.entityType,
    entityId: input.entityId,
    semesterId: environment.semester.id,
    semesterNameSnapshot: environment.semester.name,
    semesterWeek,
    courseId: input.courseId,
    assignmentId: input.assignmentId,
    courseNameSnapshot: input.courseNameSnapshot,
    assignmentTitleSnapshot: input.assignmentTitleSnapshot,
    sequence: sequenceCounter,
    data: input.data,
  } as LearningHistoryEvent;
}

let historyQueue: Promise<unknown> = Promise.resolve();

// ---------- Reactive Subscription（Analytics V2）----------
type LearningHistoryListener = () => void;

const listeners = new Set<LearningHistoryListener>();

/** 订阅 History 变更（append / reset 真正完成后通知）；返回取消函数。禁止 polling。 */
export function subscribeLearningHistoryChanges(listener: LearningHistoryListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyLearningHistoryChanged(): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn("[learning-history] listener failed", err);
      }
    }
  }
}

/**
 * 追加事件（best effort）：
 * - 按调用顺序串行写入（mutation 顺序稳定）
 * - 失败不抛给业务（dev console.warn / prod silent）
 * - 写入完成后通知订阅者（Analytics reactive refresh）
 */
export function enqueueLearningHistoryEvents(events: LearningHistoryEvent[]): void {
  if (events.length === 0) return;
  historyQueue = historyQueue.then(async () => {
    try {
      await appendLearningHistoryEvents(events);
      notifyLearningHistoryChanged();
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn("[learning-history] append failed", err);
      }
    }
  });
}

/**
 * 在队列中执行 Reset（清空 + 重建 coverage）。
 * 保证：Event A → Reset → Event B 最终只有 Event B（async clear 不竞态）。
 */
export function enqueueLearningHistoryReset(resetFn: () => Promise<void>): void {
  historyQueue = historyQueue.then(async () => {
    try {
      await resetFn();
      notifyLearningHistoryChanged();
    } catch (err) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn("[learning-history] reset failed", err);
      }
    }
  });
}

/** 供测试等待队列排空 */
export function flushLearningHistoryQueue(): Promise<unknown> {
  return historyQueue;
}
