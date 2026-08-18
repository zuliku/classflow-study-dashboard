/**
 * Timetable Import Proposal 构建（0 Store mutation）。
 * Runtime 拥有 sourceAttachmentIds / preview / fingerprint。
 */
import { createId } from "@/lib/utils";
import { TimetableImportDraft, TimetableImportProposal } from "@/lib/ai/timetableImport/types";
import { preflightScheduleImport, ScheduleImportPreflightInput } from "@/lib/scheduleImport/preflight";
import { ImportableCourseDraft } from "@/lib/scheduleImport/types";

export interface BuildTimetableImportProposalInput {
  draft: TimetableImportDraft;
  /** 当前 Turn 图片附件（frozen snapshot）；空 → 拒绝 */
  sourceAttachmentIds: string[];
  state: Pick<ScheduleImportPreflightInput, "existingCourses" | "existingSchedules"> & {
    bellSchedules: Array<{ id: string; periods: Array<{ period: number; startTime: string; endTime: string }>; name: string }>;
    activeBellScheduleId: string | null;
  };
}

export type BuildTimetableImportProposalResult =
  | { ok: true; proposal: TimetableImportProposal }
  | { ok: false; code: "SOURCE_REQUIRED" | "EMPTY_DRAFT" | "INVALID_DRAFT"; message: string };

export function buildTimetableImportProposal(
  input: BuildTimetableImportProposalInput
): BuildTimetableImportProposalResult {
  if (input.sourceAttachmentIds.length === 0) {
    return {
      ok: false,
      code: "SOURCE_REQUIRED",
      message: "课表导入需要先上传课程表截图。",
    };
  }
  const courses = input.draft.courses;
  if (!Array.isArray(courses) || courses.length === 0) {
    return { ok: false, code: "EMPTY_DRAFT", message: "未识别到任何课程。" };
  }

  // 模型草稿 → 共享 ImportableCourseDraft
  const importable: ImportableCourseDraft[] = courses.map((c) => ({
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
      evidence: s.evidence,
    })),
  }));

  const activeBell =
    input.state.bellSchedules.find((b) => b.id === input.state.activeBellScheduleId) ?? null;

  const preview = preflightScheduleImport(
    {
      courses: importable,
      existingCourses: input.state.existingCourses,
      existingSchedules: input.state.existingSchedules,
      bell: activeBell
        ? { id: activeBell.id, name: activeBell.name, periods: activeBell.periods }
        : null,
    },
    { strictWeeks: true }
  );

  const proposal: TimetableImportProposal = {
    id: createId("timport"),
    sourceAttachmentIds: [...input.sourceAttachmentIds],
    summary: input.draft.summary,
    draft: input.draft,
    preview,
    createdAt: Date.now(),
  };
  return { ok: true, proposal };
}
