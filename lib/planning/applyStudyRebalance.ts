/**
 * Study Rebalance Apply Domain（Analytics V2 · Part 5 / Task 6）。
 * Proposal → User Confirm 之后的 Atomic Move 安全层。纯函数 + Store Batch Action，无 React、无 AI。
 * - Move 只改 date/startTime/endTime；ID / assignment / course / title / duration / source 全不变
 * - Original fingerprint：Apply 前必须确认当前 block 仍完全等于 Proposal 的 from（用户手动拖动 → STALE）
 * - 双 preflight（dialog 前 + confirm 后，与 StudyPlan Apply 一致）
 * - All-or-None：任何 move 不合法 → 0 mutation
 * - Task 6：Course overlap = SOFT —— preflight 收集 courseOverlaps 而不失败；
 *   真正写入需显式 allowCourseOverlap（Kiro UI 先过 batch approval gate）
 * - Undo：必须确认当前状态 == Apply 后的 after fingerprint；否则 STALE（不覆盖用户后续修改）。
 *   Undo 回原位置不要求课程重叠确认（用户已明确点击 Undo；from 可能本身是课程重叠位）
 */

import { AppState } from "@/store/useAppStore";
import { StudyBlock } from "@/types";
import { parseLocalDDL } from "@/lib/ddl";
import { timeToMinutes } from "@/lib/schedule";
import { findCourseOverlapsForStudyBlock } from "@/lib/planning/courseOverlapPolicy";

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

/** 单个 move target 与课程的软重叠信息（Kiro Approval Gate 展示用；V1.1 含 Schedule 版本标识） */
export interface RebalanceCourseOverlapInfo {
  moveIndex: number;
  blockId: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  scheduleId: string;
  courseId: string;
  scheduleFingerprint: string;
  courseName: string;
}

export type StudyRebalanceFailureCode = "STALE_PROPOSAL" | "CONFLICT" | "INVALID_INPUT";

export interface StudyRebalanceFailure {
  ok: false;
  code: StudyRebalanceFailureCode;
  message: string;
  details?: { blockIndex?: number; reason?: string };
}

export type StudyRebalancePreflightResult =
  | { ok: true; courseOverlaps: RebalanceCourseOverlapInfo[] }
  | StudyRebalanceFailure;

/** Apply 前每个被移动 Block 的 Approval 快照（Undo 精确恢复用） */
export type StudyRebalanceApprovalSnapshot = Record<
  string,
  import("@/lib/planning/courseOverlapPolicy").StudyBlockCourseOverlapApproval[] | undefined
>;

export type StudyRebalanceApplyResult =
  | {
      ok: true;
      state: "applied";
      before: StudyBlock[];
      after: StudyBlock[];
      /** blockId → 原 Approval（Undo 恢复用；V1.1） */
      originalApprovals: StudyRebalanceApprovalSnapshot;
      /** blockId → Apply 后写入的 Approval（Undo stale 校验用；V1.1） */
      afterApprovals: StudyRebalanceApprovalSnapshot;
    }
  | { ok: true; state: "needs-approval"; courseOverlaps: RebalanceCourseOverlapInfo[] }
  | StudyRebalanceFailure;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
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

/** Hard occupancy（StudyBlock / Exam / Activity / move 之间互相重叠；课程不在其中） */
function hardOccupancyConflict(
  state: AppState,
  target: RebalancePositionInput,
  excludedIds: Set<string>
): boolean {
  const s = parseHM(target.startTime);
  const e = parseHM(target.endTime);
  if (s === null || e === null) return true;

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

/** Soft occupancy：与当前教学周生效课程的 overlap（收集信息，不构成失败；V1.1 带 scheduleId/fingerprint） */
function collectCourseOverlaps(
  state: AppState,
  moveIndex: number,
  block: StudyBlock,
  target: RebalancePositionInput
): RebalanceCourseOverlapInfo[] {
  return findCourseOverlapsForStudyBlock({
    block: target,
    schedules: state.schedules,
    semester: state.semester,
  }).map((o) => ({
    moveIndex,
    blockId: block.id,
    title: block.title,
    date: target.date,
    startTime: target.startTime,
    endTime: target.endTime,
    scheduleId: o.scheduleId,
    courseId: o.courseId,
    scheduleFingerprint: o.scheduleFingerprint,
    courseName: state.courses.find((c) => c.id === o.courseId)?.name ?? "未知课程",
  }));
}

/** Fresh Preflight：所有 move 硬合法才 ok；课程重叠收集为 courseOverlaps（soft，All-or-None） */
export function preflightStudyRebalance(
  moves: RebalanceMoveInput[],
  state: AppState
): StudyRebalancePreflightResult {
  if (moves.length === 0) return fail("INVALID_INPUT", "没有可应用的调整。");
  const excludedIds = new Set(moves.map((m) => m.blockId));
  if (excludedIds.size !== moves.length) {
    return fail("INVALID_INPUT", "调整建议包含重复的学习时段。");
  }
  const targets: RebalancePositionInput[] = [];
  const courseOverlaps: RebalanceCourseOverlapInfo[] = [];

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
    // Hard occupancy：StudyBlock / Exam / Activity；课程重叠收集为 soft
    if (hardOccupancyConflict(state, move.to, excludedIds)) {
      return fail("CONFLICT", "目标时间与考试、活动或已有学习计划冲突。", { blockIndex: i, reason: "occupancy" });
    }
    courseOverlaps.push(...collectCourseOverlaps(state, i, block, move.to));
    for (const t of targets) {
      const ts = parseHM(t.startTime)!;
      const te = parseHM(t.endTime)!;
      if (t.date === move.to.date && overlaps(toMin, toEndMin, ts, te)) {
        return fail("CONFLICT", "调整建议内的时间段互相重叠。", { blockIndex: i, reason: "move_overlap" });
      }
    }
    targets.push(move.to);
  }
  return { ok: true, courseOverlaps };
}

/**
 * Atomic Apply（fresh preflight 后单次 batch update，source=kiro；ID 保持不变）。
 * Task 6 Approval Gate：存在课程重叠且未显式 allowCourseOverlap → 0 mutation，
 * 返回 state="needs-approval"（Kiro UI 展示确认 Dialog）；确认后整批一次写入。
 * V1.1：批准后 target 允许课程重叠 → 该 Block 保存 courseOverlapApprovals（fresh preflight 数据）；
 * 原 Approval 快照返回给 UI，供 Undo 精确恢复。
 */
export function applyStudyRebalance(
  moves: RebalanceMoveInput[],
  state: AppState,
  options?: { allowCourseOverlap?: boolean; /** test/internal only */ now?: number }
): StudyRebalanceApplyResult {
  const preflight = preflightStudyRebalance(moves, state);
  if (!preflight.ok) return preflight;

  if (preflight.courseOverlaps.length > 0 && options?.allowCourseOverlap !== true) {
    return { ok: true, state: "needs-approval", courseOverlaps: preflight.courseOverlaps };
  }

  const originalApprovals: StudyRebalanceApprovalSnapshot = {};
  for (const m of moves) {
    originalApprovals[m.blockId] = state.studyBlocks.find((b) => b.id === m.blockId)
      ?.courseOverlapApprovals;
  }
  const approvedAt = options?.now ?? Date.now();
  // 只有真正 overlap 的 move target 保存 Approval（fresh preflight；Multi-overlap 全部保存）
  const approvalsByMove = new Map<number, import("@/lib/planning/courseOverlapPolicy").StudyBlockCourseOverlapApproval[]>();
  for (const o of preflight.courseOverlaps) {
    const list = approvalsByMove.get(o.moveIndex) ?? [];
    list.push({ scheduleId: o.scheduleId, scheduleFingerprint: o.scheduleFingerprint, approvedAt });
    approvalsByMove.set(o.moveIndex, list);
  }

  const result = state.updateStudyBlocksBatch(
    moves.map((m, i) => ({
      id: m.blockId,
      patch: {
        ...m.to,
        // 无重叠 target → 显式清空（V1.1 §38）；有批准 → 显式写入
        courseOverlapApprovals: approvalsByMove.has(i) ? approvalsByMove.get(i) : null,
      },
    })),
    { source: "kiro" }
  );
  if (!result) {
    return fail("STALE_PROPOSAL", "学习时段已变化，调整未应用。");
  }
  // Apply 后实际写入的 Approval（Undo stale 校验基准：从 result.after 读取真实状态；无重叠 = 清空）
  const afterApprovals: StudyRebalanceApprovalSnapshot = {};
  for (const b of result.after) {
    afterApprovals[b.id] = b.courseOverlapApprovals;
  }
  return { ok: true, state: "applied", before: result.before, after: result.after, originalApprovals, afterApprovals };
}

/**
 * Undo（用户主动操作 → source=manual）：
 * 必须确认当前状态 == Apply 后的 after fingerprint（时间 + Approval 都未再被修改）；任何变化 → STALE。
 * 成功后：恢复原时间 + 原 courseOverlapApprovals（V1.1 §39/40）。
 */
export function undoStudyRebalance(
  moves: RebalanceMoveInput[],
  state: AppState,
  options?: {
    originalApprovals?: StudyRebalanceApprovalSnapshot;
    /** Apply 后的 Approval 状态（缺省 = 已清空） */
    afterApprovals?: StudyRebalanceApprovalSnapshot;
  }
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
    // V1.1：Undo 前必须确认当前 Approval == Apply 后的状态；若用户之后改了 constraint intent → Undo 不得覆盖
    const appliedApprovals = options?.afterApprovals?.[move.blockId];
    const appliedApprovalsKey = appliedApprovals ? JSON.stringify(appliedApprovals) : "";
    const currentApprovalsKey = block.courseOverlapApprovals ? JSON.stringify(block.courseOverlapApprovals) : "";
    if (currentApprovalsKey !== appliedApprovalsKey) {
      return fail("STALE_PROPOSAL", "学习计划的课程重叠确认已变化，无法安全撤销本次调整。");
    }
  }
  const result = state.updateStudyBlocksBatch(
    moves.map((m) => ({
      id: m.blockId,
      patch: {
        ...m.from,
        courseOverlapApprovals: options?.originalApprovals?.[m.blockId] ?? null,
      },
    })),
    { source: "manual" }
  );
  if (!result) {
    return fail("STALE_PROPOSAL", "学习时段已变化，无法撤销。");
  }
  const afterApprovals: StudyRebalanceApprovalSnapshot = {};
  for (const b of result.after) {
    afterApprovals[b.id] = b.courseOverlapApprovals;
  }
  return {
    ok: true,
    state: "applied",
    before: result.before,
    after: result.after,
    originalApprovals: options?.originalApprovals ?? {},
    afterApprovals,
  };
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
