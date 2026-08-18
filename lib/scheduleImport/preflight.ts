/**
 * Schedule Import Preflight（共享确定性校验）。
 * Preview 前运行：schema/required/dayOfWeek/weekExpression/period/duplicate/conflict。
 * blocker 未解决时禁止最终 Apply；绝不静默丢弃识别不确定的行（转 warning issue）。
 */
import {
  BellScheduleTemplate,
  ImportableCourseDraft,
  ImportIssue,
  ResolvedCourseImport,
} from "@/lib/scheduleImport/types";
import { resolvePeriodTime } from "@/lib/scheduleImport/periodResolver";
import { findImportDuplicateCourse, ImportDuplicateCandidate } from "@/lib/scheduleImport/duplicate";
import {
  parseWeekExpression,
  parseWeekExpressionStrict,
  normalizeWeekExpression,
  getMaxActiveWeek,
} from "@/lib/scheduleWeekExpression";
import { isValidTimeRange } from "@/lib/schedule";
import { findScheduleConflicts } from "@/lib/conflicts";
import { CourseSchedule } from "@/types";
import { computeScheduleImportFingerprint } from "@/lib/scheduleImport/fingerprint";

export const IMPORT_DEFAULT_WEEKS = "1-16周";

export interface ScheduleImportPreflightInput {
  courses: ImportableCourseDraft[];
  /** 已有课程（duplicate 检测用） */
  existingCourses: ImportDuplicateCandidate[];
  /** 已有排课（conflict 检测用；含已解析 slots） */
  existingSchedules: CourseSchedule[];
  /** 当前用户配置的 Bell Schedule（未配置 → 节次无法解析为 blocker） */
  bell: BellScheduleTemplate | null | undefined;
}

export interface ScheduleImportPreflightResult {
  ok: boolean;
  /** 解析后的可导入课程（含空 slots 的课程不进入） */
  resolvedCourses: ResolvedCourseImport[];
  issues: ImportIssue[];
  fingerprint: string;
  counts: {
    courses: number;
    slots: number;
    blockers: number;
    warnings: number;
  };
}

function dayLabel(day: number): string {
  return ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"][day] ?? String(day);
}

export interface ScheduleImportPreflightOptions {
  /**
   * strictWeeks（Vision 课表导入）：周次必须完整消费、且不允许缺失。
   * - 空 weekExpression → missing-information blocker（绝不自动按 1-16）
   * - 表达式有任何非法段 → invalid-week-expression blocker
   * 传统手动导入（ICS/CSV/JSON）保持兼容语义（缺失 → 默认 1-16，容错解析）。
   */
  strictWeeks?: boolean;
}

export function preflightScheduleImport(
  input: ScheduleImportPreflightInput,
  options: ScheduleImportPreflightOptions = {}
): ScheduleImportPreflightResult {
  const issues: ImportIssue[] = [];
  const resolvedCourses: ResolvedCourseImport[] = [];
  const allResolvedSlots: CourseSchedule[] = [];

  for (const course of input.courses) {
    const name = (course.name ?? "").trim();
    if (!name) {
      issues.push({
        code: "missing-information",
        severity: "blocker",
        courseKey: course.draftKey,
        message: "课程名称缺失，请补充后继续。",
      });
      continue;
    }

    // 重复检测：与已有课程 + 本次其它课程
    const candidates: ImportDuplicateCandidate[] = [
      ...input.existingCourses,
      ...input.courses
        .filter((c) => c.draftKey !== course.draftKey)
        .map((c) => ({ name: c.name, code: c.code, teacher: c.teacher })),
    ];
    const dup = findImportDuplicateCourse(course, candidates);
    if (dup) {
      issues.push({
        code: "duplicate-course",
        severity: "warning",
        courseKey: course.draftKey,
        message: `与《${dup.name}》${dup.code ? `（${dup.code}）` : dup.teacher ? `（${dup.teacher}）` : ""}重复，默认跳过，可改为仍导入。`,
      });
    }

    const slots: ResolvedCourseImport["slots"] = [];
    course.slots.forEach((slot, slotIndex) => {
      const day = slot.dayOfWeek;
      if (!Number.isInteger(day) || day < 1 || day > 7) {
        issues.push({
          code: "missing-information",
          severity: "blocker",
          courseKey: course.draftKey,
          slotIndex,
          message: `《${name}》有上课时段缺少星期信息。`,
        });
        return;
      }

      // 周次表达式：strict（Vision）不允许缺失/非法；legacy 缺失默认全学期
      const rawWeeks = (slot.weekExpression ?? "").trim();
      let weeksExpr: string;
      if (options.strictWeeks) {
        if (!rawWeeks) {
          issues.push({
            code: "missing-information",
            severity: "blocker",
            courseKey: course.draftKey,
            slotIndex,
            message: `《${name}》缺少周次信息，无法确认教学周，请补充（如 1-5,7-17）。`,
          });
          return;
        }
        if (!parseWeekExpressionStrict(rawWeeks)) {
          issues.push({
            code: "invalid-week-expression",
            severity: "blocker",
            courseKey: course.draftKey,
            slotIndex,
            message: `《${name}》的周次"${rawWeeks}"无法识别，请修正。`,
          });
          return;
        }
        weeksExpr = normalizeWeekExpression(rawWeeks);
      } else {
        weeksExpr = rawWeeks || IMPORT_DEFAULT_WEEKS;
        if (!parseWeekExpression(weeksExpr)) {
          issues.push({
            code: "invalid-week-expression",
            severity: "blocker",
            courseKey: course.draftKey,
            slotIndex,
            message: `《${name}》的周次"${rawWeeks}"无法识别，请修正。`,
          });
          return;
        }
      }

      // 时间：节次 → Bell Schedule；或已有时间
      let startTime: string | undefined;
      let endTime: string | undefined;
      if (slot.periodStart !== undefined) {
        const resolved = resolvePeriodTime(input.bell, slot.periodStart, slot.periodEnd);
        if (!resolved) {
          issues.push({
            code: "missing-period-template",
            severity: "blocker",
            courseKey: course.draftKey,
            slotIndex,
            message: `《${name}》第${slot.periodStart}${slot.periodEnd && slot.periodEnd !== slot.periodStart ? `-${slot.periodEnd}` : ""}节需要先设置学校作息时间（Bell Schedule）。`,
          });
          return;
        }
        startTime = resolved.startTime;
        endTime = resolved.endTime;
      } else {
        startTime = slot.startTime;
        endTime = slot.endTime;
      }
      if (!startTime || !endTime || !isValidTimeRange(startTime, endTime)) {
        issues.push({
          code: "missing-information",
          severity: "blocker",
          courseKey: course.draftKey,
          slotIndex,
          message: `《${name}》有上课时段缺少有效时间。`,
        });
        return;
      }

      slots.push({
        dayOfWeek: day,
        startTime,
        endTime,
        weekExpression: normalizeWeekExpression(weeksExpr),
        location: slot.location?.trim() || undefined,
      });
    });

    if (slots.length === 0) {
      // 全部 slot 失败：课程不可导入（但 issue 已记录，不静默）
      continue;
    }
    resolvedCourses.push({
      draftKey: course.draftKey,
      name,
      code: course.code?.trim() || undefined,
      teacher: course.teacher?.trim() || undefined,
      classroom: course.classroom?.trim() || undefined,
      credit: course.credit,
      slots,
    });
    for (const s of slots) {
      allResolvedSlots.push({
        id: `__import_${course.draftKey}_${allResolvedSlots.length}`,
        courseId: course.draftKey,
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
        location: s.location ?? "",
        weeks: s.weekExpression,
      });
    }
  }

  // 冲突检测：解析出的 slots（含本课程内部）与已有排课 + 本次 slots（与手动导入一致，不 ignoreSameCourse）
  const conflicts = findScheduleConflicts([...input.existingSchedules, ...allResolvedSlots]).filter(
    (conf) =>
      allResolvedSlots.some(
        (s) => conf.scheduleA.id === s.id || conf.scheduleB.id === s.id
      )
  );
  for (const conf of conflicts) {
    const mine =
      allResolvedSlots.find((s) => s.id === conf.scheduleA.id || s.id === conf.scheduleB.id);
    const other = conf.scheduleA.id === mine?.id ? conf.scheduleB : conf.scheduleA;
    const courseKey = mine?.courseId;
    issues.push({
      code: "schedule-conflict",
      severity: "warning",
      courseKey,
      message: `${dayLabel(conf.dayOfWeek)} ${conf.timeRange} 与已有排课或其它导入课程时间重叠。`,
    });
  }

  const blockers = issues.filter((i) => i.severity === "blocker").length;
  const warnings = issues.length - blockers;
  const fingerprint = computeScheduleImportFingerprint(input.courses, {
    existingCourses: input.existingCourses,
    existingSchedules: input.existingSchedules,
  });

  return {
    ok: blockers === 0,
    resolvedCourses,
    issues,
    fingerprint,
    counts: {
      courses: resolvedCourses.length,
      slots: resolvedCourses.reduce((n, c) => n + c.slots.length, 0),
      blockers,
      warnings,
    },
  };
}

export { getMaxActiveWeek };
