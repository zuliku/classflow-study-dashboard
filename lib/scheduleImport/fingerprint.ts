/**
 * Schedule Import Preview Fingerprint：
 * Apply 前基于最新 Store 重算，与 Preview 时不一致 → stale → 0 mutation。
 */
import { ResolvedCourseImport } from "@/lib/scheduleImport/types";

export function computeScheduleImportFingerprint(courses: ResolvedCourseImport[]): string {
  const canonical = courses.map((c) => ({
    n: c.name,
    code: c.code ?? null,
    teacher: c.teacher ?? null,
    classroom: c.classroom ?? null,
    slots: c.slots.map((s) => ({
      d: s.dayOfWeek,
      st: s.startTime,
      et: s.endTime,
      w: s.weekExpression,
      l: s.location ?? null,
    })),
  }));
  return JSON.stringify(canonical);
}
