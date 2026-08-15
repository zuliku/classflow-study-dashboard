/**
 * Study Rebalance Apply Domain（Analytics V2 · Part 5）。
 * Proposal → User Confirm 之后的 Atomic Move 安全层。纯函数 + Store Batch Action，无 React、无 AI。
 * - Move 只改 date/startTime/endTime；ID / assignment / course / title / duration / source 全不变
 * - Original fingerprint：Apply 前必须确认当前 block 仍完全等于 Proposal 的 from（用户手动拖动 → STALE）
 * - 双 preflight（dialog 前 + confirm 后，与 StudyPlan Apply 一致）
 * - All-or-None：任何 move 不合法 → 0 mutation
 * - Undo：必须确认当前状态 == Apply 后的 after fingerprint；否则 STALE（不覆盖用户后续修改）
 */

import { AppState } from "@/store/useAppStore";
import { StudyBlock } from "@/types";
import { parseLocalDDL } from "@/lib/ddl";
import { isScheduleActive, timeToMinutes } from "@/lib/schedule";
import { getSemesterWeek } from "@/lib/semester";

export interface RebalancePositionInput {
  date: string;
  startTime: string;
  endTime: string;
}

export interface RebalanceMoveInput {
  blockId: string;
  from: RebalancePositionInput;
  to: RebalancePositionInput;
}

export type StudyRebalanceFailureCode = "STALE_PROPOSAL" | "CONFLICT" | "INVALID_INPUT";

export interface StudyRebalanceFailure {
  ok: false;
  code: StudyRebalanceFailureCode;
  message: string;
  details?: { blockIndex?: number; reason?: string };
}

export type StudyRebalanceApplyResult =
  | { ok: true; before: StudyBlock[]; after: StudyBlock[] }
  | StudyRebalanceFailure;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;

function parseHM(time: string | undefined): number | null {
  if (!time) return null;
  const m = TIME_RE.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function overlaps(aS: number, aE: number, bS: number, bE: number): boolean {
  return aS < bE && bS < aE;
}

function fail(
  code: StudyRebalanceFailureCode,
  message: string,
  details?: { blockIndex?: number; reason?: string }
): StudyRebalanceFailure {
  return { ok: false, code, message, details };
}

function posKey(p: RebalancePositionInput): string {
  return `${p.date}|${p.startTime}|${p.endTime}`;
}

/** 课程/活动/受保护块 与 target 冲突检测（moved blockIds 的旧位置先释放） */
function occupancyConflict(
  state: AppState,
  blockId: string,
  target: RebalancePositionInput,
  excludedIds: Set<string>
): boolean {
  const s = parseHM(target.startTime);
  const e = parseHM(target.endTime);
  if (s === null || e === null) return true;
  const m = DATE_RE.exec(target.date);
  if (!m) return true;
  const targetDate = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const dow = targetDate.getDay() === 0 ? 7 : targetDate.getDay();
  const week = Math.min(
    Math.max(getSemesterWeek(targetDate, state.semester), 1),
    state.semester.totalWeeks
  );

  // 生效课程
  for (const sch of state.schedules) {
    if (sch.dayOfWeek !== dow) continue;
    if (!isScheduleActive(sch, week)) continue;
    const ss = parseHM(sch.startTime);
    const se = parseHM(sch.endTime);
    if (ss === null || se === null || se <= ss) continue;
    if (overlaps(s, e, ss, se)) return true;
  }
  // 固定考试/活动（all-day → 整天冲突；DDL/course mark 不算）
  for (const mark of state.calendarMarks) {
    if (mark.date !== target.date) continue;
    if (mark.type === "course" || mark.type === "ddl") continue;
    const ss = mark.startTime ? parseHM(mark.startTime) : null;
    const se = mark.endTime ? parseHM(mark.endTime) : null;
    if (ss !== null && se !== null && se > ss) {
      if (overlaps(s, e, ss, se)) return true;
    } else {
      return true;
    }
  }
  // 受保护 StudyBlock（非本次移动的 block；移动块旧位置已释放）
  for (const b of state.studyBlocks) {
    if (excludedIds.has(b.id)) continue;
    if (b.date !== target.date) continue;
    const bs = parseHM(b.startTime);
    const be = parseHM(b.endTime);
    if (bs === null || be === null) continue;
    if (overlaps(s, e, bs, be)) return true;
  }
  return false;
}

/** Fresh Preflight：所有 move 合法才 ok（All-or-None） */
export function preflightStudyRebalance(
  moves: RebalanceMoveInput[],
  state: AppState
): { ok: true } | StudyRebalanceFailure {
  if (moves.length === 0) return fail("INVALID_INPUT", "没有可应用的调整。");
  const excludedIds = new Set(moves.map((m) => m.blockId));
  if (excludedIds.size !== moves.length) {
    return fail("INVALID_INPUT", "调整建议包含重复的学习时段。");
  }
  const targets: RebalancePositionInput[] = [];

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    const block = state.studyBlocks.find((b) => b.id === move.blockId);
    if (!block) {
      return fail("STALE_PROPOSAL", "学习时段已不存在，无法应用调整。", { blockIndex: i, reason: "block_missing" });
    }
    // Identity：source=kiro + 当前位置 == from（fingerprint）
    if (block.source !== "kiro") {
      return fail("STALE_PROPOSAL", "该学习时段来源已变化，无法自动调整。", { blockIndex: i, reason: "not_kiro" });
    }
    if (posKey({ date: block.date, startTime: block.startTime, endTime: block.endTime }) !== posKey(move.from)) {
      return fail("STALE_PROPOSAL", "学习时段已被修改，调整建议已过期。", { blockIndex: i, reason: "fingerprint_mismatch" });
    }
    // Target 合法性
    const fromMin = parseHM(move.from.startTime);
    const fromEndMin = parseHM(move.from.endTime);
    const toMin = parseHM(move.to.startTime);
    const toEndMin = parseHM(move.to.endTime);
    if (!DATE_RE.test(move.to.date) || toMin === null || toEndMin === null) {
      return fail("INVALID_INPUT", "目标时间不合法。", { blockIndex: i, reason: "invalid_time" });
    }
    if (toEndMin <= toMin) {
      return fail("INVALID_INPUT", "目标时间段结束时间必须晚于开始时间。", { blockIndex: i, reason: "inverted" });
    }
    const duration = (fromEndMin ?? 0) - (fromMin ?? 0);
    if (toEndMin - toMin !== duration) {
      return fail("INVALID_INPUT", "调整不能改变学习时段时长。", { blockIndex: i, reason: "duration_changed" });
    }
    if (toMin < 8 * 60 || toEndMin > 21 * 60) {
      return fail("INVALID_INPUT", "学习时段必须位于 08:00–21:00。", { blockIndex: i, reason: "outside_window" });
    }
    // Assignment 仍 active + target end <= DDL
    const assignment = block.assignmentId
      ? state.assignments.find((a) => a.id === block.assignmentId)
      : undefined;
    if (!assignment) {
      return fail("STALE_PROPOSAL", "关联任务已不存在。", { blockIndex: i, reason: "assignment_missing" });
    }
    if (assignment.status === "completed" || assignment.status === "submitted") {
      return fail("STALE_PROPOSAL", "关联任务已完成，不再调整其学习时段。", { blockIndex: i, reason: "assignment_inactive" });
    }
    if (assignment.ddl) {
      const dl = parseLocalDDL(assignment.ddl);
      if (dl) {
        const m = DATE_RE.exec(move.to.date);
        const endMs = m
          ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Math.floor(toEndMin! / 60), toEndMin! % 60, 0, 0).getTime()
          : NaN;
        if (!Number.isNaN(endMs) && endMs > dl.getTime()) {
          return fail("STALE_PROPOSAL", "调整后仍晚于任务截止时间。", { blockIndex: i, reason: "after_deadline" });
        }
      }
    }
    // Occupancy：与课程/活动/受保护块/其它 target 冲突
    if (occupancyConflict(state, move.blockId, move.to, excludedIds)) {
      return fail("CONFLICT", "目标时间与课程、考试或已有学习计划冲突。", { blockIndex: i, reason: "occupancy" });
    }
    for (const t of targets) {
      const ts = parseHM(t.startTime)!;
      const te = parseHM(t.endTime)!;
      if (t.date === move.to.date && overlaps(toMin, toEndMin, ts, te)) {
        return fail("CONFLICT", "调整建议内的时间段互相重叠。", { blockIndex: i, reason: "move_overlap" });
      }
    }
    targets.push(move.to);
  }
  return { ok: true };
}

/** Atomic Apply（fresh preflight 后单次 batch update，source=kiro；ID 保持不变） */
export function applyStudyRebalance(
  moves: RebalanceMoveInput[],
  state: AppState
): StudyRebalanceApplyResult {
  const preflight = preflightStudyRebalance(moves, state);
  if (!preflight.ok) return preflight;
  const result = state.updateStudyBlocksBatch(
    moves.map((m) => ({ id: m.blockId, patch: m.to })),
    { source: "kiro" }
  );
  if (!result) {
    return fail("STALE_PROPOSAL", "学习时段已变化，调整未应用。");
  }
  return { ok: true, before: result.before, after: result.after };
}

/**
 * Undo（用户主动操作 → source=manual）：
 * 必须确认当前状态 == Apply 后的 after fingerprint；任何 block 已被后续修改 → STALE。
 */
export function undoStudyRebalance(
  moves: RebalanceMoveInput[],
  state: AppState
): StudyRebalanceApplyResult {
  for (const move of moves) {
    const block = state.studyBlocks.find((b) => b.id === move.blockId);
    if (!block) {
      return fail("STALE_PROPOSAL", "学习时段已不存在，无法撤销。");
    }
    if (
      posKey({ date: block.date, startTime: block.startTime, endTime: block.endTime }) !== posKey(move.to)
    ) {
      return fail("STALE_PROPOSAL", "学习计划之后又发生了变化，无法安全撤销本次调整。");
    }
  }
  const result = state.updateStudyBlocksBatch(
    moves.map((m) => ({ id: m.blockId, patch: m.from })),
    { source: "manual" }
  );
  if (!result) {
    return fail("STALE_PROPOSAL", "学习时段已变化，无法撤销。");
  }
  return { ok: true, before: result.before, after: result.after };
}

/** Proposal Fingerprint：blockId + from + to 稳定排序 */
export function createStudyRebalanceProposalKey(
  moves: RebalanceMoveInput[]
): string {
  return moves
    .map((m) => `${m.blockId}|${posKey(m.from)}|${posKey(m.to)}`)
    .sort()
    .join(";");
}
