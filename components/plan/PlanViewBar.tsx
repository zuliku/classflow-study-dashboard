"use client";

import React, { useState } from "react";
import {
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Inbox,
  LifeBuoy,
  ListChecks,
  Sparkles,
} from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import { Popover } from "@/components/ui/Popover";
import { DropdownMenuItem, DropdownMenuPanel } from "@/components/ui/DropdownMenu";
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
  onPlanWeek,
  onRescue,
  view,
  onViewChange,
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
  onPlanWeek: () => void;
  onRescue: () => void;
  view: "timeline" | "tasks";
  onViewChange: (view: "timeline" | "tasks") => void;
}) {
  const [planMenuOpen, setPlanMenuOpen] = useState(false);
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
          <span className="whitespace-nowrap text-xs font-bold text-charcoal">
            第 {selectedWeek} 周
          </span>
          <span className="hidden whitespace-nowrap text-[11px] text-sandrift sm:inline">
            {rangeLabel}
          </span>
          {!isCurrentWeek && (
            <button
              type="button"
              onClick={onToday}
              className="whitespace-nowrap rounded-md border border-line bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-satin-grey transition-colors hover:bg-alabaster hover:text-charcoal"
            >
              <span className="hidden sm:inline">回到本周</span>
              <span className="sm:hidden">本周</span>
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

      <button
        type="button"
        onClick={() => onViewChange(view === "tasks" ? "timeline" : "tasks")}
        aria-label={view === "tasks" ? "切换到时间轴" : "切换到任务"}
        aria-pressed={view === "tasks"}
        className="ml-1 inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[11px] font-bold text-satin-grey transition-colors hover:bg-alabaster hover:text-charcoal"
      >
        {view === "tasks" ? (
          <CalendarDays className="h-3.5 w-3.5" />
        ) : (
          <ListChecks className="h-3.5 w-3.5" />
        )}
        <span className="hidden sm:inline">{view === "tasks" ? "时间轴" : "任务"}</span>
      </button>

      {view === "timeline" && (
        <div className="ml-auto flex items-center gap-1.5">
        <Popover open={planMenuOpen} onOpenChange={setPlanMenuOpen}>
          <button
            type="button"
            onClick={() => setPlanMenuOpen((open) => !open)}
            aria-label="自动规划"
            aria-expanded={planMenuOpen}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[11px] font-bold text-satin-grey transition-colors hover:bg-alabaster hover:text-charcoal"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">规划</span>
          </button>
          <DropdownMenuPanel portal open={planMenuOpen} placement="bottom-end" aria-label="自动规划" className="w-48">
            <DropdownMenuItem
              icon={Sparkles}
              label="自动安排本周"
              onClick={() => {
                setPlanMenuOpen(false);
                onPlanWeek();
              }}
            />
            <DropdownMenuItem
              icon={LifeBuoy}
              label="救援调整"
              onClick={() => {
                setPlanMenuOpen(false);
                onRescue();
              }}
            />
          </DropdownMenuPanel>
        </Popover>
        <button
          type="button"
          onClick={onToggleBacklog}
          aria-pressed={backlogOpen}
          aria-label={`待安排 ${backlogCount}`}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-bold transition-colors sm:px-2.5",
            backlogOpen
              ? "border-line-strong bg-pastel-mint text-charcoal"
              : "border-line bg-surface text-satin-grey hover:bg-alabaster hover:text-charcoal"
          )}
        >
          <Inbox className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">待安排</span>
          <span className="tabular-nums">{backlogCount}</span>
        </button>
        <button
          type="button"
          onClick={onAddBlock}
          aria-label="添加学习块"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2 text-[11px] font-bold text-satin-grey transition-colors hover:bg-alabaster hover:text-charcoal sm:px-2.5"
        >
          <CalendarPlus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">学习块</span>
        </button>
        </div>
      )}
    </div>
  );
}
