/**
 * Schedule Import Preview Fingerprint：
 * 基于「原始导入草稿 + 已有 store 摘要」的确定性指纹。
 * - 不含 Bell Schedule 派生时间（bell 配置变化不误判 stale；由 blocker 检查管控）
 * - 包含已有课程/排课摘要（store 变化 → stale → Apply 0 mutation）
 */
import { ImportableCourseDraft } from "@/lib/scheduleImport/types";

export interface FingerprintExisting {
  existingCourses: Array<{ name: string; code?: string | null; teacher?: string | null }>;
  existingSchedules: Array<{
    id: string;
    courseId: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    weeks: string;
  }>;
}

function sortKey(items: Array<{ id: string }>): string {
  return items
    .map((i) => i.id)
    .sort()
    .join("|");
}

export function computeScheduleImportFingerprint(
  courses: ImportableCourseDraft[],
  existing: FingerprintExisting
): string {
  const canonicalCourses = courses.map((c) => ({
    key: c.draftKey,
    n: c.name,
    code: c.code ?? null,
    teacher: c.teacher ?? null,
    classroom: c.classroom ?? null,
    slots: c.slots.map((s) => ({
      d: s.dayOfWeek,
      ps: s.periodStart ?? null,
      pe: s.periodEnd ?? null,
      st: s.startTime ?? null,
      et: s.endTime ?? null,
      w: s.weekExpression ?? null,
      l: s.location ?? null,
    })),
  }));
  const canonicalExisting = {
    courses: existing.existingCourses.map((c) => `${c.name}::${c.code ?? ""}::${c.teacher ?? ""}`).sort(),
    schedules: existing.existingSchedules
      .map((s) => `${s.id}::${s.courseId}::${s.dayOfWeek}::${s.startTime}::${s.endTime}::${s.weeks}`)
      .sort(),
    // schedules 集合变化顺序不影响语义；用集合成员 + 摘要即可
    scheduleSet: sortKey(existing.existingSchedules),
  };
  return JSON.stringify({ courses: canonicalCourses, existing: canonicalExisting });
}
