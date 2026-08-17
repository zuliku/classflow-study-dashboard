import { CourseSchedule, ScheduleConflict } from "@/types";
import { findScheduleConflicts } from "@/lib/conflicts";
import { timeToMinutes } from "@/lib/schedule";

/** 完整课表工作区时间边界（与 TimetableGrid 渲染一致）：08:00–21:00 */
export const TIMETABLE_DAY_START_MINUTES = 8 * 60;
export const TIMETABLE_DAY_END_MINUTES = 21 * 60;
export const TIMETABLE_TOTAL_MINUTES =
  TIMETABLE_DAY_END_MINUTES - TIMETABLE_DAY_START_MINUTES;
export const TIMETABLE_DAY_COUNT = 7;

/** 15 分钟吸附间隔 */
export const SNAP_INTERVAL = 15;

/** 最短课程时长（Resize 下限） */
export const MIN_SCHEDULE_DURATION = 30;

/**
 * 15 分钟吸附：Math.round(minutes / 15) * 15。
 * UI 与 Store 共用这一唯一实现，禁止两套算法。
 */
export function snapMinutes(minutes: number, interval: number = SNAP_INTERVAL): number {
  return Math.round(minutes / interval) * interval;
}

/** 分钟数 → "HH:mm"（输入按 0–1439 范围合法化） */
export function minutesToTime(minutes: number): string {
  const m = Math.round(minutes);
  const hh = Math.floor(m / 60) % 24;
  const mm = ((m % 60) + 60) % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** 课程时长（分钟）；非法时间回退为最短时长 */
export function getScheduleDuration(schedule: CourseSchedule): number {
  const start = timeToMinutes(schedule.startTime);
  const end = timeToMinutes(schedule.endTime);
  if (start === null || end === null) return MIN_SCHEDULE_DURATION;
  return Math.max(end - start, MIN_SCHEDULE_DURATION);
}

/** 将分钟数 clamp 到工作区 [08:00, 21:00] */
export function clampMinutes(minutes: number): number {
  return Math.min(
    Math.max(minutes, TIMETABLE_DAY_START_MINUTES),
    TIMETABLE_DAY_END_MINUTES
  );
}

/**
 * Move 起始时间 clamp：保持时长不变，start ∈ [08:00, 21:00 - duration]。
 */
export function clampScheduleMove(
  schedule: CourseSchedule,
  startMinutes: number
): number {
  const duration = getScheduleDuration(schedule);
  const maxStart = TIMETABLE_DAY_END_MINUTES - duration;
  return Math.min(
    Math.max(Math.round(startMinutes), TIMETABLE_DAY_START_MINUTES),
    maxStart
  );
}

/**
 * Pointer 坐标 → 课表分钟（包含 grid rect 偏移；scrollLeft 已被 getBoundingClientRect 吸收）。
 */
export function pointerToMinutes(
  clientY: number,
  rectTop: number,
  rectHeight: number
): number {
  if (rectHeight <= 0) return TIMETABLE_DAY_START_MINUTES;
  const ratio = (clientY - rectTop) / rectHeight;
  return TIMETABLE_DAY_START_MINUTES + ratio * TIMETABLE_TOTAL_MINUTES;
}

/** Pointer 坐标 → 星期列索引（0–6，周一=0）；跨出左右边界时 clamp */
export function pointerToDayIndex(
  clientX: number,
  rectLeft: number,
  rectWidth: number
): number {
  if (rectWidth <= 0) return 0;
  const index = Math.floor(((clientX - rectLeft) / rectWidth) * TIMETABLE_DAY_COUNT);
  return Math.min(Math.max(index, 0), TIMETABLE_DAY_COUNT - 1);
}

/**
 * Drag Move：保持时长不变，吸附 start 并 clamp 到工作区。
 * offsetMinutes = pointerdown 时 pointer 相对课程 start 的偏移，保证不跳变。
 * 只修改 dayOfWeek / startTime / endTime，weeks/excludedWeeks 等字段原样保留。
 */
export function calculateDraggedSchedule(
  schedule: CourseSchedule,
  pointerMinutes: number,
  offsetMinutes: number,
  dayOfWeek: number
): CourseSchedule {
  const duration = getScheduleDuration(schedule);
  const start = clampScheduleMove(
    schedule,
    snapMinutes(pointerMinutes - offsetMinutes)
  );
  return {
    ...schedule,
    dayOfWeek,
    startTime: minutesToTime(start),
    endTime: minutesToTime(start + duration),
  };
}

/**
 * Resize：只修改 endTime（15 分钟吸附，最短 30 分钟，不超过 21:00）。
 * dayOfWeek / startTime 保持不变。
 */
export function calculateResizedSchedule(
  schedule: CourseSchedule,
  pointerMinutes: number
): CourseSchedule {
  const start = timeToMinutes(schedule.startTime) ?? TIMETABLE_DAY_START_MINUTES;
  let end = snapMinutes(pointerMinutes);
  const minEnd = start + MIN_SCHEDULE_DURATION;
  end = Math.min(Math.max(end, minEnd), TIMETABLE_DAY_END_MINUTES);
  // 课程起点贴近 21:00 时（如 20:45 起），上界优先于 30 分钟下限
  if (end <= start) end = TIMETABLE_DAY_END_MINUTES;
  return { ...schedule, endTime: minutesToTime(end) };
}

export interface ScheduleCandidateValidation {
  valid: boolean;
  conflict: ScheduleConflict | null;
}

/**
 * 候选排课校验：复用 findScheduleConflicts（星期 + 时间重叠 + 共同生效周），
 * 排除自身原 schedule，只关心与候选时段相关的冲突。
 */
export function validateScheduleCandidate(
  candidate: CourseSchedule,
  allSchedules: CourseSchedule[],
  excludeScheduleId: string
): ScheduleCandidateValidation {
  const others = allSchedules.filter((s) => s.id !== excludeScheduleId);
  // ignoreSameCourse：拖动/调整某门课的卡片时，与同课程其它时段的重叠不属于跨课程冲突
  const conflicts = findScheduleConflicts([...others, candidate], { ignoreSameCourse: true });
  const conflict =
    conflicts.find(
      (c) => c.scheduleA.id === candidate.id || c.scheduleB.id === candidate.id
    ) ?? null;
  return { valid: !conflict, conflict };
}
