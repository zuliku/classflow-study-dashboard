/**
 * Study Plan Apply Domain（Task 4B / Task 5 Part E-F）：
 * Proposal → User Confirm 之后的 Atomic Apply 安全层。纯函数 + Store Batch Action，无 React、无 AI。
 * Preflight 基于调用时最新 Store（Confirm 后必须用 useAppStore.getState() 重新校验）；
 * 任何一项不满足 → 整个 Apply 失败（All-or-None），不部分执行。
 *
 * Task 5：StudyBlock ↔ Course 从 Hard Conflict 改为 SOFT OVERLAP——
 * - 课程重叠不再使 Preflight 失败，而是收集为 courseOverlaps
 * - 真正的写入需要显式 allowCourseOverlap（Kiro 侧先过 Approval Gate；人工路径不受限）
 * - StudyBlock ↔ StudyBlock / 考试活动 / 输入格式 仍是硬失败
 */

import { AppState } from "@/store/useAppStore";
import { StudyBlock } from "@/types";
import { parseLocalDDL } from "@/lib/ddl";
import { isScheduleActive, timeToMinutes } from "@/lib/schedule";
import { getSemesterWeek } from "@/lib/semester";
import { FREE_TIME_DAY_END, FREE_TIME_DAY_START } from "@/lib/planning/freeTime";

export interface StudyPlanApplyBlockInput {
  assignmentId: string;
  title: string;
  courseId?: string;
  date: string; // "YYYY-MM-DD"
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
}

export interface StudyPlanApplyInput {
  blocks: StudyPlanApplyBlockInput[];
}

/** 单 Block 与课程的软重叠信息（Kiro Approval Gate 展示用） */
export interface CourseOverlapInfo {
  blockIndex: number;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  courseName: string;
}

export type StudyPlanApplyFailureCode = "STALE_PROPOSAL" | "CONFLICT" | "INVALID_INPUT";

export interface StudyPlanApplyFailure {
  ok: false;
  code: StudyPlanApplyFailureCode;
  message: string;
  details?: { blockIndex?: number; reason?: string };
}

export type StudyPlanPreflightResult =
  | { ok: true; courseOverlaps: CourseOverlapInfo[] }
  | StudyPlanApplyFailure;

export type StudyPlanApplyResult =
  | { ok: true; state: "created"; created: StudyBlock[] }
  | { ok: true; state: "needs-approval"; courseOverlaps: CourseOverlapInfo[] }
  | StudyPlanApplyFailure;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateStr(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  return !Number.isNaN(new Date(`${date}T00:00:00`).getTime());
}

/** 半开区间重叠：与 Free Time Engine / Timeline 冲突语义一致 */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Preflight（全部通过才返回 ok）：
 * 1. 输入格式（date / HH:mm / end > start / 08:00–21:00 规划窗口）
 * 2. 每个 assignmentId 必须仍存在
 * 3. 任务不得是 submitted / completed（Proposal 视为 stale）
 * 4. 有 DDL 的任务：Block 必须完整结束于 Deadline 之前
 * 5. 课程重叠：soft（收集到 courseOverlaps，不失败；按 Block 自身日期计算 semester week）
 * 6. 固定事件冲突：带时间的 Exam/Activity；All-day 整天 blocked；DDL 不是 busy（仍为硬失败）
 * 7. 与最新 studyBlocks 重复（同 assignmentId+date+start+end）→ stale
 * 8. 与最新 studyBlocks 重叠（硬失败）
 * 9. Proposed Blocks 彼此不重叠（projected set 逐步检查）
 */
export function preflightStudyPlan(input: StudyPlanApplyInput, state: AppState): StudyPlanPreflightResult {
  const blocks = input.blocks ?? [];
  if (blocks.length === 0) {
    return { ok: false, code: "INVALID_INPUT", message: "计划中没有可应用的学习时段。", details: { reason: "empty_blocks" } };
  }

  const projected: { date: string; start: number; end: number }[] = [];
  const courseOverlaps: CourseOverlapInfo[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const fail = (code: StudyPlanApplyFailureCode, message: string, reason: string): StudyPlanApplyFailure => ({
      ok: false,
      code,
      message,
      details: { blockIndex: i, reason },
    });

    // 1. 输入格式
    if (!isValidDateStr(b.date)) return fail("INVALID_INPUT", "计划中的日期格式不合法。", "invalid_date");
    const s = timeToMinutes(b.startTime);
    const e = timeToMinutes(b.endTime);
    if (s === null || e === null || e <= s) {
      return fail("INVALID_INPUT", "计划中的时间格式不合法，或结束时间不晚于开始时间。", "invalid_time");
    }
    if (s < FREE_TIME_DAY_START || e > FREE_TIME_DAY_END) {
      return fail("INVALID_INPUT", "学习时段必须在规划时间窗口内（08:00–21:00）。", "outside_planning_window");
    }

    // 2. 任务必须仍存在（不能只跳过失效任务继续创建）
    const assignment = state.assignments.find((a) => a.id === b.assignmentId);
    if (!assignment) {
      return fail("STALE_PROPOSAL", "计划已过期：某任务已不存在或已发生变化。", "assignment_missing");
    }

    // 3. 任务状态检查
    if (assignment.status === "submitted" || assignment.status === "completed") {
      return fail("STALE_PROPOSAL", "计划已过期：某任务状态已发生变化。", "assignment_inactive");
    }

    // 4. Deadline 检查：Block 必须完整结束于 Deadline 之前
    if (assignment.ddl) {
      const deadline = parseLocalDDL(assignment.ddl);
      if (deadline) {
        const dlDate = assignment.ddl.slice(0, 10);
        const dlMinutes = deadline.getHours() * 60 + deadline.getMinutes();
        if (b.date > dlDate || (b.date === dlDate && e > dlMinutes)) {
          return fail("STALE_PROPOSAL", "计划已过期：某任务截止时间已发生变化。", "block_after_deadline");
        }
      }
    }

    // 5. 课程重叠：SOFT（Task 5）。按 Block 自身日期计算 semester week（重要：不使用 UI 当前浏览周）；
    //    周次越界时 clamp 到 [1, totalWeeks]，避免「双周」规则在周 0 误判
    const week = Math.min(
      Math.max(getSemesterWeek(b.date, state.semester), 1),
      state.semester.totalWeeks
    );
    const dow = new Date(`${b.date}T00:00:00`).getDay() || 7;
    for (const sch of state.schedules) {
      if (sch.dayOfWeek !== dow) continue;
      if (!isScheduleActive(sch, week)) continue;
      const ss = timeToMinutes(sch.startTime);
      const se = timeToMinutes(sch.endTime);
      if (ss === null || se === null) continue;
      if (overlaps(s, e, ss, se)) {
        courseOverlaps.push({
          blockIndex: i,
          title: b.title,
          date: b.date,
          startTime: b.startTime,
          endTime: b.endTime,
          courseName: state.courses.find((c) => c.id === sch.courseId)?.name ?? "未知课程",
        });
      }
    }

    // 6. 固定事件冲突（Exam / Activity interval；All-day 整天 blocked；DDL 不是 busy）——仍为硬失败
    for (const m of state.calendarMarks) {
      if (m.date !== b.date) continue;
      if (m.type === "course" || m.type === "ddl") continue;
      const ms = timeToMinutes(m.startTime ?? "");
      const me = timeToMinutes(m.endTime ?? "");
      if (ms !== null && me !== null && me > ms) {
        if (overlaps(s, e, ms, me)) {
          return fail("CONFLICT", "计划与考试 / 活动时间冲突，未应用任何安排。", "fixed_event_conflict");
        }
      } else {
        // All-day exam/activity → 整天 blocked
        return fail("CONFLICT", "计划与当天全天安排冲突，未应用任何安排。", "all_day_event_conflict");
      }
    }

    // 7. Duplicate：已存在相同 assignmentId + date + start + end → stale（Double Apply 防护）
    for (const x of state.studyBlocks) {
      if (
        x.assignmentId === b.assignmentId &&
        x.date === b.date &&
        x.startTime === b.startTime &&
        x.endTime === b.endTime
      ) {
        return fail("STALE_PROPOSAL", "计划已过期：已存在相同的学习安排。", "duplicate_block");
      }
    }

    // 8. 与最新 StudyBlock 冲突（Proposal 生成后用户可能手动新增）——仍为硬失败
    for (const x of state.studyBlocks) {
      if (x.date !== b.date) continue;
      const xs = timeToMinutes(x.startTime);
      const xe = timeToMinutes(x.endTime);
      if (xs === null || xe === null) continue;
      if (overlaps(s, e, xs, xe)) {
        return fail("CONFLICT", "计划与现有学习计划冲突，未应用任何安排。", "studyblock_conflict");
      }
    }

    // 9. Proposed Blocks 彼此不重叠（projected set）
    for (const p of projected) {
      if (p.date !== b.date) continue;
      if (overlaps(s, e, p.start, p.end)) {
        return fail("CONFLICT", "计划内学习时段互相重叠，未应用任何安排。", "proposal_self_conflict");
      }
    }
    projected.push({ date: b.date, start: s, end: e });
  }

  return { ok: true, courseOverlaps };
}

/**
 * Atomic Apply：先对最新 Store Preflight，全部通过后单次 Batch 创建（source="kiro"）。
 * 任何硬失败：0 mutation。
 * Task 5 Approval Gate：存在课程重叠且未显式 allowCourseOverlap → 不写入，
 * 返回 needsApproval（Kiro UI 展示确认 Dialog）；确认后以 allowCourseOverlap=true 重新提交。
 * 该 Gate 是 deterministic mutation boundary——即使模型忘记提醒，系统也不会静默写入。
 */
export function applyStudyPlan(
  input: StudyPlanApplyInput,
  state: AppState,
  options?: { allowCourseOverlap?: boolean }
): StudyPlanApplyResult {
  const preflight = preflightStudyPlan(input, state);
  if (!preflight.ok) return preflight;

  if (preflight.courseOverlaps.length > 0 && options?.allowCourseOverlap !== true) {
    return { ok: true, state: "needs-approval", courseOverlaps: preflight.courseOverlaps };
  }

  const created = state.addStudyBlocksBatch(
    input.blocks.map((b) => ({
      title: b.title,
      date: b.date,
      startTime: b.startTime,
      endTime: b.endTime,
      assignmentId: b.assignmentId,
      courseId: b.courseId,
      source: "kiro" as const,
    })),
    // 用户确认并不改变 origin：Apply 仍是 Kiro-generated 计划（History event.source=kiro）
    { source: "kiro" }
  );
  return { ok: true, state: "created" as const, created };
}

/**
 * Proposal Fingerprint：由 assignmentId/date/startTime/endTime 稳定排序组成，
 * 用于判断当前 Ghost Preview 属于哪个 Proposal（不依赖数组 index）。
 */
export function createStudyPlanProposalKey(
  blocks: { assignmentId?: string; date: string; startTime: string; endTime: string }[]
): string {
  return blocks
    .map((b) => `${b.assignmentId ?? ""}|${b.date}|${b.startTime}|${b.endTime}`)
    .sort()
    .join(";");
}
