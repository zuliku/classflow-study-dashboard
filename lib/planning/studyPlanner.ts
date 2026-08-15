/**
 * Study Plan Proposal Engine（纯函数，无 AI、无 React、绝不写 Store）。
 * 与 Capacity Allocator 共用同一底层分配算法：
 * findFreeTime → allocateStudyCapacity → 映射为 StudyPlanProposal（proposal-first）。
 * deterministic：按 Deadline 早 → 优先级高 → stable id 排序；只补 estimated - existing 的缺口；
 * 块长 30–90min；只占用 Free Time Engine 给出的空闲槽；课程永远不被移动。
 */

import { Assignment, CalendarMark, CourseSchedule, Semester, StudyBlock } from "@/types";
import { parseLocalDDL } from "@/lib/ddl";
import { findFreeTime, FreeTimeSlot } from "@/lib/planning/freeTime";
import { allocateStudyCapacity, CapacityTaskAllocation } from "@/lib/planning/capacityAllocation";
import { timeToMinutes } from "@/lib/timeline/timelineGeometry";

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

/** CapacityTaskAllocation → 兼容的 StudyPlanProposal（保持 Proposal 语义） */
export function toStudyPlanProposal(t: CapacityTaskAllocation): StudyPlanProposal {
  let reasons: string[];
  if (t.classification === "missing_estimate") {
    reasons = ["missing_estimate"];
  } else if (t.remainingRequiredMinutes === 0) {
    reasons = ["existing_schedule_respected"];
  } else {
    reasons = t.completeCoverage
      ? ["fits_before_deadline"]
      : ["fits_before_deadline", "insufficient_free_time"];
  }
  return {
    assignmentId: t.assignmentId,
    title: t.title,
    courseId: t.courseId ?? "",
    proposedBlocks: t.projectedBlocks,
    estimatedMinutes: t.estimatedMinutes,
    scheduledMinutes: t.alreadyScheduledMinutes,
    proposedMinutes: t.allocatedMinutes,
    completeCoverage: t.completeCoverage,
    reasons,
  };
}

export function proposeStudyPlan(input: ProposeStudyPlanInput): ProposeStudyPlanResult {
  const { assignments, studyBlocks, now } = input;
  const reasons: string[] = ["deadline_first", "existing_schedule_respected"];

  // 1. 过滤可规划任务：active（todo/doing），排除已提交/已完成；overdue 不安排
  const planable = assignments.filter(
    (a) => (a.status === "todo" || a.status === "doing") && (!a.ddl || parseLocalDDL(a.ddl)! > now)
  );

  // 2. 空闲池：fromDate..toDate，Deadline 当天截止到 Deadline 时刻
  const from = new Date(`${input.fromDate}T00:00:00`);
  const to = new Date(`${input.toDate}T23:59:59`);
  const dayCapMinutesByDate: Record<string, number> = {};
  for (const a of planable) {
    if (!a.ddl) continue;
    const deadline = parseLocalDDL(a.ddl)!;
    const dlDate = a.ddl!.slice(0, 10);
    if (dlDate >= input.fromDate && dlDate <= input.toDate) {
      const cap = deadline.getHours() * 60 + deadline.getMinutes();
      dayCapMinutesByDate[dlDate] = Math.min(dayCapMinutesByDate[dlDate] ?? 24 * 60, cap);
    }
  }
  const freeTimeQuery = {
    start: from,
    now: input.now,
    end: to,
    semester: input.semester,
    currentSemesterWeek: input.currentSemesterWeek,
    schedules: input.schedules,
    calendarMarks: input.calendarMarks,
    studyBlocks: input.studyBlocks,
    dayCapMinutesByDate,
  };
  const pool = findFreeTime(freeTimeQuery);

  // 3. Pass 1：只用 Free Time（课程时间不可用）
  const pass1 = allocateStudyCapacity(
    {
      assignments: planable,
      studyBlocks,
      freeSlots: pool,
      fromDate: input.fromDate,
      toDate: input.toDate,
      now,
    },
    { includeNoDeadline: true }
  );

  // 4. Pass 2（Task 5）：空闲不足时才允许课程时间（soft constraint）。
  //    extra = 含课程时间的候选 − 与 Pass 1 空闲槽重叠的部分（防止同一时间被两次消耗）
  //    池拼接 = free 优先 + course-only 补充 → 分配器从头部消费，天然 Free time 优先。
  const eligibleShortfall =
    pass1.totalShortfallMinutes -
    pass1.tasks
      .filter((t) => t.classification !== "eligible")
      .reduce((s, t) => s + t.shortfallMinutes, 0);
  let allocation = pass1;
  if (eligibleShortfall > 0) {
    const expanded = findFreeTime({ ...freeTimeQuery, includeCourseTime: true });
    const extra = expanded.filter(
      (slot) => !pool.some((p) => slotOverlaps(p, slot))
    );
    const pass2 = allocateStudyCapacity(
      {
        assignments: planable,
        studyBlocks,
        freeSlots: [...pool, ...extra],
        fromDate: input.fromDate,
        toDate: input.toDate,
        now,
      },
      { includeNoDeadline: true }
    );
    allocation = pass2;
    if (pass2.totalAllocatedMinutes > pass1.totalAllocatedMinutes) {
      reasons.push("course_overlap_used_as_fallback");
    }
  }

  const items = allocation.tasks.map(toStudyPlanProposal);
  if (planable.length === 0) reasons.push("no_planable_tasks");
  return { items, reasons };
}

/** 两个空闲槽是否时间重叠（同日期 + 半开区间） */
function slotOverlaps(a: FreeTimeSlot, b: FreeTimeSlot): boolean {
  if (a.date !== b.date) return false;
  const as = timeToMinutes(a.startTime) ?? 0;
  const ae = timeToMinutes(a.endTime) ?? as;
  const bs = timeToMinutes(b.startTime) ?? 0;
  const be = timeToMinutes(b.endTime) ?? bs;
  return as < be && bs < ae;
}
