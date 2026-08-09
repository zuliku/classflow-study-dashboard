"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronUp, CalendarPlus } from "lucide-react";
import { Assignment } from "@/types";
import { cn } from "@/lib/utils";

/**
 * Unscheduled Shelf（Task：ClassFlow Timeline V1）：
 * 未完成且未安排学习计划的 Assignment，compact / collapsible。
 * 不强迫无时间任务进入 Hour Grid；点击「安排」生成 StudyBlock。
 */
export function TimelineUnscheduledShelf({
  assignments,
  weekDates,
  onArrange,
}: {
  assignments: Assignment[];
  weekDates: string[];
  onArrange: (a: Assignment) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (assignments.length === 0) return null;

  const ddlText = (a: Assignment): string => {
    const date = a.ddl.slice(0, 10);
    const time = a.ddl.slice(11, 16);
    const label = `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
    return time ? `${label} ${time} 截止` : `${label} 截止`;
  };

  return (
    <div className="border-t border-line-soft shrink-0">
      <button
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] font-semibold text-satin-grey hover:text-charcoal transition-colors"
      >
        <span>待安排 {assignments.length}</span>
        {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
      {!collapsed && (
        <div className="px-2 pb-2 flex flex-wrap gap-1.5">
          {assignments.map((a) => (
            <span
              key={a.id}
              data-testid="timeline-unscheduled-item"
              className="inline-flex items-center gap-1.5 pl-2 pr-1 h-7 rounded-lg bg-surface border border-line text-[11px] font-semibold text-charcoal max-w-[260px]"
            >
              <span className="truncate">{a.title}</span>
              <span className="text-[9px] text-sandrift font-medium shrink-0">{ddlText(a)}</span>
              <button
                onClick={() => onArrange(a)}
                aria-label={`安排 ${a.title}`}
                title="安排时间"
                className="flex items-center gap-0.5 p-1 rounded text-sandrift hover:text-charcoal hover:bg-alabaster transition-colors shrink-0"
              >
                <CalendarPlus className="w-3 h-3" />
                <span className="text-[9px] font-bold">安排</span>
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
