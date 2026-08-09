"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronUp, CalendarPlus } from "lucide-react";
import { Assignment } from "@/types";

/**
 * 待安排（Task：ClassFlow Timeline V1 polish）：
 * 独立 Secondary Panel，位于主时间表之后（页面滚动可见），默认单行横向滚动；点击展开才多行。
 */
export function TimelineUnscheduledShelf({
  assignments,
  onArrange,
}: {
  assignments: Assignment[];
  onArrange: (a: Assignment) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (assignments.length === 0) return null;

  const ddlText = (a: Assignment): string => {
    const date = a.ddl.slice(0, 10);
    const time = a.ddl.slice(11, 16);
    const label = `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
    return time ? `${label} ${time}` : label;
  };

  return (
    <div
      data-testid="timeline-unscheduled"
      className="bg-surface border border-line rounded-2xl shadow-subtle p-3"
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
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {/* 默认单行横向滚动；展开后允许换行 */}
      <div
        className={expanded ? "flex flex-wrap gap-1.5" : "flex flex-nowrap items-center gap-1.5 overflow-x-auto kiro-attachment-tray"}
      >
        {assignments.map((a) => (
          <span
            key={a.id}
            data-testid="timeline-unscheduled-item"
            className="inline-flex items-center gap-1.5 pl-2 pr-1 h-7 rounded-lg bg-surface border border-line text-[11px] font-semibold text-charcoal max-w-[240px] shrink-0"
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
    </div>
  );
}
