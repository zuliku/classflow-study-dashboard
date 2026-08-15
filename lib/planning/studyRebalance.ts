/**
 * Adaptive Study Rebalance Engine（Analytics V2 · Part 5 / Task 6）。
 * Move-only：只移动已有 source=kiro 的 StudyBlock（assignmentId/courseId/title/duration/source/id 全不变，
 * 只改 date/startTime/endTime）；绝不删除/新增/拆分/合并 Block，绝不移动 manual 计划。
 *
 * Task 6：Course overlap = SOFT（合法存在，不自动"修复"）——
 * - course_conflict 不再是 hard issue：已有课程重叠的 block 不会仅因此被搬走（可能来自人工拖放或已确认的 Kiro 写入）
 * - target 选择两阶段：Pass 1 仅非课程时间（preferred）；Pass 2 只有 Pass 1 无解时才允许课程重叠（fallback）
 * - hard issues 只剩 after_deadline / fixed_event_conflict；capacity_relief 不变
 * - capacity_relief 必须经 canonical allocateStudyCapacity 模拟验证：shortfallAfter < shortfallBefore 才允许
 * - Minimal churn：接受一个 move 后立即更新 simulated state 并重新评估，满足目标即停止
 * - Deterministic greedy；不做全局优化求解
 * - 纯函数：无 Zustand / 无 IndexedDB / 无 AI / 无 Store mutation
 */

import { Assignment, CalendarMark, CourseSchedule, Semester, StudyBlock } from "@/types";
import { parseLocalDDL } from "@/lib/ddl";
import { findFreeTime, FreeTimeSlot } from "@/lib/planning/freeTime";
import { allocateStudyCapacity } from "@/lib/planning/capacityAllocation";
import { isScheduleActive } from "@/lib/schedule";
import { getSemesterWeek } from "@/lib/semester";
import { timeToMinutes } from "@/lib/timeline/timelineGeometry";
import { StudyOutlookHorizon } from "@/lib/outlook/types";
import { findUnapprovedCourseOverlaps } from "@/lib/planning/courseOverlapPolicy";

export type StudyRebalanceReason =
  | "after_deadline"
  | "course_conflict"
  | "fixed_event_conflict"
  | "capacity_relief";

export interface StudyRebalancePosition {
  date: string; // "YYYY-MM-DD"
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
}

export interface StudyRebalanceMove {
  blockId: string;
  assignmentId: string;
  title: string;
  courseId?: string;
  minutes: number;
  reason: StudyRebalanceReason;
  from: StudyRebalancePosition;
  to: StudyRebalancePosition;
}

export interface StudyRebalanceProposal {
  horizonDays: StudyOutlookHorizon;
  moves: StudyRebalanceMove[];
  summary: {
    movedBlocks: number;
    movedMinutes: number;
    hardIssuesResolved: number;
    shortfallBefore: number;
    shortfallAfter: number;
    releasedEarlyCapacityMinutes: number;
  };
  /** 未解决 / 说明性 reasons（unresolved_after_deadline / unresolved_conflict / manual_protected 等） */
  reasons: string[];
}

export interface StudyRebalanceInput {
  assignments: Assignment[];
  studyBlocks: StudyBlock[];
  schedules: CourseSchedule[];
  calendarMarks: CalendarMark[];
  semester: Semester;
  currentSemesterWeek: number;
  horizonDays: StudyOutlookHorizon;
  now: Date;
}

const HARD_REASON_RANK: Record<StudyRebalanceReason, number> = {
  after_deadline: 0,
  course_conflict: 1,
  fixed_event_conflict: 2,
  capacity_relief: 3,
};

const pad2 = (n: number) => String(n).padStart(2, "0");

function dateStrOf(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function positionOf(b: StudyBlock): StudyRebalancePosition {
  return { date: b.date, startTime: b.startTime, endTime: b.endTime };
}

function blockMinutes(b: { startTime: string; endTime: string }): number {
  const s = timeToMinutes(b.startTime);
  const e = timeToMinutes(b.endTime);
  return s !== null && e !== null && e > s ? e - s : 0;
}

function posStartMs(p: StudyRebalancePosition): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.date);
  if (!m) return NaN;
  const [h, min] = p.startTime.split(":").map(Number);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, min, 0, 0).getTime();
}

function posEndMs(p: StudyRebalancePosition): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.date);
  if (!m) return NaN;
  const [h, min] = p.endTime.split(":").map(Number);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, min, 0, 0).getTime();
}

function overlap(
  aS: number,
  aE: number,
  bS: number,
  bE: number
): boolean {
  return aS < bE && bS < aE;
}

function blockOverlapsTimeRange(
  block: { date: string; startTime: string; endTime: string },
  date: string,
  startMinutes: number,
  endMinutes: number
): boolean {
  if (block.date !== date) return false;
  const s = timeToMinutes(block.startTime);
  const e = timeToMinutes(block.endTime);
  if (s === null || e === null) return false;
  return overlap(s, e, startMinutes, endMinutes);
}

/**
 * Position 是否与当前教学周生效课程重叠（soft condition，仅用于 preference / fallback 过滤；
 * 不构成 hard issue。周次按 position 自身日期计算，与 Apply preflight 一致）。
 */
function positionHasCourseOverlap(
  pos: StudyRebalancePosition,
  schedules: CourseSchedule[],
  semester: Semester
): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(pos.date);
  if (!m) return false;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const dow = date.getDay() === 0 ? 7 : date.getDay();
  const week = Math.min(Math.max(getSemesterWeek(date, semester), 1), semester.totalWeeks);
  const s = timeToMinutes(pos.startTime);
  const e = timeToMinutes(pos.endTime);
  if (s === null || e === null) return false;
  return schedules.some((sch) => {
    if (sch.dayOfWeek !== dow) return false;
    if (!isScheduleActive(sch, week)) return false;
    const ss = timeToMinutes(sch.startTime);
    const se = timeToMinutes(sch.endTime);
    if (ss === null || se === null || se <= ss) return false;
    return overlap(s, e, ss, se);
  });
}

/** Block 是否与固定考试/活动冲突（带时间 overlap；all-day 视为整天冲突；DDL/course mark 不算） */
function fixedEventConflict(block: StudyBlock, calendarMarks: CalendarMark[]): boolean {
  return calendarMarks.some((m) => {
    if (m.date !== block.date) return false;
    if (m.type === "course" || m.type === "ddl") return false;
    const ss = m.startTime ? timeToMinutes(m.startTime) : null;
    const se = m.endTime ? timeToMinutes(m.endTime) : null;
    if (ss !== null && se !== null && se > ss) {
      return blockOverlapsTimeRange(block, m.date, ss, se);
    }
    return true; // all-day exam/activity → 整天 blocked
  });
}

/** Block end > Assignment DDL → after_deadline（有 DDL 才判定） */
function afterDeadline(block: StudyBlock, assignment: Assignment | undefined): boolean {
  if (!assignment || !assignment.ddl) return false;
  const dl = parseLocalDDL(assignment.ddl);
  if (!dl) return false;
  const endMs = posEndMs(positionOf(block));
  return !Number.isNaN(endMs) && endMs > dl.getTime();
}

function ddlMsOf(assignment: Assignment | undefined): number | null {
  if (!assignment || !assignment.ddl) return null;
  const dl = parseLocalDDL(assignment.ddl);
  return dl ? dl.getTime() : null;
}

interface SimulatedBlock extends StudyRebalancePosition {
  blockId: string;
}

/** 用 canonical Capacity Allocator 计算 portfolio shortfall（与 Outlook 同口径） */
function computeShortfall(
  input: StudyRebalanceInput,
  blocks: StudyBlock[],
  horizonEnd: Date
): number {
  const freeSlots = findFreeTime({
    start: input.now,
    now: input.now,
    end: horizonEnd,
    semester: input.semester,
    currentSemesterWeek: input.currentSemesterWeek,
    schedules: input.schedules,
    calendarMarks: input.calendarMarks,
    studyBlocks: blocks,
  });
  const allocation = allocateStudyCapacity({
    assignments: input.assignments,
    studyBlocks: blocks,
    freeSlots,
    fromDate: dateStrOf(input.now),
    toDate: dateStrOf(horizonEnd),
    now: input.now,
  });
  return allocation.totalShortfallMinutes;
}

/** 首个 cumulative shortfall 的 deadline（capacity_relief 需把 block 移到它之后）；无缺口 → null */
function firstShortfallDeadline(
  input: StudyRebalanceInput,
  blocks: StudyBlock[],
  horizonEnd: Date
): { deadlineMs: number; deadline: string } | null {
  const freeSlots = findFreeTime({
    start: input.now,
    now: input.now,
    end: horizonEnd,
    semester: input.semester,
    currentSemesterWeek: input.currentSemesterWeek,
    schedules: input.schedules,
    calendarMarks: input.calendarMarks,
    studyBlocks: blocks,
  });
  const allocation = allocateStudyCapacity({
    assignments: input.assignments,
    studyBlocks: blocks,
    freeSlots,
    fromDate: dateStrOf(input.now),
    toDate: dateStrOf(horizonEnd),
    now: input.now,
  });
  const eligible = allocation.tasks.filter((t) => t.classification === "eligible" && t.deadline);
  const deadlines = Array.from(new Set(eligible.map((t) => t.deadline!))).sort((a, b) => a.localeCompare(b));
  let cumulative = 0;
  for (const dl of deadlines) {
    const due = eligible.filter((t) => t.deadline! <= dl);
    const required = due.reduce((s, t) => s + t.remainingRequiredMinutes, 0);
    const allocated = due.reduce((s, t) => s + t.allocatedMinutes, 0);
    cumulative = Math.max(required - allocated, 0);
    if (cumulative > 0) {
      const d = parseLocalDDL(dl);
      return d ? { deadlineMs: d.getTime(), deadline: dl } : null;
    }
  }
  return null;
}

/**
 * 为目标 duration 寻找最优放置（deterministic preference）：
 * 1. 最小日期距离  2. 同日优先  3. 时间差最小  4. 更早时间优先  5. stable (date,start)
 * 候选在 slot 内按 30min 网格滑动（完整容纳 duration），保证"靠近原时间"可被选中。
 * positionFilter（可选）：只接受满足额外条件的候选（如 Pass 2 仅接受课程重叠位置）。
 */
function findBestPlacement(
  slots: FreeTimeSlot[],
  durationMinutes: number,
  original: StudyRebalancePosition,
  constraints: { endBeforeMs: number | null; startAfterMs: number | null },
  positionFilter?: (pos: StudyRebalancePosition) => boolean
): StudyRebalancePosition | null {
  const GRID = 30;
  const candidates: { pos: StudyRebalancePosition; dateDistance: number; timeDiff: number }[] = [];
  for (const slot of slots) {
    const slotMin = slotMinutesOf(slot);
    if (slotMin < durationMinutes) continue;
    const slotStart = timeToMinutes(slot.startTime) ?? 0;
    const slotEnd = timeToMinutes(slot.endTime) ?? 0;
    for (let start = slotStart; start + durationMinutes <= slotEnd; start += GRID) {
      const pos: StudyRebalancePosition = {
        date: slot.date,
        startTime: minutesToHM(start),
        endTime: minutesToHM(start + durationMinutes),
      };
      if (positionFilter && !positionFilter(pos)) continue;
      const endMs = posEndMs(pos);
      const startMs = posStartMs(pos);
      if (constraints.endBeforeMs !== null && !Number.isNaN(endMs) && endMs > constraints.endBeforeMs) continue;
      if (constraints.startAfterMs !== null && !Number.isNaN(startMs) && startMs < constraints.startAfterMs) continue;
      const dateDistance = Math.abs(dateOffset(slot.date) - dateOffset(original.date));
      const timeDiff = Math.abs(start - (timeToMinutes(original.startTime) ?? 0));
      candidates.push({ pos, dateDistance, timeDiff });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.dateDistance !== b.dateDistance) return a.dateDistance - b.dateDistance;
    if (a.timeDiff !== b.timeDiff) return a.timeDiff - b.timeDiff;
    const as = timeToMinutes(a.pos.startTime) ?? 0;
    const bs = timeToMinutes(b.pos.startTime) ?? 0;
    if (as !== bs) return as - bs;
    return `${a.pos.date}|${a.pos.startTime}`.localeCompare(`${b.pos.date}|${b.pos.startTime}`);
  });
  return candidates[0].pos;
}

/**
 * 两阶段 target 搜索（Task 6）：
 * Pass 1 — Preferred：canonical free time（课程视为 busy → 天然无课程重叠）。
 * Pass 2 — Fallback：仅当 Pass 1 无解时，允许课程重叠（StudyBlock / Exam / Activity 仍 busy；
 * 08:00–21:00 窗口与 DDL 约束由 findFreeTime / constraints 保证）。
 * Course overlap 是 preference 而非 correctness。
 * V1.1：course_conflict 的 hard issue 只能落在「非课程时间」target（avoidCourseTime=true 跳过 Fallback）。
 */
function findRebalanceTarget(
  block: StudyBlock,
  input: StudyRebalanceInput,
  simulatedBlocks: StudyBlock[],
  constraints: { endBeforeMs: number | null; startAfterMs: number | null },
  now: Date,
  horizonEnd: Date,
  options?: { avoidCourseTime?: boolean }
): StudyRebalancePosition | null {
  const baseQuery = {
    start: now,
    now: input.now,
    end: horizonEnd,
    semester: input.semester,
    currentSemesterWeek: input.currentSemesterWeek,
    schedules: input.schedules,
    calendarMarks: input.calendarMarks,
    studyBlocks: simulatedBlocks.filter((b) => b.id !== block.id),
  };
  const freeSlots = findFreeTime(baseQuery);
  const preferred = findBestPlacement(freeSlots, blockMinutes(block), positionOf(block), constraints);
  if (preferred) return preferred;
  if (options?.avoidCourseTime) return null;

  const expanded = findFreeTime({ ...baseQuery, includeCourseTime: true });
  return findBestPlacement(
    expanded,
    blockMinutes(block),
    positionOf(block),
    constraints,
    (pos) => positionHasCourseOverlap(pos, input.schedules, input.semester)
  );
}

function dateOffset(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return 0;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() / 86400000;
}

function slotMinutesOf(slot: FreeTimeSlot): number {
  const s = timeToMinutes(slot.startTime);
  const e = timeToMinutes(slot.endTime);
  return s !== null && e !== null && e > s ? e - s : 0;
}

function minutesToHM(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`;
}

export function proposeStudyRebalance(input: StudyRebalanceInput): StudyRebalanceProposal {
  const { assignments, studyBlocks, now, horizonDays } = input;
  const horizonEnd = new Date(now.getTime() + horizonDays * 86400000);
  horizonEnd.setHours(23, 59, 59, 999);
  const reasons: string[] = [];

  const assignmentById = new Map(assignments.map((a) => [a.id, a]));

  // ---- 1. Movable candidates：未来 + source=kiro + assignment 存在且 active ----
  const activeIds = new Set(
    assignments.filter((a) => a.status === "todo" || a.status === "doing").map((a) => a.id)
  );
  const candidates = studyBlocks.filter((b) => {
    if (b.source !== "kiro") return false;
    if (!b.assignmentId || !activeIds.has(b.assignmentId)) return false;
    const startMs = posStartMs(positionOf(b));
    return !Number.isNaN(startMs) && startMs > now.getTime();
  });
  const manualOrInactive = studyBlocks.length - candidates.length;
  if (manualOrInactive > 0) {
    reasons.push("manual_or_inactive_blocks_protected");
  }

  // ---- 2. 初始 shortfall（current state，全部 block busy）----
  const shortfallBefore = computeShortfall(input, studyBlocks, horizonEnd);
  let shortfallAfter = shortfallBefore;

  // ---- 3. 检测 hard issues（Task 6：Course overlap 不再是 hard issue）----
  interface CandidateIssue {
    block: StudyBlock;
    reason: StudyRebalanceReason;
  }
  const hardIssues: CandidateIssue[] = [];
  for (const b of candidates) {
    const assignment = b.assignmentId ? assignmentById.get(b.assignmentId) : undefined;
    if (afterDeadline(b, assignment)) {
      hardIssues.push({ block: b, reason: "after_deadline" });
    } else if (fixedEventConflict(b, input.calendarMarks)) {
      hardIssues.push({ block: b, reason: "fixed_event_conflict" });
    } else if (
      findUnapprovedCourseOverlaps({
        block: b,
        schedules: input.schedules,
        semester: input.semester,
      }).length > 0
    ) {
      // V1.1：只有「未批准」的课程重叠才是 hard issue（有效 Approval 被尊重，不因此搬走）
      hardIssues.push({ block: b, reason: "course_conflict" });
    }
  }
  // deterministic 顺序：reason rank → blockId
  hardIssues.sort((a, b) => {
    const r = HARD_REASON_RANK[a.reason] - HARD_REASON_RANK[b.reason];
    if (r !== 0) return r;
    return a.block.id.localeCompare(b.block.id);
  });

  // ---- 4. 模拟状态：moves 接受后逐步更新 ----
  const moves: StudyRebalanceMove[] = [];
  const movedIds = new Set<string>();
  // 当前「保护 + 已接受 move 目标」的模拟 blocks（用于找空闲）
  let simulatedBlocks: StudyBlock[] = studyBlocks.filter((b) => !movedIds.has(b.id));
  const acceptedTargets: SimulatedBlock[] = [];

  const acceptedBlocks = (): StudyBlock[] => {
    // protected（未移动的 manual/inactive/未候选）+ 已接受 move 的新位置
    const result = simulatedBlocks.filter((b) => !movedIds.has(b.id));
    for (const t of acceptedTargets) {
      result.push({
        id: t.blockId,
        title: "",
        date: t.date,
        startTime: t.startTime,
        endTime: t.endTime,
        assignmentId: "",
        courseId: undefined,
        source: "kiro",
      } as StudyBlock);
    }
    return result;
  };

  const acceptMove = (
    block: StudyBlock,
    reason: StudyRebalanceReason,
    to: StudyRebalancePosition
  ) => {
    const assignment = block.assignmentId ? assignmentById.get(block.assignmentId) : undefined;
    moves.push({
      blockId: block.id,
      assignmentId: block.assignmentId ?? "",
      title: block.title,
      courseId: block.courseId,
      minutes: blockMinutes(block),
      reason,
      from: positionOf(block),
      to,
    });
    movedIds.add(block.id);
    acceptedTargets.push({ ...to, blockId: block.id });
    // 重新计算（simulated blocks 新位置 + 释放旧位置）
    simulatedBlocks = acceptedBlocks();
    shortfallAfter = computeShortfall(input, simulatedBlocks, horizonEnd);
    void assignment;
  };

  // ---- 5. Hard issues 优先（minimal churn：解决后即停；target 两阶段：非课程时间优先）----
  for (const issue of hardIssues) {
    if (movedIds.has(issue.block.id)) continue;
    const assignment = issue.block.assignmentId ? assignmentById.get(issue.block.assignmentId) : undefined;
    const endBeforeMs = ddlMsOf(assignment);
    const to = findRebalanceTarget(
      issue.block,
      input,
      simulatedBlocks,
      { endBeforeMs, startAfterMs: null },
      now,
      horizonEnd,
      // course_conflict 必须落到非课程时间（否则只是把未批准重叠搬去另一个重叠）
      { avoidCourseTime: issue.reason === "course_conflict" }
    );
    if (!to) {
      reasons.push(
        issue.reason === "after_deadline" ? "unresolved_after_deadline" : "unresolved_conflict"
      );
      continue;
    }
    acceptMove(issue.block, issue.reason, to);
  }

  const hardIssuesResolved = moves.filter((m) => m.reason !== "capacity_relief").length;

  // ---- 6. capacity_relief（必须降低 canonical shortfall）----
  if (shortfallAfter > 0) {
    const shortfallInfo = firstShortfallDeadline(input, simulatedBlocks, horizonEnd);
    const remainingCandidates = candidates
      .filter((b) => !movedIds.has(b.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const block of remainingCandidates) {
      if (shortfallAfter <= 0) break; // minimal churn：缺口解决即停
      const assignment = block.assignmentId ? assignmentById.get(block.assignmentId) : undefined;
      const endBeforeMs = ddlMsOf(assignment);
      const to = findRebalanceTarget(
        block,
        input,
        simulatedBlocks,
        { endBeforeMs, startAfterMs: shortfallInfo ? shortfallInfo.deadlineMs : null },
        now,
        horizonEnd
      );
      if (!to) continue;
      // 模拟验证：接受该 move 后 shortfall 必须下降
      const trialBlocks = [...simulatedBlocks.filter((b) => b.id !== block.id)];
      const trialTarget: StudyBlock = {
        ...block,
        date: to.date,
        startTime: to.startTime,
        endTime: to.endTime,
      };
      trialBlocks.push(trialTarget);
      const trialShortfall = computeShortfall(input, trialBlocks, horizonEnd);
      if (trialShortfall < shortfallAfter) {
        acceptMove(block, "capacity_relief", to);
      }
    }
  }

  const releasedEarlyCapacityMinutes = Math.max(shortfallBefore - shortfallAfter, 0);
  if (shortfallAfter > 0) reasons.push("remaining_shortfall_after_rebalance");

  return {
    horizonDays,
    moves,
    summary: {
      movedBlocks: moves.length,
      movedMinutes: moves.reduce((s, m) => s + m.minutes, 0),
      hardIssuesResolved,
      shortfallBefore,
      shortfallAfter,
      releasedEarlyCapacityMinutes,
    },
    reasons,
  };
}
