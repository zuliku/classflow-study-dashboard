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

/** 从 pool 头部切块（30–90min），消耗 pool；剩余需求未满足时继续切 rest 槽 */
function takeFromSlot(
  pool: FreeTimeSlot[],
  needMinutes: number
): { blocks: ProposedBlock[]; minutes: number; pool: FreeTimeSlot[] } {
  const blocks: ProposedBlock[] = [];
  let remaining = needMinutes;
  // 队列语义：切完一块后把同一 slot 的 rest 重新入队，直到需求满足或池空；
  // consumed 标记确保已消耗的 slot 不会回到 pool。
  const queue: FreeTimeSlot[] = pool.map((s) => ({ ...s }));
  const consumed: boolean[] = new Array(queue.length).fill(false);
  for (let i = 0; i < queue.length && remaining > 0; i++) {
    if (consumed[i]) continue;
    const slot = queue[i];
    const take = Math.min(
      slotMinutes(slot),
      Math.max(PLAN_MIN_BLOCK_MINUTES, Math.min(PLAN_PREFERRED_BLOCK_MINUTES, remaining))
    );
    if (take < PLAN_MIN_BLOCK_MINUTES) continue; // 碎片留到最后
    const startMin = timeToMinutes(slot.startTime) ?? 0;
    blocks.push({
      date: slot.date,
      startTime: slot.startTime,
      endTime: minutesToHM(startMin + take),
      minutes: take,
    });
    remaining -= take;
    consumed[i] = true;
    const slotRest = slotMinutes(slot) - take;
    if (slotRest >= PLAN_MIN_BLOCK_MINUTES) {
      queue.push({
        date: slot.date,
        startTime: minutesToHM(startMin + take),
        endTime: slot.endTime,
        minutes: slotRest,
      });
      consumed.push(false);
    }
  }
  const rest = queue.filter((_, i) => !consumed[i]);
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
    const usable = pool.filter((s) => slotBeforeDeadline(s, deadlineMs));
    const { blocks, minutes, pool: nextPool } = takeFromSlot(usable, remainingRequiredMinutes);
    pool = [...nextPool, ...pool.filter((s) => !slotBeforeDeadline(s, deadlineMs))];
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
