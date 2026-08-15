"use client";

import React, { useState } from "react";
import { Checkbox } from "@/components/ui/Checkbox";
import { cn } from "@/lib/utils";
import { formatEstimatedMinutes } from "@/lib/tasks/taskSemantics";
import {
  DeadlineView,
  StudyScheduleSummary,
} from "@/lib/tasks/assignmentDetailView";

/** 子任务默认直接展示上限；超出部分折叠 */
const SUBTASKS_INLINE_LIMIT = 4;

/**
 * Assignment Detail Execution（行式 key-value section，替代多张独立卡片）：
 * 截止时间 / 预计耗时 / 学习安排 / 进度；子任务为轻量 checkbox 行。
 */
export function AssignmentDetailExecution({
  deadline,
  estimatedMinutesLabel,
  scheduleSummary,
  onViewSchedule,
  subtasks,
  onToggleSubtask,
  progress,
  onProgressChange,
  showProgressControl,
}: {
  deadline: DeadlineView;
  /** 已格式化的预计耗时文案（未估时 → "未估时"） */
  estimatedMinutesLabel: string;
  scheduleSummary: StudyScheduleSummary;
  onViewSchedule: () => void;
  subtasks: { id: string; title: string; completed: boolean }[];
  onToggleSubtask: (subtaskId: string) => void;
  progress: number;
  onProgressChange: (progress: number) => void;
  showProgressControl: boolean;
}) {
  const [subtasksExpanded, setSubtasksExpanded] = useState(false);
  const completedSubtasks = subtasks.filter((s) => s.completed).length;
  const visibleSubtasks = subtasksExpanded ? subtasks : subtasks.slice(0, SUBTASKS_INLINE_LIMIT);

  return (
    <section className="space-y-2.5">
      <h3 className="text-[13px] font-semibold text-charcoal">执行</h3>
      <div className="divide-y divide-line-soft rounded-xl border border-line bg-[#F7F5F5]/60">
        <div className="flex items-center justify-between gap-3 px-3.5 py-2">
          <span className="text-[11px] font-semibold text-sandrift">截止时间</span>
          <span className={cn("text-xs font-semibold", deadline.hasDdl ? "text-charcoal" : "text-satin-grey/70")}>
            {deadline.primary}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 px-3.5 py-2">
          <span className="text-[11px] font-semibold text-sandrift">预计耗时</span>
          <span className="text-xs font-semibold text-charcoal">{estimatedMinutesLabel}</span>
        </div>
        <div className="flex items-center justify-between gap-3 px-3.5 py-2">
          <span className="text-[11px] font-semibold text-sandrift">学习安排</span>
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs font-semibold text-charcoal">
              {scheduleSummary.hasBlocks
                ? `${formatEstimatedMinutes(scheduleSummary.minutes) ?? `${scheduleSummary.minutes} 分钟`} · ${scheduleSummary.blockCount} 个时段`
                : "未安排"}
            </span>
            <button
              type="button"
              onClick={onViewSchedule}
              className="shrink-0 text-[11px] font-bold text-satin-grey transition-colors hover:text-charcoal"
            >
              {scheduleSummary.hasBlocks ? "在时间表查看" : "安排"}
            </button>
          </span>
        </div>
        {showProgressControl && (
          <div className="px-3.5 py-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-sandrift">进度</span>
              <span className="text-xs font-bold text-charcoal">{progress}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={progress}
              aria-label="完成进度"
              onChange={(e) => onProgressChange(parseInt(e.target.value))}
              className="mt-1.5 h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-line-strong accent-charcoal"
            />
          </div>
        )}
      </div>

      {subtasks.length > 0 && (
        <div className="space-y-1">
          <p className="flex items-center justify-between text-[11px] font-semibold text-sandrift">
            <span>子任务</span>
            <span className="text-[10px] font-bold text-satin-grey">
              {completedSubtasks} / {subtasks.length}
            </span>
          </p>
          <div className="space-y-0.5">
            {visibleSubtasks.map((st) => (
              <label
                key={st.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-alabaster/70"
              >
                <Checkbox
                  checked={st.completed}
                  onChange={() => onToggleSubtask(st.id)}
                />
                <span
                  className={cn(
                    "flex-1 text-charcoal",
                    st.completed ? "text-sandrift line-through" : "font-medium"
                  )}
                >
                  {st.title}
                </span>
              </label>
            ))}
          </div>
          {subtasks.length > SUBTASKS_INLINE_LIMIT && (
            <button
              type="button"
              aria-expanded={subtasksExpanded}
              onClick={() => setSubtasksExpanded((v) => !v)}
              className="text-[11px] font-bold text-satin-grey transition-colors hover:text-charcoal"
            >
              {subtasksExpanded ? "收起" : `展开全部 ${subtasks.length} 项`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
