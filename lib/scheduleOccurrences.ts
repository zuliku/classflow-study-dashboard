/**
 * Schedule Occurrence Override Domain（Task 7 基础设施）：
 * 唯一 Effective Occurrence Resolver —— Timeline / Course Card / conflict detector / next-session 全部
 * 通过本模块看到同一套「base + moved + extra」课程位置，禁止各自解释 Override。
 * 纯函数：无 React / 无 Store mutation。
 */

import { CourseSchedule, ScheduleOccurrenceOverride } from "@/types";
import { isScheduleActive } from "@/lib/schedule";

export interface EffectiveCourseOccurrence {
  /** occurrenceId 别名：与 TimetableGrid / conflict detector 的 schedule 语义兼容 */
  id: string;
  occurrenceId: string;
  courseId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  location: string;
  week: number;
  /** base / moved 沿用基础排课的 weeks（extra 为该周单次，weeks 仅结构兼容） */
  weeks: string;
  source: "base" | "moved" | "extra";
  /** base / moved：来源 recurring schedule；extra 无 */
  baseScheduleId?: string;
  overrideId?: string;
}

/**
 * 解析某一教学周的 Effective Occurrences（唯一 Source of Truth）：
 * 1. base：isScheduleActive 判断该周是否生效（weeks / 单双周 / excludedWeeks 继续尊重）
 * 2. cancel / move override：对应 baseScheduleId+week 的 base 消失；move 加入目标位置
 * 3. extra override：直接加入该周
 * 同一 baseScheduleId+week 的多个 active override 由创建层保证唯一（validateScheduleOccurrenceOverride）。
 */
export function resolveCourseOccurrencesForWeek(input: {
  schedules: CourseSchedule[];
  overrides: ScheduleOccurrenceOverride[];
  week: number;
  totalWeeks: number;
}): EffectiveCourseOccurrence[] {
  const { schedules, overrides, week, totalWeeks } = input;
  const out: EffectiveCourseOccurrence[] = [];

  // 该周对应的 override（cancel / move 按 baseScheduleId；extra 直接按周）
  const cancelKeys = new Set(
    overrides
      .filter((o): o is Extract<ScheduleOccurrenceOverride, { kind: "cancel" }> => o.kind === "cancel" && o.week === week)
      .map((o) => o.baseScheduleId)
  );
  const moves = overrides.filter((o): o is Extract<ScheduleOccurrenceOverride, { kind: "move" }> => o.kind === "move" && o.week === week);
  const moveBySchedule = new Map(moves.map((o) => [o.baseScheduleId, o]));
  const extras = overrides.filter((o): o is Extract<ScheduleOccurrenceOverride, { kind: "extra" }> => o.kind === "extra" && o.week === week);

  for (const sch of schedules) {
    if (!isScheduleActive(sch, week)) continue;
    if (cancelKeys.has(sch.id)) continue;
    const move = moveBySchedule.get(sch.id);
    if (move) {
      out.push({
        id: `occ_${move.id}`,
        occurrenceId: `occ_${move.id}`,
        courseId: move.courseId,
        dayOfWeek: move.dayOfWeek,
        startTime: move.startTime,
        endTime: move.endTime,
        location: move.location || sch.location,
        week,
        weeks: sch.weeks,
        source: "moved",
        baseScheduleId: sch.id,
        overrideId: move.id,
      });
      continue;
    }
    out.push({
      id: `occ_${sch.id}_w${week}`,
      occurrenceId: `occ_${sch.id}_w${week}`,
      courseId: sch.courseId,
      dayOfWeek: sch.dayOfWeek,
      startTime: sch.startTime,
      endTime: sch.endTime,
      location: sch.location,
      week,
      weeks: sch.weeks,
      source: "base",
      baseScheduleId: sch.id,
    });
  }

  for (const o of extras) {
    out.push({
      id: `occ_${o.id}`,
      occurrenceId: `occ_${o.id}`,
      courseId: o.courseId,
      dayOfWeek: o.dayOfWeek,
      startTime: o.startTime,
      endTime: o.endTime,
      location: o.location,
      week,
      weeks: "1-16周",
      source: "extra",
      overrideId: o.id,
    });
  }

  return out;
}

export interface ScheduleOccurrenceOverrideInput {
  kind: "cancel" | "move" | "extra";
  courseId: string;
  baseScheduleId?: string;
  week: number;
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
  location?: string;
}

/** 创建前校验：同 baseScheduleId+week 唯一性 + move/extra target 与「该周有效课程」的硬冲突 */
export function validateScheduleOccurrenceOverride(
  input: ScheduleOccurrenceOverrideInput,
  state: {
    schedules: CourseSchedule[];
    overrides: ScheduleOccurrenceOverride[];
    totalWeeks: number;
    courses: { id: string; name: string }[];
  }
): { ok: true } | { ok: false; code: "INVALID_INPUT" | "CONFLICT" | "DUPLICATE"; message: string } {
  const { kind, baseScheduleId, week } = input;
  if (!Number.isInteger(week) || week < 1 || week > state.totalWeeks) {
    return { ok: false, code: "INVALID_INPUT", message: "教学周必须在学期范围内。" };
  }

  // cancel / move 需要 base schedule 且唯一
  if (kind === "cancel" || kind === "move") {
    if (!baseScheduleId) {
      return { ok: false, code: "INVALID_INPUT", message: "cancel / move 必须指定基础排课时段。" };
    }
    const base = state.schedules.find((s) => s.id === baseScheduleId);
    if (!base) return { ok: false, code: "INVALID_INPUT", message: "未找到对应的基础排课时段。" };
    const existing = state.overrides.find(
      (o) => o.week === week && o.kind !== "extra" && o.baseScheduleId === baseScheduleId
    );
    if (existing) {
      return {
        ok: false,
        code: "DUPLICATE",
        message: `第 ${week} 周该时段已存在临时调整（${existing.kind === "cancel" ? "停课" : "调课"}），请替换而不是叠加。`,
      };
    }
  }

  if (kind === "extra") {
    if (!input.dayOfWeek || !input.startTime || !input.endTime) {
      return { ok: false, code: "INVALID_INPUT", message: "补课必须提供星期与时间。" };
    }
  }

  if (kind === "move") {
    if (
      !input.dayOfWeek ||
      !input.startTime ||
      !input.endTime ||
      input.endTime <= input.startTime
    ) {
      return { ok: false, code: "INVALID_INPUT", message: "调课必须提供合法的新时间。" };
    }
  }

  // 冲突检查：基于该周 effective occurrences（course ↔ course 仍是 hard conflict）
  if (kind === "move" || kind === "extra") {
    const target: EffectiveCourseOccurrence = {
      id: "__candidate__",
      occurrenceId: "__candidate__",
      courseId: input.courseId,
      dayOfWeek: input.dayOfWeek!,
      startTime: input.startTime!,
      endTime: input.endTime!,
      location: input.location ?? "",
      week,
      weeks: "1-16周",
      source: kind === "move" ? "moved" : "extra",
      baseScheduleId: kind === "move" ? baseScheduleId : undefined,
    };
    const weekOccurrences = resolveCourseOccurrencesForWeek({
      schedules: state.schedules,
      overrides: state.overrides,
      week,
      totalWeeks: state.totalWeeks,
    });
    // 冲突源 = 该周其他 effective occurrences（course ↔ course 硬冲突，含同课程其他时段；
    // move 仅排除被它替换的 original）
    const others = weekOccurrences.filter(
      (o) => !(kind === "move" && o.baseScheduleId === baseScheduleId)
    );
    const s = timeToMinutes(target.startTime) ?? 0;
    const e = timeToMinutes(target.endTime) ?? 0;
    for (const o of others) {
      if (o.dayOfWeek !== target.dayOfWeek) continue;
      const os = timeToMinutes(o.startTime) ?? 0;
      const oe = timeToMinutes(o.endTime) ?? 0;
      if (s < oe && os < e) {
        const course = state.courses.find((c) => c.id === o.courseId);
        return {
          ok: false,
          code: "CONFLICT",
          message: `第 ${week} 周该时间与《${course?.name ?? "另一门课"}》冲突，未创建临时调整。`,
        };
      }
    }
  }

  return { ok: true };
}

function timeToMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** 用户可读的临时调整描述（Course Detail / Read Tool 展示用） */
export function describeScheduleOccurrenceOverride(
  o: ScheduleOccurrenceOverride,
  courseName?: string
): string {
  const dayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const course = courseName ? `《${courseName}》` : "";
  if (o.kind === "cancel") return `${course}第 ${o.week} 周停课`;
  if (o.kind === "move")
    return `${course}第 ${o.week} 周调至 ${dayNames[o.dayOfWeek - 1]} ${o.startTime}–${o.endTime}`;
  return `${course}第 ${o.week} 周补课 ${dayNames[o.dayOfWeek - 1]} ${o.startTime}–${o.endTime}`;
}
