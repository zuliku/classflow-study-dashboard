"use client";

import React, { useState } from "react";
import { ChevronDown, GripVertical, CalendarPlus } from "lucide-react";
import { Assignment } from "@/types";
import { cn } from "@/lib/utils";

/**
 * 待安排（Task：ClassFlow Timeline V1 polish）：
 * 独立 Secondary Panel，位于主时间表之后（页面滚动可见），默认单行横向滚动；点击展开才多行。
 * IM5B：directManipulationEnabled 时整个任务 chip 可拖（pointerdown 交给 TimelineWorkspace owner），
 * Grip 仅视觉 affordance；「安排」按钮保持精确安排（ArrangeSheet）且 pointer 隔离。
 */
export function TimelineUnscheduledShelf({
  assignments,
  onArrange,
  directManipulationEnabled = false,
  draggingAssignmentId = null,
  onAssignmentPointerDown,
}: {
  assignments: Assignment[];
  onArrange: (a: Assignment) => void;
  directManipulationEnabled?: boolean;
  draggingAssignmentId?: string | null;
  onAssignmentPointerDown?: (event: React.PointerEvent, assignment: Assignment) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (assignments.length === 0) return null;

  const ddlText = (a: Assignment): string => {
    if (!a.ddl) return "无截止日期";
    const date = a.ddl.slice(0, 10);
    const time = a.ddl.slice(11, 16);
    const label = `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
    return time ? `${label} ${time}` : label;
  };

  return (
    <div
      data-testid="timeline-unscheduled"
      className="bg-surface border border-line rounded-2xl shadow-subtle p-3 shrink-0"
    >
      {/* Panel Header：计数 + 展开/收起 */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-semibold text-satin-grey">
          待安排 {assignments.length}
        </span>
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex items-center gap-0.5 text-[11px] font-semibold text-sandrift hover:text-charcoal transition-colors"
        >
          {expanded ? "收起" : "展开"}
          <ChevronDown
            className={cn(
              "w-3 h-3 transition-transform duration-[var(--motion-fast)]",
              expanded && "rotate-180"
            )}
            aria-hidden="true"
          />
        </button>
      </div>

      {/* 默认单行横向滚动；展开后允许换行 */}
      <div
        className={expanded ? "flex flex-wrap gap-1.5" : "flex flex-nowrap items-center gap-1.5 overflow-x-auto kiro-attachment-tray"}
      >
        {assignments.map((a) => {
          const isDragging = draggingAssignmentId === a.id;
          return (
            <span
              key={a.id}
              data-testid="timeline-unscheduled-item"
              onPointerDown={
                directManipulationEnabled && onAssignmentPointerDown
                  ? (e) => onAssignmentPointerDown(e, a)
                  : undefined
              }
              title={directManipulationEnabled ? "拖到时间表快速安排 1 小时" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 pl-1.5 pr-1 h-7 rounded-lg bg-surface border border-line text-[11px] font-semibold text-charcoal max-w-[240px] shrink-0",
                directManipulationEnabled && !isDragging && "cursor-grab select-none",
                isDragging && "opacity-50 cursor-grabbing"
              )}
            >
              {directManipulationEnabled && (
                <GripVertical className="w-3 h-3 text-sandrift shrink-0" aria-hidden="true" />
              )}
              <span className="truncate">{a.title}</span>
              <span className="text-[10px] text-sandrift font-medium shrink-0">{ddlText(a)}</span>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onArrange(a);
                }}
                aria-label={`安排 ${a.title}`}
                title="精准设置时间"
                className="flex items-center gap-0.5 p-1 rounded text-sandrift hover:text-charcoal hover:bg-alabaster transition-colors shrink-0"
              >
                <CalendarPlus className="w-3 h-3" />
                <span className="text-[10px] font-bold">安排</span>
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
