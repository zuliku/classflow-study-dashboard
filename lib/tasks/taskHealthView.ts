/**
 * Task V2 Deadline Health View Layer（纯函数，无 React）。
 * UI / Workspace / Kiro 共用的 selector：
 * - deriveAssignmentHealthWithAvailability：Assignment + Free Time Engine → TaskHealthResult
 * - healthViewMeta：状态 → muted palette label / tone class
 * - healthExplanation：状态 → 可读解释（所有数字必须来自 Health Result，禁止 UI 自己猜）
 */

import { Assignment, CalendarMark, CourseSchedule, Semester, StudyBlock } from "@/types";
import { parseLocalDDL } from "@/lib/ddl";
import { findFreeTime } from "@/lib/planning/freeTime";
import {
  deriveAssignmentHealth,
  TaskHealthResult,
  TaskHealthState,
} from "@/lib/tasks/taskHealth";
import { formatEstimatedMinutes } from "@/lib/tasks/taskSemantics";

export interface HealthPlanningInput {
  schedules: CourseSchedule[];
  calendarMarks: CalendarMark[];
  semester: Semester;
  currentSemesterWeek: number;
}

/** Assignment + Free Time Engine → Health Result（deterministic；UI / Workspace / Kiro 共用） */
export function deriveAssignmentHealthWithAvailability(
  assignment: Assignment,
  studyBlocks: StudyBlock[],
  planning: HealthPlanningInput,
  now: Date
): TaskHealthResult {
  // Deadline 前可用空闲分钟：now → deadline（Deadline 当天截止到 Deadline 时刻）
  let availableMinutesBeforeDeadline: number | undefined;
  if (assignment.ddl) {
    const deadline = parseLocalDDL(assignment.ddl);
    if (deadline && deadline.getTime() > now.getTime()) {
      const dlDate = assignment.ddl.slice(0, 10);
      const dlMinutes = deadline.getHours() * 60 + deadline.getMinutes();
      const slots = findFreeTime({
        start: now,
        end: deadline,
        semester: planning.semester,
        currentSemesterWeek: planning.currentSemesterWeek,
        schedules: planning.schedules,
        calendarMarks: planning.calendarMarks,
        studyBlocks,
        dayCapMinutesByDate: { [dlDate]: dlMinutes },
      });
      availableMinutesBeforeDeadline = slots.reduce((sum, s) => sum + s.minutes, 0);
    }
  }
  return deriveAssignmentHealth({ assignment, studyBlocks, now, availableMinutesBeforeDeadline });
}

export interface HealthViewMeta {
  label: string;
  /** badge className（muted palette；禁止红黄绿交通灯） */
  className: string;
}

const HEALTH_VIEW_META: Record<TaskHealthState, HealthViewMeta> = {
  safe: { label: "计划充足", className: "bg-[#627566]/10 text-[#627566] border-[#627566]/30" },
  attention: { label: "需要关注", className: "bg-[#A87952]/10 text-[#A87952] border-[#A87952]/30" },
  "at-risk": { label: "可能来不及", className: "bg-[#9B5B57]/10 text-[#9B5B57] border-[#9B5B57]/30" },
  overdue: { label: "已逾期", className: "bg-danger-bg text-danger border-danger-border" },
  unscheduled: { label: "尚未安排", className: "bg-[#A48F82]/10 text-[#A48F82] border-[#A48F82]/30" },
  unknown: { label: "信息不足", className: "bg-alabaster text-satin-grey border-line" },
};

export function healthViewMeta(state: TaskHealthState): HealthViewMeta {
  return HEALTH_VIEW_META[state];
}

/** 可读解释（数字全部来自 Health Result；无则返回 null，不显示空行） */
export function healthExplanation(r: TaskHealthResult): string | null {
  switch (r.state) {
    case "safe":
      return "已排学习时间充足";
    case "overdue":
      return "已过截止时间";
    case "at-risk":
      if (r.unscheduledMinutes !== undefined && r.availableMinutesBeforeDeadline !== undefined) {
        return `预计还需 ${formatEstimatedMinutes(r.unscheduledMinutes) ?? `${r.unscheduledMinutes} 分钟`}，截止前可用约 ${formatEstimatedMinutes(r.availableMinutesBeforeDeadline) ?? `${r.availableMinutesBeforeDeadline} 分钟`}`;
      }
      return "已排时间可能不够，建议补充学习计划";
    case "unscheduled":
      if (r.estimatedMinutes) {
        return `预计 ${formatEstimatedMinutes(r.estimatedMinutes)}，尚未安排学习时间`;
      }
      return "尚未安排学习时间";
    case "attention":
      if (r.estimatedMinutes !== undefined && r.scheduledMinutesBeforeDeadline > 0) {
        return `已安排 ${formatEstimatedMinutes(r.scheduledMinutesBeforeDeadline)} / 预计 ${formatEstimatedMinutes(r.estimatedMinutes)}`;
      }
      return "部分已安排，建议补足计划";
    case "unknown":
      if (r.reasons.includes("missing_deadline") && r.reasons.includes("missing_estimate")) {
        return "未设置截止时间，也缺少预计耗时";
      }
      if (r.reasons.includes("missing_deadline")) return "未设置截止时间";
      if (r.reasons.includes("missing_estimate")) return "缺少预计耗时";
      return "信息不足";
  }
}
