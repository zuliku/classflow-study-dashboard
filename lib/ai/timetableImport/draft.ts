/**
 * Timetable Import Draft 纯函数：
 * - getTimetableDraftCounts：Extraction Counts（AI 识别数量，与 preflight 无关）
 * - mergeAdjacentTimetableSlots：连续相同课表单元格合并（第7节+第8节 → 7-8）
 */
import { TimetableImportCourseDraft, TimetableImportDraft } from "@/lib/ai/timetableImport/types";
import { normalizeWeekExpression } from "@/lib/scheduleWeekExpression";

export interface TimetableDraftCounts {
  courses: number;
  slots: number;
  pending: number;
}

/** Extraction Counts：从图片识别到的课程/时段数量（不等于可导入数量） */
export function getTimetableDraftCounts(draft: TimetableImportDraft): TimetableDraftCounts {
  return {
    courses: draft.courses.length,
    slots: draft.courses.reduce((n, c) => n + c.slots.length, 0),
    pending: draft.pendingItems?.length ?? 0,
  };
}

function normalizeLocation(loc: string | undefined): string {
  return (loc ?? "").trim();
}

function isPeriodSlot(s: { periodStart?: number; periodEnd?: number }): boolean {
  return typeof s.periodStart === "number";
}

/**
 * 连续相同单元格合并（deterministic normalization，不依赖模型自觉合并）。
 * 合并条件：同一课程 / 同一星期 / 归一化周次相同 / 归一化地点相同 /
 * 节次连续（b.periodStart === a.periodEnd + 1）。
 * 例如 7-7 + 8-8 → 7-8；9-10 + 11-11 → 9-11。
 * 无节次（已含具体时间）或条件不满足的 slot 保持不变。
 */
export function mergeAdjacentTimetableSlots(
  courses: TimetableImportCourseDraft[]
): TimetableImportCourseDraft[] {
  return courses.map((course) => {
    const slots = [...course.slots];
    if (slots.length < 2) return course;
    const merged: typeof slots = [];
    for (const slot of slots) {
      const prev = merged[merged.length - 1];
      if (
        prev &&
        isPeriodSlot(prev) &&
        isPeriodSlot(slot) &&
        prev.dayOfWeek === slot.dayOfWeek &&
        normalizeWeekExpression(prev.weekExpression) === normalizeWeekExpression(slot.weekExpression) &&
        normalizeLocation(prev.location) === normalizeLocation(slot.location) &&
        (slot.periodStart ?? 0) === (prev.periodEnd ?? prev.periodStart ?? 0) + 1
      ) {
        merged[merged.length - 1] = {
          ...prev,
          periodEnd: slot.periodEnd ?? slot.periodStart,
          evidence: prev.evidence ?? slot.evidence,
        };
      } else {
        merged.push(slot);
      }
    }
    return { ...course, slots: merged };
  });
}
