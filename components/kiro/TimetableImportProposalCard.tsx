"use client";

import React, { useMemo, useState } from "react";
import { CalendarPlus, Image as ImageIcon, ListChecks, TriangleAlert, X, Check } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { TimetableImportProposal } from "@/lib/ai/timetableImport/types";
import { applyTimetableImport } from "@/lib/ai/timetableImport/executor";
import { resolveLiveImageSources } from "@/lib/ai/attachments/liveImageRegistry";
import { KiroImagePreviewDialog } from "@/components/kiro/KiroImagePreviewDialog";
import { TimetableImportPreviewDialog } from "@/components/kiro/TimetableImportPreviewDialog";
import { cn } from "@/lib/utils";
import { Course, CourseSchedule } from "@/types";

/**
 * Timetable Import Proposal Card（Visual Timetable Import）：
 * 摘要卡（不塞全部 slots）→「查看导入预览」打开完整分组预览 →
 * 用户核对/跳过/设置作息时间 →「导入全部课程」一次性原子写入。
 * Apply 永远走 applyTimetableImport（stale + blockers 检查；0 mutation 失败路径）。
 */
export function TimetableImportProposalCard({ proposal }: { proposal: TimetableImportProposal }) {
  const pushToast = useToastStore((s) => s.pushToast);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<{ courses: number; slots: number } | null>(null);

  const sources = useMemo(() => resolveLiveImageSources(proposal.sourceAttachmentIds), [proposal.sourceAttachmentIds]);

  const counts = proposal.preview.counts;
  const blockerCount = counts.blockers;
  const warningCount = counts.warnings;
  const pendingCount = proposal.draft.pendingItems?.length ?? 0;

  const runApply = (skipCourseKeys: Set<string>) => {
    setApplying(true);
    const store = useAppStore.getState();
    const result = applyTimetableImport(
      proposal,
      {
        getState: () => useAppStore.getState(),
        importSchedules: (courses, schedules, ctx) =>
          useAppStore.getState().importSchedules(courses as Course[], schedules as CourseSchedule[], ctx),
      },
      { skipCourseKeys }
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

      {/* Body：数量 + 问题摘要 + 来源缩略图 */}
      <div className="px-3 pb-3 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold text-satin-grey">
            {proposal.sourceAttachmentIds.length} 张图片 · {counts.courses} 门课程 · {counts.slots} 个上课时段
          </span>
          {pendingCount > 0 && (
            <span className="text-[10px] font-bold text-warning bg-warning-bg border border-warning-border px-1.5 py-px rounded-full">
              {pendingCount} 项需确认
            </span>
          )}
          {blockerCount > 0 && (
            <span className="text-[10px] font-bold text-danger bg-danger-bg border border-danger-border px-1.5 py-px rounded-full">
              {blockerCount} 项需处理
            </span>
          )}
          {warningCount > 0 && (
            <span className="text-[10px] font-semibold text-sandrift bg-alabaster px-1.5 py-px rounded-full">
              {warningCount} 项提示
            </span>
          )}
        </div>

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

        {blockerCount === 0 && !applied && (
          <button
            type="button"
            disabled={applying}
            onClick={() => runApply(new Set())}
            className={cn(
              "w-full h-8 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black transition-colors",
              applying && "opacity-60 cursor-wait"
            )}
          >
            {applying ? "导入中…" : `导入全部课程（${counts.courses} 门 · ${counts.slots} 个时段）`}
          </button>
        )}
        {blockerCount > 0 && (
          <p className="flex items-center gap-1 text-[10px] font-semibold text-warning">
            <TriangleAlert className="w-3 h-3 shrink-0" />
            存在待处理问题（如缺少作息时间设置），请先打开预览处理。
          </p>
        )}
      </div>

      <TimetableImportPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        proposal={proposal}
        sourceAttachments={sources}
        onApply={(skip) => runApply(skip)}
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
