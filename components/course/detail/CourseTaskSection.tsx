"use client";

import React, { useState } from "react";
import { Plus } from "lucide-react";
import { Assignment } from "@/types";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { cn } from "@/lib/utils";
import {
  buildCourseTaskRow,
  expandableSlice,
  sortCourseAssignments,
} from "@/lib/courseDetailView";

const TASK_INLINE_LIMIT = 5;

/** 状态 chip 色调（muted palette；overdue 用 warm warning，不用纯红） */
const STATUS_TONE: Record<string, string> = {
  todo: "text-satin-grey",
  doing: "text-[#A87952]",
  submitted: "text-sandrift",
  completed: "text-sandrift",
};

/**
 * Course Task Section（Course Detail V2）：
 * - view-level 排序（todo/doing → submitted → completed；组内 DDL epoch 升序，无 DDL 组内最后）
 * - 行信息：Title + Status + Deadline（逾期 warm warning；completed muted）
 * - >5 默认前 5 + 展开全部（DisclosureRegion）
 * - 点击 → Assignment Floating Detail（Course 关闭）
 */
export function CourseTaskSection({
  assignments,
  now,
  onOpenAssignment,
  onAddTask,
}: {
  /** 已按 courseId 过滤的 Assignments */
  assignments: Assignment[];
  now: Date;
  onOpenAssignment: (assignmentId: string) => void;
  onAddTask: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sorted = sortCourseAssignments(assignments);
  const rows = sorted.map((a) => buildCourseTaskRow(a, now));
  const { visible, hiddenCount } = expandableSlice(rows, expanded, TASK_INLINE_LIMIT);
  const extra = rows.slice(TASK_INLINE_LIMIT);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-charcoal">
          相关任务{" "}
          <span className="text-[11px] font-semibold text-sandrift">
            {assignments.length} 个
          </span>
        </h3>
        <button
          type="button"
          onClick={onAddTask}
          className="ux-press flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[11px] font-bold text-satin-grey transition-colors hover:text-charcoal"
        >
          <Plus className="h-3.5 w-3.5" />
          添加任务
        </button>
      </div>

      {assignments.length === 0 ? (
        <button
          type="button"
          onClick={onAddTask}
          className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-[11px] font-semibold text-sandrift transition-colors hover:bg-alabaster hover:text-charcoal"
        >
          <span>暂无相关任务</span>
          <span className="flex items-center gap-1 font-bold">
            <Plus className="h-3.5 w-3.5" />
            添加任务
          </span>
        </button>
      ) : (
        <div className="divide-y divide-line-soft">
          {visible.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => onOpenAssignment(row.id)}
              className="group flex w-full items-center justify-between gap-3 px-1 py-2 text-left transition-colors hover:bg-alabaster/60"
            >
              <span
                className={cn(
                  "min-w-0 truncate text-xs font-semibold",
                  row.status === "completed" ? "text-sandrift line-through" : "text-charcoal"
                )}
              >
                {row.title}
              </span>
              <span className="flex shrink-0 items-center gap-2.5">
                <span className={cn("text-[10px] font-bold", STATUS_TONE[row.status])}>
                  {row.statusLabel}
                </span>
                <span
                  className={cn(
                    "text-[10px] font-semibold",
                    row.overdue ? "text-[#9B5B57]" : "text-sandrift"
                  )}
                >
                  {row.deadlineLabel}
                </span>
              </span>
            </button>
          ))}
          {hiddenCount > 0 && (
            <DisclosureRegion open={expanded}>
              <div className="divide-y divide-line-soft">
                {extra.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => onOpenAssignment(row.id)}
                    className="group flex w-full items-center justify-between gap-3 px-1 py-2 text-left transition-colors hover:bg-alabaster/60"
                  >
                    <span
                      className={cn(
                        "min-w-0 truncate text-xs font-semibold",
                        row.status === "completed"
                          ? "text-sandrift line-through"
                          : "text-charcoal"
                      )}
                    >
                      {row.title}
                    </span>
                    <span className="flex shrink-0 items-center gap-2.5">
                      <span className={cn("text-[10px] font-bold", STATUS_TONE[row.status])}>
                        {row.statusLabel}
                      </span>
                      <span
                        className={cn(
                          "text-[10px] font-semibold",
                          row.overdue ? "text-[#9B5B57]" : "text-sandrift"
                        )}
                      >
                        {row.deadlineLabel}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </DisclosureRegion>
          )}
          {hiddenCount > 0 && (
            <button
              type="button"
              aria-expanded={expanded}
              data-testid="tasks-expand-toggle"
              onClick={() => setExpanded((v) => !v)}
              className="w-full px-1 py-2 text-left text-[11px] font-bold text-satin-grey transition-colors hover:text-charcoal"
            >
              {expanded ? "收起" : `展开全部 ${assignments.length} 项`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
