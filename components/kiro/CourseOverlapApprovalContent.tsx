"use client";

import React from "react";
import { format, parseISO } from "date-fns";

/** Course Overlap Approval 展示条目（StudyPlan / Rebalance 共用；纯 presentation） */
export interface CourseOverlapDisplayItem {
  key: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  courseName: string;
}

/**
 * Course Overlap Approval 列表内容（Task 5/6 共用）：
 * 最多展示 max 条（默认 3），超出显示「还有 N 项课程重叠」。
 * Dialog shell 与按钮由各 Proposal Card 持有（overlayId / 文案 / 按钮不同）。
 */
export function CourseOverlapApprovalList({
  items,
  max = 3,
}: {
  items: CourseOverlapDisplayItem[];
  max?: number;
}) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-line bg-[#F7F5F5] divide-y divide-line-soft">
      {items.slice(0, max).map((o) => (
        <div key={o.key} className="px-3 py-2.5 space-y-0.5">
          <p className="text-xs font-bold text-charcoal">{o.title}</p>
          <p className="text-[11px] text-satin-grey">
            {format(parseISO(o.date), "M月d日")} {o.startTime}–{o.endTime}
          </p>
          <p className="text-[11px] font-semibold text-[#936E4C]">与《{o.courseName}》重叠</p>
        </div>
      ))}
      {items.length > max && (
        <p className="px-3 py-2 text-[11px] font-semibold text-sandrift">
          还有 {items.length - max} 项课程重叠
        </p>
      )}
    </div>
  );
}
