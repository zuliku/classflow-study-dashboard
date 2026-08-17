"use client";

import React from "react";
import { ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import { WorkspaceViewBar } from "@/components/layout/WorkspaceViewBar";
import { IconButton } from "@/components/ui/IconButton";
import { Popover, PopoverPanel } from "@/components/ui/Popover";
import { cn } from "@/lib/utils";

/**
 * Timeline Workspace View Bar（App Chrome V2.2）：
 * - Primary：Week Scope（‹ › 今天）——紧簇、toolbar-like，禁用语义：week 边界 / 已在当前周
 * - Secondary：Filter（SlidersHorizontal）——显示层筛选（课程恒显禁用；其余可切换；
 *   任一可切换 filter 偏离默认 → trigger 显示 active 态）
 * 业务状态全部由 TimelineWorkspace 持有并通过 props 注入（不新建 toolbar store）。
 */
export interface TimelineFilterOption {
  key: string;
  label: string;
  checked: boolean;
}

interface TimelineWorkspaceViewBarProps {
  currentSemesterWeek: number;
  totalWeeks: number;
  isCurrentWeek: boolean;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  filterOptions: TimelineFilterOption[];
  /** 任一可切换 filter 偏离默认值（Filter trigger active 态） */
  filterActive: boolean;
  filterOpen: boolean;
  onFilterToggle: () => void;
  onFilterClose: () => void;
  onFilterChange: (key: string, value: boolean) => void;
}

export function TimelineWorkspaceViewBar({
  currentSemesterWeek,
  totalWeeks,
  isCurrentWeek,
  onPrevWeek,
  onNextWeek,
  onToday,
  filterOptions,
  filterActive,
  filterOpen,
  onFilterToggle,
  onFilterClose,
  onFilterChange,
}: TimelineWorkspaceViewBarProps) {
  const primary = (
    <div className="flex items-center gap-1" data-testid="timeline-week-scope">
      <IconButton
        variant="ghost"
        size="sm"
        onClick={onPrevWeek}
        disabled={currentSemesterWeek <= 1}
        aria-label="上一周"
        title="上一周"
      >
        <ChevronLeft className="w-4 h-4" />
      </IconButton>
      <IconButton
        variant="ghost"
        size="sm"
        onClick={onNextWeek}
        disabled={currentSemesterWeek >= totalWeeks}
        aria-label="下一周"
        title="下一周"
      >
        <ChevronRight className="w-4 h-4" />
      </IconButton>
      {/* 今天：当前周 subtle/disabled；非当前周增强回本周 */}
      <button
        type="button"
        onClick={onToday}
        disabled={isCurrentWeek}
        title={isCurrentWeek ? "已在当前周" : "回到本周"}
        className={cn(
          "h-7 px-2.5 rounded-lg text-[11px] font-bold transition-colors",
          isCurrentWeek
            ? "text-sandrift/70 cursor-default"
            : "text-charcoal bg-alabaster hover:bg-line-soft"
        )}
      >
        今天
      </button>
    </div>
  );

  const secondary = (
    <Popover
      open={filterOpen}
      onOpenChange={(open) => (open ? onFilterToggle() : onFilterClose())}
    >
      <IconButton
        variant="ghost"
        size="sm"
        onClick={onFilterToggle}
        aria-label="筛选"
        aria-expanded={filterOpen}
        title="筛选"
        className={cn(filterActive && !filterOpen && "bg-alabaster text-charcoal")}
      >
        <span className="relative inline-flex">
          <SlidersHorizontal className="w-4 h-4" />
          {filterActive && !filterOpen && (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-charcoal"
            />
          )}
        </span>
      </IconButton>
      <PopoverPanel
        open={filterOpen}
        placement="bottom-end"
        role="group"
        aria-label="时间表筛选"
        className="w-44 p-1.5 space-y-0.5"
      >
        <p className="px-1.5 pb-1 text-[10px] font-bold text-sandrift">显示</p>
        <FilterToggle label="课程" checked disabled hint="时间表骨架，恒显示" />
        {filterOptions.map((opt) => (
          <FilterToggle
            key={opt.key}
            label={opt.label}
            checked={opt.checked}
            onChange={(v) => onFilterChange(opt.key, v)}
          />
        ))}
      </PopoverPanel>
    </Popover>
  );

  return <WorkspaceViewBar primary={primary} secondary={secondary} testid="timeline-viewbar" />;
}

function FilterToggle({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-2 px-1.5 py-1.5 rounded-lg text-[11px] font-semibold text-charcoal cursor-pointer hover:bg-alabaster transition-colors",
        disabled && "cursor-default opacity-80"
      )}
      title={hint}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="w-3.5 h-3.5 rounded accent-charcoal"
      />
      {label}
    </label>
  );
}
