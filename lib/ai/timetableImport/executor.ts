/**
 * Timetable Import Apply：
 * - 基于最新 Store 重跑完整 preflight + 重算 fingerprint（store 变化 → stale → 0 mutation）
 * - blockers 未解决 → 拒绝（0 mutation）
 * - 生成真实 Course/Schedule IDs → 一次性 importSchedules 原子写入
 * - 绝不做逐项写工具执行
 */
import { createId } from "@/lib/utils";
import { TimetableImportProposal, TimetableImportStoreDeps } from "@/lib/ai/timetableImport/types";
import { preflightScheduleImport } from "@/lib/scheduleImport/preflight";
import { ImportableCourseDraft } from "@/lib/scheduleImport/types";
import { Course, CourseSchedule } from "@/types";

export interface ApplyTimetableImportOptions {
  /** 用户跳过的课程 draftKey 集合（默认空） */
  skipCourseKeys?: Set<string>;
  /** 用户预览中刚保存的 Bell Schedule（Apply 前合入 latest store 判定） */
  pendingBell?: {
    id: string;
    name: string;
    periods: Array<{ period: number; startTime: string; endTime: string }>;
  } | null;
}

export type ApplyTimetableImportResult =
  | {
      ok: true;
      applied: { courses: number; slots: number };
      courseIds: string[];
      scheduleIds: string[];
    }
  | { ok: false; code: "STALE" | "BLOCKED" | "EMPTY_SELECTION" | "UNKNOWN"; message: string };

function draftToImportable(draft: TimetableImportProposal["draft"]): ImportableCourseDraft[] {
  return draft.courses.map((c) => ({
    draftKey: c.draftKey,
    name: c.name,
    code: c.code,
    teacher: c.teacher,
    classroom: c.classroom,
    credit: c.credit,
    slots: c.slots.map((s) => ({
      dayOfWeek: s.dayOfWeek,
      periodStart: s.periodStart,
      periodEnd: s.periodEnd,
      weekExpression: s.weekExpression,
      location: s.location,
    })),
  }));
}

export function applyTimetableImport(
  proposal: TimetableImportProposal,
  deps: TimetableImportStoreDeps,
  options: ApplyTimetableImportOptions = {}
): ApplyTimetableImportResult {
  const state = deps.getState();

  const effectiveBell =
    options.pendingBell ??
    (state.activeBellScheduleId
      ? state.bellSchedules.find((b) => b.id === state.activeBellScheduleId) ?? null
      : null);

  const existingCourses = state.courses.map((c) => ({
    name: c.name,
    code: c.code ?? null,
    teacher: c.teacher ?? null,
  }));
  const existingSchedules = state.schedules.map((s) => ({
    id: s.id,
    courseId: s.courseId,
    dayOfWeek: s.dayOfWeek,
    startTime: s.startTime,
    endTime: s.endTime,
    location: s.location ?? "",
    weeks: s.weeks,
  }));

  // 1. stale：基于最新 Store 对【完整 draft】重算 fingerprint，与预览不一致 → 0 mutation
  const fullRecheck = preflightScheduleImport({
    courses: draftToImportable(proposal.draft),
    existingCourses,
    existingSchedules,
    bell: effectiveBell,
  });
  if (fullRecheck.fingerprint !== proposal.preview.fingerprint) {
    return { ok: false, code: "STALE", message: "课表预览已过期，请重新查看后再导入。" };
  }

  // 2. 过滤用户跳过的课程 → 重新 preflight（blockers 未解决 → 拒绝）
  const selected = proposal.draft.courses.filter((c) => !options.skipCourseKeys?.has(c.draftKey));
  if (selected.length === 0) {
    return { ok: false, code: "EMPTY_SELECTION", message: "没有可导入的课程。" };
  }
  const recheck = preflightScheduleImport({
    courses: draftToImportable({ ...proposal.draft, courses: selected }),
    existingCourses,
    existingSchedules,
    bell: effectiveBell,
  });
  if (recheck.counts.blockers > 0) {
    return { ok: false, code: "BLOCKED", message: "课表导入仍存在待处理问题，请先修正。" };
  }
  if (recheck.resolvedCourses.length === 0) {
    return { ok: false, code: "EMPTY_SELECTION", message: "没有可导入的课程。" };
  }

  // 3. 生成真实持久化 ID + courseId 引用
  const newCourses: Course[] = recheck.resolvedCourses.map((c) => ({
    id: createId("c"),
    name: c.name,
    code: c.code ?? "",
    teacher: c.teacher ?? "",
    classroom: c.classroom ?? "",
    credit: c.credit ?? 0,
    bgHex: "",
    borderHex: "",
    textHex: "",
    description: "",
    materials: [],
  }));
  const courseIdByKey = new Map<string, string>();
  newCourses.forEach((c, i) => courseIdByKey.set(recheck.resolvedCourses[i].draftKey, c.id));

  const newSchedules: CourseSchedule[] = [];
  for (const c of recheck.resolvedCourses) {
    const courseId = courseIdByKey.get(c.draftKey);
    if (!courseId) continue;
    for (const s of c.slots) {
      newSchedules.push({
        id: createId("s"),
        courseId,
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
        location: s.location ?? "",
        weeks: s.weekExpression,
      });
    }
  }

  // 4. 一次原子写入（不逐项执行）
  deps.importSchedules(newCourses, newSchedules, { source: "kiro" });

  return {
    ok: true,
    applied: { courses: newCourses.length, slots: newSchedules.length },
    courseIds: newCourses.map((c) => c.id),
    scheduleIds: newSchedules.map((s) => s.id),
  };
}
