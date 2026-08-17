/**
 * Study Plan Proposal Engine（纯函数，无 AI、无 React、绝不写 Store）。
 * 消费 Canonical Planning Capacity Engine（buildPlanningCapacity）：
 *   Preferred Pass（非课程时间）→ 有真实缺口才进入 Soft Fallback（+课程时间，其余仍 hard busy）
 *   Final Proposal = capacity.combined（课程 fallback 只是预测；写入前仍走 Approval Gate）
 * deterministic：Deadline 早 → 优先级高 → stable id；只补 estimated - existing 的缺口；
 * 块长 30–90min；无 multi-task global dayCap（Deadline 由 allocator per-assignment 处理）；
 * 课程永远不被移动。
 */

import { Assignment, CalendarMark, CourseSchedule, Semester, StudyBlock } from "@/types";
import { parseLocalDDL } from "@/lib/ddl";
import { CapacityTaskAllocation } from "@/lib/planning/capacityAllocation";
import { buildPlanningCapacity } from "@/lib/planning/planningCapacity";
import { findCourseOverlapsForStudyBlock } from "@/lib/planning/courseOverlapPolicy";

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
  /** V1.2：非课程时间分配的分钟（Preview/解释用；Apply 仍以 fresh preflight 为准） */
  preferredProposedMinutes: number;
  /** V1.2：放宽课程约束后额外分配的分钟（≠ 课程重叠分钟） */
  courseFallbackProposedMinutes: number;
  /** V1.2：最终 blocks 中是否真的存在课程重叠（需 Approval Gate；由 findCourseOverlapsForStudyBlock 判断） */
  requiresCourseOverlapApproval: boolean;
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

/** 最终 blocks 是否真正与课程重叠（Approval Gate 的 Preview 依据；Apply 仍会 fresh 判定） */
function blockRequiresCourseApproval(
  t: CapacityTaskAllocation,
  input: ProposeStudyPlanInput
): boolean {
  return t.projectedBlocks.some((b) =>
    findCourseOverlapsForStudyBlock({
      block: b,
      schedules: input.schedules,
      semester: input.semester,
    }).length > 0
  );
}

/** CapacityTaskAllocation → 兼容的 StudyPlanProposal（保持 Proposal 语义 + V1.2 fallback metadata） */
export function toStudyPlanProposal(
  t: CapacityTaskAllocation,
  input: ProposeStudyPlanInput,
  preferredByAssignment: Map<string, CapacityTaskAllocation> | null
): StudyPlanProposal {
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
  const preferred = preferredByAssignment?.get(t.assignmentId);
  const preferredProposedMinutes = preferred?.allocatedMinutes ?? t.allocatedMinutes;
  const courseFallbackProposedMinutes = Math.max(
    t.allocatedMinutes - preferredProposedMinutes,
    0
  );
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
    preferredProposedMinutes,
    courseFallbackProposedMinutes,
    requiresCourseOverlapApproval: blockRequiresCourseApproval(t, input),
  };
}

export function proposeStudyPlan(input: ProposeStudyPlanInput): ProposeStudyPlanResult {
  const { assignments, now } = input;
  const reasons: string[] = ["deadline_first", "existing_schedule_respected"];

  // 1. 过滤可规划任务：active（todo/doing），排除已提交/已完成；overdue 不安排
  const planable = assignments.filter(
    (a) => (a.status === "todo" || a.status === "doing") && (!a.ddl || parseLocalDDL(a.ddl)! > now)
  );

  // 2. Canonical Planning Capacity（Planner 模式：no_deadline 也参与）
  const capacity = buildPlanningCapacity(
    {
      assignments: planable,
      studyBlocks: input.studyBlocks,
      schedules: input.schedules,
      calendarMarks: input.calendarMarks,
      semester: input.semester,
      currentSemesterWeek: input.currentSemesterWeek,
      fromDate: input.fromDate,
      toDate: input.toDate,
      now,
    },
    { includeNoDeadline: true }
  );

  // 3. Final Proposal = combined（fallback 只是预测，不是授权）
  const preferredByAssignment = new Map(
    capacity.preferred.tasks.map((t) => [t.assignmentId, t])
  );
  const items = capacity.combined.tasks.map((t) =>
    toStudyPlanProposal(t, input, preferredByAssignment)
  );

  if (capacity.summary.courseFallbackUsed) {
    reasons.push("course_overlap_used_as_fallback");
  }
  if (planable.length === 0) reasons.push("no_planable_tasks");
  return { items, reasons };
}
