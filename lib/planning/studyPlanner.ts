/**
 * Study Plan Proposal Engine（纯函数，无 AI、无 React、绝不写 Store）。
 * deterministic：按 Deadline 早 → 优先级高排序；只补 estimated - existing scheduled 的缺口；
 * 块长 30–90min；只占用 Free Time Engine 给出的空闲槽；课程永远不被移动。
 */

import { Assignment, CalendarMark, CourseSchedule, Semester, StudyBlock } from "@/types";
import { parseLocalDDL } from "@/lib/ddl";
import { timeToMinutes } from "@/lib/timeline/timelineGeometry";
import { findFreeTime, FreeTimeSlot, minutesToHM } from "@/lib/planning/freeTime";

export interface ProposedBlock {
  date: string; // "YYYY-MM-DD"
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  minutes: number;
}

export interface StudyPlanProposal {
  assignmentId: string;
  title: string;
  courseId: string;
  proposedBlocks: ProposedBlock[];
  estimatedMinutes: number | null;
  scheduledMinutes: number; // 已有（Deadline 前）安排
  proposedMinutes: number;
  completeCoverage: boolean;
  reasons: string[];
}

export interface ProposeStudyPlanInput {
  assignments: Assignment[];
  studyBlocks: StudyBlock[];
  semester: Semester;
  currentSemesterWeek: number;
  schedules: CourseSchedule[];
  calendarMarks: CalendarMark[];
  fromDate: string; // "YYYY-MM-DD"
  toDate: string; // "YYYY-MM-DD"
  now: Date;
}

export interface ProposeStudyPlanResult {
  items: StudyPlanProposal[];
  reasons: string[];
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

/** 该 StudyBlock 是否完全落在 Deadline 之前 */
function blockBeforeDeadline(
  b: StudyBlock,
  deadlineDate: string,
  deadlineMinutes: number
): boolean {
  if (b.date < deadlineDate) return true;
  if (b.date > deadlineDate) return false;
  const end = timeToMinutes(b.endTime);
  return end !== null && end <= deadlineMinutes;
}

function scheduledBeforeDeadline(a: Assignment, studyBlocks: StudyBlock[]): number {
  if (!a.ddl) return 0;
  const deadline = parseLocalDDL(a.ddl);
  if (!deadline) return 0;
  const dlDate = a.ddl.slice(0, 10);
  const dlMinutes = deadline.getHours() * 60 + deadline.getMinutes();
  return studyBlocks
    .filter((b) => b.assignmentId === a.id && blockBeforeDeadline(b, dlDate, dlMinutes))
    .reduce((sum, b) => {
      const s = timeToMinutes(b.startTime);
      const e = timeToMinutes(b.endTime);
      if (s === null || e === null || e <= s) return sum;
      return sum + (e - s);
    }, 0);
}

const MIN_BLOCK = 30;
const PREFERRED_BLOCK = 90;

/** 将 free slot 切成计划块并更新剩余池 */
function takeFromSlot(
  pool: FreeTimeSlot[],
  needMinutes: number
): { blocks: ProposedBlock[]; minutes: number; pool: FreeTimeSlot[] } {
  const blocks: ProposedBlock[] = [];
  let remaining = needMinutes;
  const nextPool: FreeTimeSlot[] = [];
  for (const slot of pool) {
    if (remaining <= 0) {
      nextPool.push(slot);
      continue;
    }
    const take = Math.min(slot.minutes, Math.max(MIN_BLOCK, Math.min(PREFERRED_BLOCK, remaining)));
    if (take < MIN_BLOCK) {
      nextPool.push(slot);
      continue;
    }
    const start = slot.startTime;
    const startMin = timeToMinutes(start) ?? 0;
    const block: ProposedBlock = {
      date: slot.date,
      startTime: start,
      endTime: minutesToHM(startMin + take),
      minutes: take,
    };
    blocks.push(block);
    remaining -= take;
    const rest = slot.minutes - take;
    if (rest >= MIN_BLOCK) {
      nextPool.push({
        date: slot.date,
        startTime: minutesToHM(startMin + take),
        endTime: slot.endTime,
        minutes: rest,
      });
    }
  }
  return { blocks, minutes: needMinutes - Math.max(remaining, 0), pool: nextPool };
}

export function proposeStudyPlan(input: ProposeStudyPlanInput): ProposeStudyPlanResult {
  const { assignments, studyBlocks, now } = input;
  const reasons: string[] = ["deadline_first", "existing_schedule_respected"];

  // 1. 过滤可规划任务：active（todo/doing），排除已提交/已完成；overdue 不安排
  const planable = assignments.filter(
    (a) => (a.status === "todo" || a.status === "doing") && (!a.ddl || parseLocalDDL(a.ddl)! > now)
  );

  // 2. deterministic 排序：Deadline 早优先（无 Deadline 排最后）→ 优先级高优先
  const sorted = [...planable].sort((a, b) => {
    const da = a.ddl ? parseLocalDDL(a.ddl)!.getTime() : Infinity;
    const db = b.ddl ? parseLocalDDL(b.ddl)!.getTime() : Infinity;
    if (da !== db) return da - db;
    return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
  });

  // 3. 空闲池：fromDate..toDate，Deadline 当天截止到 Deadline 时刻
  const from = new Date(`${input.fromDate}T00:00:00`);
  const to = new Date(`${input.toDate}T23:59:59`);
  const dayCapMinutesByDate: Record<string, number> = {};
  for (const a of sorted) {
    if (!a.ddl) continue;
    const deadline = parseLocalDDL(a.ddl)!;
    const dlDate = a.ddl!.slice(0, 10);
    if (dlDate >= input.fromDate && dlDate <= input.toDate) {
      const cap = deadline.getHours() * 60 + deadline.getMinutes();
      dayCapMinutesByDate[dlDate] = Math.min(dayCapMinutesByDate[dlDate] ?? 24 * 60, cap);
    }
  }
  let pool = findFreeTime({
    start: from,
    end: to,
    semester: input.semester,
    currentSemesterWeek: input.currentSemesterWeek,
    schedules: input.schedules,
    calendarMarks: input.calendarMarks,
    studyBlocks: input.studyBlocks,
    dayCapMinutesByDate,
  });

  const items: StudyPlanProposal[] = [];
  for (const a of sorted) {
    const existing = scheduledBeforeDeadline(a, studyBlocks);
    const estimated = a.estimatedMinutes ?? 0;
    const need = Math.max(estimated - existing, 0);

    if (need === 0) {
      items.push({
        assignmentId: a.id,
        title: a.title,
        courseId: a.courseId,
        proposedBlocks: [],
        estimatedMinutes: a.estimatedMinutes ?? null,
        scheduledMinutes: existing,
        proposedMinutes: 0,
        completeCoverage: true,
        reasons: ["existing_schedule_respected"],
      });
      continue;
    }

    const { blocks, minutes, pool: nextPool } = takeFromSlot(pool, need);
    pool = nextPool;
    const complete = minutes >= need;
    items.push({
      assignmentId: a.id,
      title: a.title,
      courseId: a.courseId,
      proposedBlocks: blocks,
      estimatedMinutes: a.estimatedMinutes ?? null,
      scheduledMinutes: existing,
      proposedMinutes: minutes,
      completeCoverage: complete,
      reasons: complete ? ["fits_before_deadline"] : ["fits_before_deadline", "insufficient_free_time"],
    });
  }

  if (sorted.length === 0) reasons.push("no_planable_tasks");
  return { items, reasons };
}
