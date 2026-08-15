/**
 * Course Overlap Policy（Planning Constraint Semantics V1.1）。
 * 唯一课程重叠判定 + Schedule-version-aware Approval 语义：
 * - 课程重叠是 soft constraint：用户显式批准后成为 persisted intent（Block × Schedule 版本级别）
 * - Approval 绑定 scheduleId + scheduleFingerprint（时间冲突语义，不含 location/名称/颜色）
 * - Fingerprint 变化（时间/星期/周次/excludedWeeks）→ 旧 Approval 自动失效
 * - 学期范围之外不 clamp：week < 1 或 > totalWeeks → 课程不视为 active（不制造假冲突）
 * - 本模块不改变 Free Time Engine：课程永远 busy；Approval 只表示"这个特定 Block 可以留在那里"
 */

import { CourseSchedule, Semester, StudyBlock } from "@/types";
import { isScheduleActive } from "@/lib/schedule";
import { getSemesterWeek } from "@/lib/semester";
import { timeToMinutes } from "@/lib/timeline/timelineGeometry";

/** Block × Schedule 版本的课程重叠批准（persisted intent；不存 boolean） */
export interface StudyBlockCourseOverlapApproval {
  scheduleId: string;
  /** 只包含影响"时间冲突语义"的 schedule 信息（见 buildCourseOverlapScheduleFingerprint） */
  scheduleFingerprint: string;
  approvedAt: number;
}

/** 单个 Block 的课程重叠事实（canonical 输出） */
export interface StudyBlockCourseOverlap {
  scheduleId: string;
  courseId: string;
  scheduleFingerprint: string;
}

function parseDateWeek(date: string, semester: Semester): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay() === 0 ? 7 : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
}

function blockMinutes(b: { startTime: string; endTime: string }): [number, number] | null {
  const s = timeToMinutes(b.startTime);
  const e = timeToMinutes(b.endTime);
  if (s === null || e === null) return null;
  return [s, e];
}

/**
 * Schedule 时间冲突语义 Fingerprint。
 * 包含：scheduleId / courseId / dayOfWeek / startTime / endTime / weeks / excludedWeeks（排序+稳定序列化）。
 * 不包含：location / course name / teacher / 颜色（这些变化不改变时间冲突语义）。
 */
export function buildCourseOverlapScheduleFingerprint(schedule: CourseSchedule): string {
  const excluded = schedule.excludedWeeks
    ? [...schedule.excludedWeeks].sort((a, b) => a - b).join(",")
    : "";
  return [
    `sid:${schedule.id}`,
    `cid:${schedule.courseId}`,
    `dow:${schedule.dayOfWeek}`,
    `t:${schedule.startTime}-${schedule.endTime}`,
    `w:${schedule.weeks || "1-16周"}`,
    `ex:${excluded}`,
  ].join("|");
}

/** 半开区间重叠 */
function overlaps(aS: number, aE: number, bS: number, bE: number): boolean {
  return aS < bE && bS < aE;
}

/**
 * Canonical：Block 与当前生效课程的软重叠（按 block.date 计算教学周；学期外 → 无重叠）。
 */
export function findCourseOverlapsForStudyBlock(input: {
  block: Pick<StudyBlock, "date" | "startTime" | "endTime">;
  schedules: CourseSchedule[];
  semester: Semester;
}): StudyBlockCourseOverlap[] {
  const { block, schedules, semester } = input;
  const dow = parseDateWeek(block.date, semester);
  if (dow === null) return [];
  const week = getSemesterWeekOfDate(block.date, semester);
  // 学期范围之外不 clamp：课程不视为 active（不制造假冲突）
  if (week < 1 || week > semester.totalWeeks) return [];
  const [s, e] = blockMinutes(block) ?? [NaN, NaN];
  if (Number.isNaN(s) || Number.isNaN(e)) return [];

  const out: StudyBlockCourseOverlap[] = [];
  for (const sch of schedules) {
    if (sch.dayOfWeek !== dow) continue;
    if (!isScheduleActive(sch, week)) continue;
    const ss = timeToMinutes(sch.startTime);
    const se = timeToMinutes(sch.endTime);
    if (ss === null || se === null || se <= ss) continue;
    if (overlaps(s, e, ss, se)) {
      out.push({
        scheduleId: sch.id,
        courseId: sch.courseId,
        scheduleFingerprint: buildCourseOverlapScheduleFingerprint(sch),
      });
    }
  }
  return out;
}

/** 学期周次（复用 lib/semester.getSemesterWeek；越界返回原始值，由调用方决定是否 clamp） */
function getSemesterWeekOfDate(date: string, semester: Semester): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return 0;
  return getSemesterWeek(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), semester);
}

/** Approval 是否仍对某个 overlap 有效：scheduleId 且 fingerprint 都匹配 */
export function isCourseOverlapApproved(
  block: Pick<StudyBlock, "courseOverlapApprovals">,
  overlap: StudyBlockCourseOverlap
): boolean {
  const approvals = block.courseOverlapApprovals;
  if (!approvals || approvals.length === 0) return false;
  return approvals.some(
    (a) =>
      a.scheduleId === overlap.scheduleId &&
      a.scheduleFingerprint === overlap.scheduleFingerprint
  );
}

/** 当前重叠 − 有效批准 = Rebalance / 校验应消费的 canonical unapproved 集合 */
export function findUnapprovedCourseOverlaps(input: {
  block: Pick<StudyBlock, "date" | "startTime" | "endTime" | "courseOverlapApprovals">;
  schedules: CourseSchedule[];
  semester: Semester;
}): StudyBlockCourseOverlap[] {
  const { block } = input;
  const overlaps = findCourseOverlapsForStudyBlock({
    block,
    schedules: input.schedules,
    semester: input.semester,
  });
  return overlaps.filter((o) => !isCourseOverlapApproved(block, o));
}

export type StudyBlockMutationSource = "manual" | "kiro" | "system" | "import";

/**
 * StudyBlock 时间变更后的 Approval 对账（唯一 reconcile 入口）：
 * - explicitApprovals 优先（Study Plan Approval Gate 通过后由调用方传入，Store 不重新猜）
 * - mutationSource=manual：用户直接操作（手动拖动到课程时间）→ 自动把当前 overlaps 记为明确接受
 * - mutationSource=kiro/system/import：无权创造新 Approval；只保留"仍然存在 + fingerprint 一致 + 目标位置仍重叠"的旧 Approval
 * - 无真实时间变化（仅 approval 变化）由调用方决定是否写 History（本 helper 只算 metadata）
 */
export function reconcileStudyBlockCourseOverlapApprovals(input: {
  before: Pick<StudyBlock, "date" | "startTime" | "endTime">;
  after: Pick<StudyBlock, "date" | "startTime" | "endTime" | "courseOverlapApprovals">;
  schedules: CourseSchedule[];
  semester: Semester;
  mutationSource: StudyBlockMutationSource;
  occurredAt: number;
  explicitApprovals?: StudyBlockCourseOverlapApproval[];
}): StudyBlockCourseOverlapApproval[] | undefined {
  const { before, after, schedules, semester, mutationSource, occurredAt } = input;
  const timeChanged =
    before.date !== after.date ||
    before.startTime !== after.startTime ||
    before.endTime !== after.endTime;

  // explicitApprovals 优先（Store 不重新猜）
  if (input.explicitApprovals !== undefined) {
    return input.explicitApprovals.length > 0 ? input.explicitApprovals : undefined;
  }

  if (!timeChanged) {
    // 时间未变：保留原 Approval（如有）
    return after.courseOverlapApprovals && after.courseOverlapApprovals.length > 0
      ? after.courseOverlapApprovals
      : undefined;
  }

  // 时间变化：manual = 用户直接操作 → 当前 overlaps 即明确接受
  if (mutationSource === "manual") {
    const current = findCourseOverlapsForStudyBlock({
      block: after,
      schedules,
      semester,
    });
    if (current.length === 0) return undefined;
    return current.map((o) => ({
      scheduleId: o.scheduleId,
      scheduleFingerprint: o.scheduleFingerprint,
      approvedAt: occurredAt,
    }));
  }

  // Kiro/system/import：不得创造新 Approval；只保留仍有效的旧 Approval
  const oldApprovals = after.courseOverlapApprovals ?? [];
  if (oldApprovals.length === 0) return undefined;
  const current = findCourseOverlapsForStudyBlock({ block: after, schedules, semester });
  const kept = oldApprovals.filter(
    (a) =>
      current.some(
        (o) => o.scheduleId === a.scheduleId && o.scheduleFingerprint === a.scheduleFingerprint
      )
  );
  return kept.length > 0 ? kept : undefined;
}
