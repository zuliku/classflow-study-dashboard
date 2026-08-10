"use client";

import React, { useState } from "react";
import { CalendarClock, Eye, X } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import { StudyPlanProposal } from "@/lib/planning/studyPlanner";

/**
 * Kiro Study Plan Proposal Card（事实 UI）：渲染 propose_study_plan 的确定性结果。
 * 本阶段只做 Proposal → Ghost Preview；不提供 Apply（未来 Task 4B 才实现）。
 * Ghost 是 ephemeral（不写 Store / localStorage），刷新即消失。
 */
export function StudyPlanProposalCard({ proposals }: { proposals: StudyPlanProposal[] }) {
  const [dismissed, setDismissed] = useState(false);
  const { planningPreview, setPlanningPreview } = useKiroSession();
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  if (dismissed || proposals.length === 0) return null;

  const blocks = proposals.flatMap((p) =>
    p.proposedBlocks.map((b) => ({
      id: `${p.assignmentId}-${b.date}-${b.startTime}`,
      date: b.date,
      startTime: b.startTime,
      endTime: b.endTime,
      title: p.title,
      assignmentId: p.assignmentId,
      courseId: p.courseId,
    }))
  );

  const previewActive =
    planningPreview !== null &&
    blocks.length === planningPreview.blocks.length &&
    blocks.every(
      (b, i) => planningPreview.blocks[i] && planningPreview.blocks[i].id === b.id && planningPreview.blocks[i].startTime === b.startTime
    );

  const handlePreview = () => {
    if (previewActive) {
      // 再次点击：关闭 Ghost Preview（ephemeral，消失）
      setPlanningPreview(null);
      return;
    }
    setPlanningPreview({ blocks });
    setActiveTab("timetable");
  };

  return (
    <div
      data-testid="study-plan-proposal"
      className="mt-2.5 bg-surface border border-line-strong rounded-2xl shadow-card p-3.5 space-y-3"
    >
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-charcoal">
          <CalendarClock className="w-3.5 h-3.5 text-[#A48F82]" />
          学习计划建议
        </p>
        <button
          onClick={() => setDismissed(true)}
          aria-label="关闭"
          className="p-1 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-2">
        {proposals.map((p) => (
          <div key={p.assignmentId} className="space-y-1">
            <p className="text-[11px] font-semibold text-charcoal leading-snug">{p.title}</p>
            {p.proposedBlocks.length === 0 ? (
              <p className="text-[10px] text-sandrift">已按现有学习计划排满，无需新增。</p>
            ) : (
              <>
                {p.proposedBlocks.map((b, i) => (
                  <p key={i} className="text-[10px] text-satin-grey font-mono tabular-nums">
                    {b.date.slice(5).replace("-", "/")} {b.startTime}–{b.endTime}
                  </p>
                ))}
                <p className="text-[10px] text-sandrift">
                  建议安排 {p.proposedMinutes} 分钟 / 预计 {p.estimatedMinutes ?? "未知"}
                  {p.scheduledMinutes > 0 ? `（已计划 ${p.scheduledMinutes} 分钟）` : ""}
                </p>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2 pt-1 border-t border-line-soft">
        <span className="mr-auto text-[10px] text-sandrift">
          {previewActive ? "正在时间表中预览" : "未写入任何学习计划"}
        </span>
        <button
          onClick={handlePreview}
          className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors"
        >
          <Eye className="w-3.5 h-3.5" />
          {previewActive ? "收起预览" : "在时间表中预览"}
        </button>
      </div>
    </div>
  );
}
