/**
 * Canonical Shared Capacity Allocation Engine（Analytics V2 · Part 4）。
 * 职责：在一个共享 Free Time Pool 中，回答「这些任务的剩余需求最多能被安排多少」。
 *
 * - 纯函数：无 React / 无 Zustand mutation / 无 AI；Free Time 由上层构建（只调用一次）。
 * - 共享容量：每个 slot 只能被一个任务消耗；绝不逐任务重新读取完整 freeSlots。
 * - Deadline 是第一约束（slot 必须 end <= task.deadline）；priority 仅在同 deadline 时排序；
 *   最后以 assignment.id.localeCompare() 做稳定 tie-break（不依赖输入数组顺序）。
 * - eligible：todo/doing + 有效 DDL + estimatedMinutes > 0；missing_estimate / no_deadline /
 *   overdue 不参与未来 shared allocation（分类保留，不消费容量）。
 * - 已存在 StudyBlock：findFreeTime 已把全部 existing blocks 视作 busy，
 *   这里只从 remainingRequired 扣除 scheduledBeforeDeadline，绝不二次扣容量。
 * - projectedBlocks 只用于 forecast / Planner Proposal；永远 no mutation。
 */

import { Assignment, StudyBlock } from "@/types";
import { parseLocalDDL } from "@/lib/ddl";
import { FreeTimeSlot } from "@/lib/planning/freeTime";
import { PLAN_MIN_BLOCK_MINUTES, PLAN_PREFERRED_BLOCK_MINUTES } from "@/lib/planning/planningConstants";
import { getScheduledMinutesBeforeDeadline } from "@/lib/planning/taskPlanningFacts";
import { partitionStudyDuration } from "@/lib/planning/blockPartition";
import { ProposedBlock } from "@/lib/planning/studyPlanner";
import { timeToMinutes } from "@/lib/timeline/timelineGeometry";
import { minutesToHM } from "@/lib/planning/freeTime";

export type CapacityClassification =
  | "eligible"
  | "missing_estimate"
  | "no_deadline"
  | "overdue";

export interface CapacityTaskAllocation {
  assignmentId: string;
  title: string;
  courseId: string | null;
  deadline: string | null;
  estimatedMinutes: number | null;
  classification: CapacityClassification;
  alreadyScheduledMinutes: number;
  remainingRequiredMinutes: number;
  allocatedMinutes: number;
  shortfallMinutes: number;
  completeCoverage: boolean;
  /** 仅供 forecast / Planner Proposal；不写 Store */
  projectedBlocks: ProposedBlock[];
}

export interface CapacityAllocationResult {
  tasks: CapacityTaskAllocation[];
  totalRemainingRequiredMinutes: number;
  totalAllocatedMinutes: number;
  totalShortfallMinutes: number;
  freeMinutesInWindow: number;
  unusedFreeMinutes: number;
  fullyCoveredTasks: number;
  partiallyCoveredTasks: number;
  uncoveredTasks: number;
}

export interface CapacityAllocationInput {
  assignments: Assignment[];
  studyBlocks: StudyBlock[];
  freeSlots: FreeTimeSlot[];
  fromDate: string;
  toDate: string;
  now: Date;
}

export interface CapacityAllocationOptions {
  /**
   * Planner 兼容：无 DDL 任务也参与分配（排最后，无 deadline 约束）。
   * Outlook 语义（默认 false）：无 DDL 不进入未来 shared allocation。
   */
  includeNoDeadline?: boolean;
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

function slotMinutes(slot: FreeTimeSlot): number {
  const s = timeToMinutes(slot.startTime);
  const e = timeToMinutes(slot.endTime);
  return s !== null && e !== null && e > s ? e - s : 0;
}

/** slot 是否可用于 deadline 之前（slot.end <= deadline） */
function slotBeforeDeadline(slot: FreeTimeSlot, deadlineMs: number): boolean {
  const dl = new Date(deadlineMs);
  const dlDate = `${dl.getFullYear()}-${String(dl.getMonth() + 1).padStart(2, "0")}-${String(dl.getDate()).padStart(2, "0")}`;
  if (slot.date < dlDate) return true;
  if (slot.date > dlDate) return false;
  const slotEnd = timeToMinutes(slot.endTime);
  const dlMinutes = dl.getHours() * 60 + dl.getMinutes();
  return slotEnd !== null && slotEnd <= dlMinutes;
}

const pad2HM = (n: number) => String(n).padStart(2, "0");

function slotStartMinutes(slot: FreeTimeSlot): number | null {
  return timeToMinutes(slot.startTime);
}

function slotEndMinutes(slot: FreeTimeSlot): number | null {
  return timeToMinutes(slot.endTime);
}

/**
 * 按 deadline 把 pool 拆成 [deadline 前（可截断）, deadline 后（保留给更晚任务）]。
 * 跨 deadline 的整槽拆成两段：前段 endTime = deadline 时刻，后段 startTime = deadline 时刻。
 * 这是 per-assignment deadline 的唯一截断点（Planner 不再使用全局 dayCap）。
 */
function splitPoolByDeadline(
  pool: FreeTimeSlot[],
  deadlineMs: number
): { before: FreeTimeSlot[]; after: FreeTimeSlot[] } {
  const before: FreeTimeSlot[] = [];
  const after: FreeTimeSlot[] = [];
  for (const slot of pool) {
    if (slotBeforeDeadline(slot, deadlineMs)) {
      before.push(slot);
      continue;
    }
    const dl = new Date(deadlineMs);
    const dlDate = `${dl.getFullYear()}-${String(dl.getMonth() + 1).padStart(2, "0")}-${String(dl.getDate()).padStart(2, "0")}`;
    if (slot.date > dlDate) {
      after.push(slot);
      continue;
    }
    // 同一天且 slot.end > deadline：截断
    const s = slotStartMinutes(slot);
    const e = slotEndMinutes(slot);
    const dlMinutes = dl.getHours() * 60 + dl.getMinutes();
    if (s === null || e === null || dlMinutes <= s) {
      after.push(slot);
      continue;
    }
    before.push({
      date: slot.date,
      startTime: slot.startTime,
      endTime: minutesToHM(dlMinutes),
      minutes: dlMinutes - s,
    });
    if (e > dlMinutes) {
      after.push({
        date: slot.date,
        startTime: minutesToHM(dlMinutes),
        endTime: slot.endTime,
        minutes: e - dlMinutes,
      });
    }
  }
  return { before, after };
}

/**
 * 从 pool 消耗分钟（V1.3 exact）：先决定 actualConsumed = min(need, slotAvailable)，
 * 再用 partitionStudyDuration 生成多个 contiguous blocks（remainder-aware，不 overshoot）；
 * 剩余正数容量全部保留（<30 的内部 fragment 也保留，绝不静默删除）。
 * 排序：>=preferredMin 的 slot 优先，<preferredMin 的 fragment 最后（稳定原始顺序）。
 */
function takeFromSlot(
  pool: FreeTimeSlot[],
  needMinutes: number
): { blocks: ProposedBlock[]; minutes: number; pool: FreeTimeSlot[] } {
  const blocks: ProposedBlock[] = [];
  let remaining = needMinutes;
  const queue = pool
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => {
      const aFrag = slotMinutes(a.slot) < PLAN_MIN_BLOCK_MINUTES ? 1 : 0;
      const bFrag = slotMinutes(b.slot) < PLAN_MIN_BLOCK_MINUTES ? 1 : 0;
      if (aFrag !== bFrag) return aFrag - bFrag;
      return a.index - b.index;
    })
    .map((q) => ({ ...q.slot }));
  const rest: FreeTimeSlot[] = [];

  for (const slot of queue) {
    if (remaining <= 0) {
      rest.push(slot);
      continue;
    }
    const avail = slotMinutes(slot);
    if (avail <= 0) continue;
    const consume = Math.min(avail, remaining);
    const parts = partitionStudyDuration(consume);
    let cursor = timeToMinutes(slot.startTime) ?? 0;
    for (const part of parts) {
      blocks.push({
        date: slot.date,
        startTime: minutesToHM(cursor),
        endTime: minutesToHM(cursor + part),
        minutes: part,
      });
      cursor += part;
    }
    remaining -= consume;
    const slotRest = avail - consume;
    if (slotRest > 0) {
      rest.push({
        date: slot.date,
        startTime: minutesToHM(cursor),
        endTime: slot.endTime,
        minutes: slotRest,
      });
    }
  }
  return { blocks, minutes: needMinutes - Math.max(remaining, 0), pool: rest };
}

function classify(a: Assignment, now: Date): CapacityClassification {
  const deadline = a.ddl ? parseLocalDDL(a.ddl) : null;
  if (!deadline) return "no_deadline";
  if (deadline.getTime() <= now.getTime()) return "overdue";
  if (!a.estimatedMinutes || a.estimatedMinutes <= 0) return "missing_estimate";
  return "eligible";
}

export function allocateStudyCapacity(
  input: CapacityAllocationInput,
  options?: CapacityAllocationOptions
): CapacityAllocationResult {
  const { assignments, studyBlocks, freeSlots, now } = input;
  const includeNoDeadline = options?.includeNoDeadline === true;

  // 1. 分类（不参与 allocation 的任务保留分类 + 0 分配）
  const classified = assignments
    .filter((a) => a.status === "todo" || a.status === "doing")
    .map((a) => {
      const cls = classify(a, now);
      const allocatable =
        cls === "eligible" || (includeNoDeadline && cls === "no_deadline");
      const already = getScheduledMinutesBeforeDeadline(a, studyBlocks);
      return {
        assignment: a,
        classification: cls,
        alreadyScheduledMinutes: already,
        remainingRequiredMinutes: allocatable
          ? Math.max((a.estimatedMinutes ?? 0) - already, 0)
          : 0,
      };
    });

  // 2. deterministic 排序：Deadline 早 → Priority 高 → stable id
  const sorted = [...classified].sort((x, y) => {
    const da = x.assignment.ddl ? parseLocalDDL(x.assignment.ddl)!.getTime() : Infinity;
    const db = y.assignment.ddl ? parseLocalDDL(y.assignment.ddl)!.getTime() : Infinity;
    if (da !== db) return da - db;
    const pa = PRIORITY_RANK[x.assignment.priority] ?? 9;
    const pb = PRIORITY_RANK[y.assignment.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    return x.assignment.id.localeCompare(y.assignment.id);
  });

  // 3. 单一共享池（Task A 消耗后，Task B 只能用剩余容量）
  let pool = freeSlots.map((s) => ({ ...s }));

  const tasks: CapacityTaskAllocation[] = [];
  for (const item of sorted) {
    const { assignment, classification, alreadyScheduledMinutes, remainingRequiredMinutes } = item;
    const allocatable =
      classification === "eligible" || (includeNoDeadline && classification === "no_deadline");
    if (!allocatable || remainingRequiredMinutes <= 0) {
      tasks.push({
        assignmentId: assignment.id,
        title: assignment.title,
        courseId: assignment.courseId ?? null,
        deadline: assignment.ddl ?? null,
        estimatedMinutes: assignment.estimatedMinutes ?? null,
        classification,
        alreadyScheduledMinutes,
        remainingRequiredMinutes,
        allocatedMinutes: 0,
        shortfallMinutes: remainingRequiredMinutes,
        // 剩余需求为 0 且 eligible（已有安排已覆盖）→ 视为 complete（Planner 兼容语义）；
        // missing_estimate / overdue / no_deadline（outlook 语义）恒为 false
        completeCoverage: classification === "eligible" && remainingRequiredMinutes === 0,
        projectedBlocks: [],
      });
      continue;
    }

    const deadlineMs =
      classification === "no_deadline" ? Infinity : parseLocalDDL(assignment.ddl!)!.getTime();
    // Per-assignment deadline：把跨越 deadline 的整槽「截断」为 [前段, 后段]，
    // 前段供本任务使用（取 deadline 时刻），后段保留给更晚 deadline 的任务。
    // （V1.2：删除 Planner 全局 dayCap 后，这是 per-assignment 的唯一截断点）
    const { before, after } = splitPoolByDeadline(pool, deadlineMs);
    const { blocks, minutes, pool: nextBefore } = takeFromSlot(before, remainingRequiredMinutes);
    pool = [...nextBefore, ...after];
    const shortfall = Math.max(remainingRequiredMinutes - minutes, 0);
    tasks.push({
      assignmentId: assignment.id,
      title: assignment.title,
      courseId: assignment.courseId ?? null,
      deadline: assignment.ddl ?? null,
      estimatedMinutes: assignment.estimatedMinutes ?? null,
      classification,
      alreadyScheduledMinutes,
      remainingRequiredMinutes,
      allocatedMinutes: minutes,
      shortfallMinutes: shortfall,
      completeCoverage: shortfall === 0,
      projectedBlocks: blocks,
    });
  }

  const freeMinutesInWindow = freeSlots.reduce((s, slot) => s + slotMinutes(slot), 0);
  // 未使用容量 = 分配后剩余池分钟
  const unusedFreeMinutes = pool.reduce((s, slot) => s + slotMinutes(slot), 0);

  const totalRemainingRequiredMinutes = tasks.reduce((s, t) => s + t.remainingRequiredMinutes, 0);
  const totalAllocatedMinutes = tasks.reduce((s, t) => s + t.allocatedMinutes, 0);
  const totalShortfallMinutes = tasks.reduce((s, t) => s + t.shortfallMinutes, 0);
  const fullyCoveredTasks = tasks.filter((t) => t.classification === "eligible" && t.completeCoverage).length;
  const partiallyCoveredTasks = tasks.filter(
    (t) => t.classification === "eligible" && !t.completeCoverage && t.allocatedMinutes > 0
  ).length;
  const uncoveredTasks = tasks.filter(
    (t) => t.classification === "eligible" && t.allocatedMinutes === 0
  ).length;

  return {
    tasks,
    totalRemainingRequiredMinutes,
    totalAllocatedMinutes,
    totalShortfallMinutes,
    freeMinutesInWindow,
    unusedFreeMinutes,
    fullyCoveredTasks,
    partiallyCoveredTasks,
    uncoveredTasks,
  };
}
