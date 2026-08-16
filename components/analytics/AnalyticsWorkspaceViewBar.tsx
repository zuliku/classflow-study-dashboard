"use client";

import React from "react";
import { ChevronRight } from "lucide-react";
import { WorkspaceViewBar } from "@/components/layout/WorkspaceViewBar";
import { AnalyticsRangeSelector } from "@/components/analytics/AnalyticsRangeSelector";
import { AnalyticsRangePreset } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";

/**
 * Analytics Workspace View Bar（App Chrome V2.3）：
 * - Primary：AnalyticsRangeSelector（本周 / 近 4 周 / 本学期——业务事实来源不变）
 * - Secondary：周回顾（独立 workflow action，非第四种 Range selection）
 * 交互语义全部由 LearningAnalyticsView 持有（reviewExpanded / preset / scroll 与 reduced-motion）。
 */
export function AnalyticsWorkspaceViewBar({
  preset,
  onPresetChange,
  reviewExpanded,
  onWeeklyReviewToggle,
  innerClassName,
}: {
  preset: AnalyticsRangePreset;
  onPresetChange: (preset: AnalyticsRangePreset) => void;
  reviewExpanded: boolean;
  onWeeklyReviewToggle: () => void;
  innerClassName?: string;
}) {
  const primary = <AnalyticsRangeSelector value={preset} onChange={onPresetChange} />;

  const secondary = (
    <button
      type="button"
      aria-pressed={reviewExpanded}
      aria-expanded={reviewExpanded}
      onClick={onWeeklyReviewToggle}
      data-testid="weekly-review-action"
      className={cn(
        "shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors duration-[var(--motion-fast)]",
        reviewExpanded
          ? "text-sandrift bg-alabaster border border-line-strong"
          : "text-sandrift bg-transparent border border-line hover:text-charcoal hover:border-line-strong"
      )}
    >
      {reviewExpanded ? "收起周回顾" : "周回顾"}
      <ChevronRight
        className={cn(
          "w-3 h-3 transition-transform duration-[var(--motion-fast)]",
          reviewExpanded && "rotate-90"
        )}
      />
    </button>
  );

  return (
    <WorkspaceViewBar
      primary={primary}
      secondary={secondary}
      innerClassName={innerClassName}
      testid="analytics-viewbar"
    />
  );
}
