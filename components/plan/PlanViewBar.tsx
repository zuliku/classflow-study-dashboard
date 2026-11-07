"use client";

import React from "react";
import { CalendarPlus, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/utils";

export function PlanViewBar({
  selectedWeek,
  totalWeeks,
  rangeLabel,
  isCurrentWeek,
  backlogCount,
  backlogOpen,
  onPrevWeek,
  onNextWeek,
  onToday,
  onToggleBacklog,
  onAddBlock,
}: {
  selectedWeek: number;
  totalWeeks: number;
  rangeLabel: string;
  isCurrentWeek: boolean;
  backlogCount: number;
  backlogOpen: boolean;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  onToggleBacklog: () => void;
  onAddBlock: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line bg-background px-4 py-2 md:px-6">
      <IconButton
        variant="ghost"
        size="sm"
        aria-label="上一周"
        onClick={onPrevWeek}
        disabled={selectedWeek <= 1}
      >
        <ChevronLeft className="h-4 w-4" />
      </IconButton>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-charcoal">第 {selectedWeek} 周</span>
          <span className="hidden text-[11px] text-sandrift sm:inline">{rangeLabel}</span>
          {!isCurrentWeek && (
            <button
              type="button"
              onClick={onToday}
              className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-satin-grey transition-colors hover:bg-alabaster hover:text-charcoal"
            >
              回到本周
            </button>
          )}
        </div>
      </div>
      <IconButton
        variant="ghost"
        size="sm"
        aria-label="下一周"
        onClick={onNextWeek}
        disabled={selectedWeek >= totalWeeks}
      >
        <ChevronRight className="h-4 w-4" />
      </IconButton>

      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleBacklog}
          aria-pressed={backlogOpen}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-bold transition-colors",
            backlogOpen
              ? "border-line-strong bg-pastel-mint text-charcoal"
              : "border-line bg-surface text-satin-grey hover:bg-alabaster hover:text-charcoal"
          )}
        >
          <Inbox className="h-3.5 w-3.5" />
          <span>待安排</span>
          <span className="tabular-nums">{backlogCount}</span>
        </button>
        <button
          type="button"
          onClick={onAddBlock}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[11px] font-bold text-satin-grey transition-colors hover:bg-alabaster hover:text-charcoal"
        >
          <CalendarPlus className="h-3.5 w-3.5" />
          <span>学习块</span>
        </button>
      </div>
    </div>
  );
}
