/**
 * Free Time Engine（纯函数，无 React、无 AI）。
 * 在 08:00–21:00 规划窗口内计算空闲时段：
 * - Busy：当前教学周生效的课程（isScheduleActive）、带时间的 Exam/Activity、已有 StudyBlock
 * - DDL mark 不是 busy（它只是 planning upper bound）
 * - All-day 的 exam/activity 视为整天 blocked（普通 DDL all-day 不算）
 * - 今天不返回过去时间（15min grid ceil）；Deadline 当天不返回 Deadline 之后的时间
 */

import { CalendarMark, CourseSchedule, Semester, StudyBlock } from "@/types";
import { isScheduleActive } from "@/lib/schedule";
import { getSemesterWeek } from "@/lib/semester";

export interface FreeTimeQuery {
  start: Date;
  end: Date;
  semester: Semester;
  currentSemesterWeek: number;
  schedules: CourseSchedule[];
  calendarMarks: CalendarMark[];
  studyBlocks: StudyBlock[];
  /** 规划窗口起点（默认 08:00） */
  dayStartMinutes?: number;
  /** 规划窗口终点（默认 21:00） */
  dayEndMinutes?: number;
  /** 单天截止时刻覆盖（如 Deadline 当天：最多到 Deadline 时刻；key = "YYYY-MM-DD"） */
  dayCapMinutesByDate?: Record<string, number>;
  minimumSlotMinutes?: number;
}

export interface FreeTimeSlot {
  date: string; // "YYYY-MM-DD"
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  minutes: number;
}

export const FREE_TIME_DAY_START = 8 * 60;
export const FREE_TIME_DAY_END = 21 * 60;
export const FREE_TIME_MIN_SLOT = 30;

interface BusyInterval {
  start: number;
  end: number;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function minutesToHM(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${pad2(Math.floor(m / 60) % 24)}:${pad2(m % 60)}`;
}

function dateStrOf(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseHM(time: string | undefined): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 合并重叠区间 */
function mergeBusy(intervals: BusyInterval[]): BusyInterval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: BusyInterval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start < last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      out.push({ ...iv });
    }
  }
  return out;
}

export function findFreeTime(query: FreeTimeQuery): FreeTimeSlot[] {
  const dayStart = query.dayStartMinutes ?? FREE_TIME_DAY_START;
  const dayEnd = query.dayEndMinutes ?? FREE_TIME_DAY_END;
  const minSlot = query.minimumSlotMinutes ?? FREE_TIME_MIN_SLOT;
  const start = new Date(query.start);
  const end = new Date(query.end);
  if (end.getTime() <= start.getTime()) return [];

  const now = new Date();
  const todayStr = dateStrOf(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const slots: FreeTimeSlot[] = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);

  // 逐日扫描（start..end 含当天）
  while (cursor.getTime() <= end.getTime()) {
    const date = dateStrOf(cursor);
    const week = Math.min(Math.max(getSemesterWeek(cursor, query.semester), 1), query.semester.totalWeeks);
    const dow = cursor.getDay() === 0 ? 7 : cursor.getDay();
    const inSemester =
      cursor.getTime() >= new Date(`${query.semester.startDate}T00:00:00`).getTime() &&
      week >= 1 && week <= query.semester.totalWeeks;

    const busy: BusyInterval[] = [];

    // 生效课程（当前周 + 星期匹配）
    if (inSemester) {
      for (const s of query.schedules) {
        if (s.dayOfWeek !== dow) continue;
        if (!isScheduleActive(s, week)) continue;
        const ss = parseHM(s.startTime);
        const se = parseHM(s.endTime);
        if (ss === null || se === null || se <= ss) continue;
        busy.push({ start: ss, end: se });
      }
    }

    // 带时间的 Exam / Activity（interval 语义；DDL 不是 busy）
    for (const m of query.calendarMarks) {
      if (m.date !== date) continue;
      if (m.type === "course") continue;
      if (m.type === "ddl") continue; // DDL 只是 planning upper bound，不是 busy
      const ss = parseHM(m.startTime);
      const se = parseHM(m.endTime);
      if (ss !== null && se !== null && se > ss) {
        busy.push({ start: ss, end: se });
      } else {
        // All-day 的 exam/activity → 整天 blocked
        busy.push({ start: 0, end: 1440 });
      }
    }

    // 已有 StudyBlock（避免重复排程）
    for (const b of query.studyBlocks) {
      if (b.date !== date) continue;
      const bs = parseHM(b.startTime);
      const be = parseHM(b.endTime);
      if (bs === null || be === null || be <= bs) continue;
      busy.push({ start: bs, end: be });
    }

    // 当天窗口边界
    const windowStart = dayStart;
    const cap = query.dayCapMinutesByDate?.[date];
    const windowEnd = Math.min(dayEnd, cap ?? dayEnd);
    if (windowEnd <= windowStart) {
      cursor.setDate(cursor.getDate() + 1);
      continue;
    }

    // 今天：不返回过去时间（15min grid ceil）
    let effectiveStart = windowStart;
    if (date === todayStr) {
      const ceil15 = Math.ceil(nowMinutes / 15) * 15;
      effectiveStart = Math.max(windowStart, ceil15);
    }

    // busy 裁剪到窗口内
    const clipped = mergeBusy(
      busy
        .map((b) => ({
          start: Math.max(b.start, windowStart),
          end: Math.min(b.end, windowEnd),
        }))
        .filter((b) => b.end > b.start)
    );

    // complement
    let freeStart = effectiveStart;
    for (const b of clipped) {
      if (b.start > freeStart) {
        const freeEnd = Math.min(b.start, windowEnd);
        if (freeEnd > freeStart) {
          const minutes = freeEnd - freeStart;
          if (minutes >= minSlot) {
            slots.push({ date, startTime: minutesToHM(freeStart), endTime: minutesToHM(freeEnd), minutes });
          }
        }
      }
      freeStart = Math.max(freeStart, b.end);
    }
    if (freeStart < windowEnd) {
      const minutes = windowEnd - freeStart;
      if (minutes >= minSlot) {
        slots.push({ date, startTime: minutesToHM(freeStart), endTime: minutesToHM(windowEnd), minutes });
      }
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return slots;
}
