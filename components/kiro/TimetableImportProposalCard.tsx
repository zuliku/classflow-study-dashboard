"use client";

import React, { useMemo, useState } from "react";
import { CalendarPlus, Image as ImageIcon, TriangleAlert, X, Check } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { TimetableImportDraft, TimetableImportProposal } from "@/lib/ai/timetableImport/types";
import { BellScheduleTemplate } from "@/types";
import { applyTimetableImport } from "@/lib/ai/timetableImport/executor";
import { getTimetableDraftCounts } from "@/lib/ai/timetableImport/draft";
import { resolveLiveImageSources } from "@/lib/ai/attachments/liveImageRegistry";
import { KiroImagePreviewDialog } from "@/components/kiro/KiroImagePreviewDialog";
import { TimetableImportPreviewDialog } from "@/components/kiro/TimetableImportPreviewDialog";
import { cn } from "@/lib/utils";
import { Course, CourseSchedule } from "@/types";

/**
 * Timetable Import Proposal Card（Visual Timetable Import）：
 * 摘要卡显示【识别数量】（Extraction Counts，与 preflight 无关）→
 * 「查看导入预览」打开完整分组预览（实时重算 preflight）→
 * 用户核对/修正/跳过/设置作息时间 →「导入所选课程」一次性原子写入。
 *
 * 快速导入（不打开预览）仅当：无 blocker、无 pending、无 duplicate warning。
 * Apply 永远走 applyTimetableImport（stale + blockers 检查；0 mutation 失败路径）。
 */
export function TimetableImportProposalCard({ proposal }: { proposal: TimetableImportProposal }) {
  const pushToast = useToastStore((s) => s.pushToast);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<{ courses: number; slots: number } | null>(null);

  const sources = useMemo(() => resolveLiveImageSources(proposal.sourceAttachmentIds), [proposal.sourceAttachmentIds]);

  // Extraction Counts（AI 识别数量；即便无 Bell 也显示真实数量）
  const extraction = useMemo(() => getTimetableDraftCounts(proposal.draft), [proposal.draft]);
  const snapshotCounts = proposal.preview.counts;
  const pendingCount = extraction.pending;
  const blockerCount = snapshotCounts.blockers;
  const hasDuplicateWarning = proposal.preview.issues.some((i) => i.code === "duplicate-course");

  // 快速导入条件：pending = 0 且 blocker = 0 且无 duplicate warning
  const canQuickApply = blockerCount === 0 && pendingCount === 0 && !hasDuplicateWarning;

  const runApply = (input: {
    skipCourseKeys: Set<string>;
    editableDraft: TimetableImportDraft;
    expectedFingerprint: string;
    pendingBell: BellScheduleTemplate | null;
  }) => {
    setApplying(true);
    const result = applyTimetableImport(
      proposal,
      {
        getState: () => useAppStore.getState(),
        importSchedules: (courses, schedules, ctx) =>
          useAppStore.getState().importSchedules(courses as Course[], schedules as CourseSchedule[], ctx),
      },
      {
        skipCourseKeys: input.skipCourseKeys,
        editableDraft: input.editableDraft,
        expectedFingerprint: input.expectedFingerprint,
        pendingBell: input.pendingBell,
      }
    );
    setApplying(false);
    if (result.ok) {
      setApplied(result.applied);
      pushToast({
        message: `已导入 ${result.applied.courses} 门课程 · ${result.applied.slots} 个上课时段`,
        type: "success",
      });
    } else {
      const msg: Record<string, string> = {
        STALE: "课表预览已过期，请重新查看后再导入。",
        BLOCKED: "课表导入仍存在待处理问题，请先修正。",
        EMPTY_SELECTION: "请至少保留一门要导入的课程。",
        UNKNOWN: "导入失败，请重试。",
      };
      pushToast({ message: msg[result.code] ?? msg.UNKNOWN, type: "warning" });
    }
  };

  return (
    <div
      data-testid="timetable-import-proposal"
      className="rounded-2xl border border-line bg-surface shadow-subtle"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <span className="flex items-center justify-center w-6 h-6 rounded-lg bg-pastel-mint text-charcoal shrink-0">
          <CalendarPlus className="w-3.5 h-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-charcoal">课表导入预览</p>
          <p className="text-[10px] text-sandrift mt-0.5 truncate">
            {proposal.summary || "从课表截图识别"}
          </p>
        </div>
        {applied ? (
          <span className="shrink-0 flex items-center gap-1 text-[11px] font-bold text-success">
            <Check className="w-3.5 h-3.5" />
            已导入
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="shrink-0 text-[11px] font-bold text-charcoal bg-alabaster hover:bg-alba px-2.5 h-7 rounded-lg transition-colors"
          >
            查看导入预览
          </button>
        )}
      </div>

      {/* Body */}
      <div className="px-3 pb-3 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold text-satin-grey">
            识别到 {extraction.courses} 门课程 · {extraction.slots} 个上课时段
          </span>
          {blockerCount > 0 && (
            <span className="text-[10px] font-bold text-danger bg-danger-bg border border-danger-border px-1.5 py-px rounded-full">
              {blockerCount} 项需处理
            </span>
          )}
          {pendingCount > 0 && (
            <span className="text-[10px] font-bold text-warning bg-warning-bg border border-warning-border px-1.5 py-px rounded-full">
              {pendingCount} 项需确认
            </span>
          )}
          {hasDuplicateWarning && (
            <span className="text-[10px] font-semibold text-sandrift bg-alabaster px-1.5 py-px rounded-full">
              含重复课程
            </span>
          )}
        </div>
        {blockerCount > 0 && (
          <p className="flex items-center gap-1 text-[10px] font-semibold text-warning">
            <TriangleAlert className="w-3 h-3 shrink-0" />
            {blockerCount > 0 && snapshotCounts.blockers > 0 ? "存在待处理问题（如缺少作息时间设置），请先打开预览处理。" : ""}
          </p>
        )}

        {sources.length > 0 && (
          <button
            type="button"
            onClick={() => setImagePreviewOpen(true)}
            className="flex items-center gap-1 text-[10px] font-semibold text-sandrift hover:text-charcoal transition-colors"
            aria-label="查看课表原图"
          >
            <ImageIcon className="w-3 h-3" />
            查看原图
          </button>
        )}

        {canQuickApply && !applied && (
          <button
            type="button"
            disabled={applying}
            onClick={() =>
              runApply({
                skipCourseKeys: new Set(),
                editableDraft: proposal.draft,
                expectedFingerprint: proposal.preview.fingerprint,
                pendingBell: null,
              })
            }
            className={cn(
              "w-full h-8 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black transition-colors",
              applying && "opacity-60 cursor-wait"
            )}
          >
            {applying ? "导入中…" : `导入全部课程（${extraction.courses} 门 · ${extraction.slots} 个时段）`}
          </button>
        )}
        {!canQuickApply && !applied && (
          <p className="flex items-center gap-1 text-[10px] font-semibold text-sandrift">
            <TriangleAlert className="w-3 h-3 shrink-0" />
            请先打开预览处理待确认/重复项后导入。
          </p>
        )}
      </div>

      <TimetableImportPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        proposal={proposal}
        sourceAttachments={sources}
        onApply={runApply}
        onViewImage={() => setImagePreviewOpen(true)}
      />
      <KiroImagePreviewDialog
        source={imagePreviewOpen ? (sources[0] ?? null) : null}
        sources={sources}
        initialIndex={0}
        onClose={() => setImagePreviewOpen(false)}
      />
    </div>
  );
}
