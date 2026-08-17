/**
 * Task 2：Focus Session Domain（纯函数，不触碰 Zustand / UI / Kiro）。
 * 核心计时规则（底层一直保存毫秒，不逐次 round 成分钟）：
 * - plannedMs = plannedMinutes * 60_000
 * - running：elapsed = accumulatedActiveMs + max(0, now - activeStartedAt)
 * - paused：elapsed = accumulatedActiveMs
 * - remainingMs = max(0, plannedMs - elapsed)
 * - 自然 timer / recovered 完成：actualActiveMs clamp 到 plannedMs（callback 晚执行不产生 30分20秒）
 * - manual 提前结束：actualActiveMs = 真正 active 时间（不把暂停时间计入）
 */

import { FocusSession, FocusSessionEndReason, FocusSessionStatus } from "@/types";

export type FocusErrorCode =
  | "FOCUS_SESSION_ALREADY_ACTIVE"
  | "NO_ACTIVE_FOCUS_SESSION"
  | "FOCUS_ALREADY_PAUSED"
  | "FOCUS_NOT_PAUSED"
  | "INVALID_FOCUS_DURATION"
  | "FOCUS_TARGET_NOT_FOUND"
  | "FOCUS_TARGET_MISMATCH";

export type FocusMutationResult =
  | { ok: true; session: FocusSession }
  | { ok: false; code: FocusErrorCode };

export const FOCUS_MIN_PLANNED_MINUTES = 1;
export const FOCUS_MAX_PLANNED_MINUTES = 240;

const STATUSES: FocusSessionStatus[] = ["running", "paused", "completed"];

/** 归一（persist hydrate / backup restore 共用）；非法 → null（不猜值） */
export function normalizeFocusSession(value: unknown): FocusSession | null {
  const s = (value ?? {}) as Record<string, unknown>;
  if (typeof s.id !== "string" || s.id.length === 0) return null;
  if (typeof s.plannedMinutes !== "number" || !Number.isInteger(s.plannedMinutes)) return null;
  if (s.plannedMinutes < FOCUS_MIN_PLANNED_MINUTES || s.plannedMinutes > FOCUS_MAX_PLANNED_MINUTES) return null;
  if (!STATUSES.includes(s.status as FocusSessionStatus)) return null;
  if (typeof s.startedAt !== "number" || !Number.isFinite(s.startedAt)) return null;
  if (typeof s.accumulatedActiveMs !== "number" || !Number.isFinite(s.accumulatedActiveMs)) return null;
  return {
    id: s.id,
    plannedMinutes: s.plannedMinutes,
    startedAt: s.startedAt,
    activeStartedAt: typeof s.activeStartedAt === "number" ? s.activeStartedAt : undefined,
    accumulatedActiveMs: s.accumulatedActiveMs,
    status: s.status as FocusSessionStatus,
    endedAt: typeof s.endedAt === "number" ? s.endedAt : undefined,
    endReason: ["timer", "manual", "recovered"].includes(s.endReason as string)
      ? (s.endReason as FocusSessionEndReason)
      : undefined,
    actualActiveMs: typeof s.actualActiveMs === "number" ? s.actualActiveMs : undefined,
    assignmentId: typeof s.assignmentId === "string" && s.assignmentId ? s.assignmentId : undefined,
    courseId: typeof s.courseId === "string" && s.courseId ? s.courseId : undefined,
    assignmentTitleSnapshot:
      typeof s.assignmentTitleSnapshot === "string" && s.assignmentTitleSnapshot
        ? s.assignmentTitleSnapshot
        : undefined,
    courseNameSnapshot:
      typeof s.courseNameSnapshot === "string" && s.courseNameSnapshot ? s.courseNameSnapshot : undefined,
    note: typeof s.note === "string" && s.note ? s.note : undefined,
    source: s.source === "kiro" ? "kiro" : "manual",
    createdAt: typeof s.createdAt === "number" ? s.createdAt : s.startedAt,
    updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : s.startedAt,
  };
}

export interface FocusClock {
  elapsedMs: number;
  remainingMs: number;
  plannedMs: number;
}

/** 当前计时钟（running 按 activeStartedAt 实时推导；paused 冻结在 accumulated） */
export function deriveFocusClock(session: FocusSession, now: number): FocusClock {
  const plannedMs = session.plannedMinutes * 60_000;
  const extra =
    session.status === "running" && session.activeStartedAt !== undefined
      ? Math.max(0, now - session.activeStartedAt)
      : 0;
  const elapsedMs = session.accumulatedActiveMs + extra;
  return { elapsedMs, remainingMs: Math.max(0, plannedMs - elapsedMs), plannedMs };
}

/** pause：冻结当前 active 段；已 paused → 返回原样（不重复冻结） */
export function pauseFocusSessionRecord(session: FocusSession, now: number): FocusSession {
  if (session.status !== "running" || session.activeStartedAt === undefined) return session;
  const extra = Math.max(0, now - session.activeStartedAt);
  return {
    ...session,
    accumulatedActiveMs: session.accumulatedActiveMs + extra,
    activeStartedAt: undefined,
    status: "paused",
    updatedAt: now,
  };
}

/** resume：从 paused 恢复 running，重新记录 activeStartedAt；非 paused → 原样 */
export function resumeFocusSessionRecord(session: FocusSession, now: number): FocusSession {
  if (session.status !== "paused") return session;
  return {
    ...session,
    activeStartedAt: now,
    status: "running",
    updatedAt: now,
  };
}

function activeElapsedMs(session: FocusSession, now: number): number {
  const extra =
    session.activeStartedAt !== undefined ? Math.max(0, now - session.activeStartedAt) : 0;
  return session.accumulatedActiveMs + extra;
}

/** 结束（manual）：actualActiveMs = 真正 active 时间（暂停不计入） */
export function finishFocusSessionRecord(session: FocusSession, now: number): FocusSession {
  return {
    ...session,
    activeStartedAt: undefined,
    accumulatedActiveMs: activeElapsedMs(session, now),
    status: "completed",
    endedAt: now,
    endReason: "manual",
    actualActiveMs: activeElapsedMs(session, now),
    updatedAt: now,
  };
}

/** 完成（timer / recovered 自然结束）：actualActiveMs clamp 到 plannedMs（callback 晚执行不超时） */
export function completeFocusSessionRecord(
  session: FocusSession,
  reason: Exclude<FocusSessionEndReason, "manual">,
  now: number
): FocusSession {
  const plannedMs = session.plannedMinutes * 60_000;
  const active = Math.min(activeElapsedMs(session, now), plannedMs);
  return {
    ...session,
    activeStartedAt: undefined,
    accumulatedActiveMs: active,
    status: "completed",
    endedAt: now,
    endReason: reason,
    actualActiveMs: active,
    updatedAt: now,
  };
}

/** 已完成的真实 active 毫秒精确累计（不 round 分钟） */
export function sumCompletedFocusMs(sessions: FocusSession[]): number {
  return sessions.reduce(
    (sum, s) => (s.status === "completed" && s.actualActiveMs !== undefined ? sum + s.actualActiveMs : sum),
    0
  );
}
