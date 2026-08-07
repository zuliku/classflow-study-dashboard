"use client";

import React from "react";
import { Search, ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import { useAppStore, ViewMode } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

export function Header() {
  const {
    userProfile,
    weekOffset,
    setWeekOffset,
    resetToCurrentWeek,
    viewMode,
    setViewMode,
    setSearchModalOpen,
  } = useAppStore();

  // Calculate dynamic week date range string
  const baseDate = new Date(2026, 7, 3); // Monday Aug 3, 2026
  const weekStartDate = new Date(baseDate);
  weekStartDate.setDate(baseDate.getDate() + weekOffset * 7);

  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setDate(weekStartDate.getDate() + 6);

  const formatDateRange = () => {
    const startM = weekStartDate.getMonth() + 1;
    const startD = weekStartDate.getDate();
    const endM = weekEndDate.getMonth() + 1;
    const endD = weekEndDate.getDate();
    const year = weekStartDate.getFullYear();

    if (startM === endM) {
      return `${year}年${startM}月${startD}日 - ${endD}日`;
    }
    return `${year}年${startM}月${startD}日 - ${endM}月${endD}日`;
  };

  return (
    <header className="w-full bg-[#F7F5F5] border-b border-[#E7E3DD] px-8 py-5 flex items-center justify-between sticky top-0 z-10 backdrop-blur-md bg-opacity-90">
      {/* Left Greeting & Subtitle */}
      <div>
        <h1 className="text-xl font-bold tracking-tight text-charcoal flex items-center gap-2">
          早上好，{userProfile.name} <span className="text-amber-500 text-lg">☀️</span>
        </h1>
        <p className="text-xs text-[#8C827A] mt-0.5 font-normal">
          专注学习，持续进步！
        </p>
      </div>

      {/* Center & Right Controls */}
      <div className="flex items-center space-x-4">
        {/* Global Search Trigger */}
        <button
          onClick={() => setSearchModalOpen(true)}
          className="flex items-center space-x-2.5 px-3.5 py-2 bg-white/80 hover:bg-white border border-[#E0D7C6] rounded-xl text-xs text-[#8C827A] transition-all shadow-subtle hover:shadow-card w-60"
        >
          <Search className="w-3.5 h-3.5 text-[#A48F82]" />
          <span className="flex-1 text-left">搜索课程、作业、资料...</span>
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-[#8C827A] bg-[#F0EBE1] border border-[#D5CBC0] rounded">
            ⌘K
          </kbd>
        </button>

        {/* Date Range Switcher & Reset */}
        <div className="flex items-center bg-white/80 border border-[#E0D7C6] rounded-xl p-1 shadow-subtle">
          <button
            onClick={() => setWeekOffset((prev) => prev - 1)}
            className="p-1.5 hover:bg-[#F0EBE1] text-charcoal rounded-lg transition-colors"
            title="上一周"
          >
            <ChevronLeft className="w-3.5 h-3.5 text-[#676268]" />
          </button>

          <div className="flex items-center space-x-1.5 px-2 text-xs font-medium text-charcoal">
            <CalendarIcon className="w-3.5 h-3.5 text-[#A48F82]" />
            <span>{formatDateRange()}</span>
          </div>

          <button
            onClick={() => setWeekOffset((prev) => prev + 1)}
            className="p-1.5 hover:bg-[#F0EBE1] text-charcoal rounded-lg transition-colors"
            title="下一周"
          >
            <ChevronRight className="w-3.5 h-3.5 text-[#676268]" />
          </button>

          {weekOffset !== 0 && (
            <button
              onClick={resetToCurrentWeek}
              className="ml-1 px-2 py-1 text-[11px] font-medium bg-[#E3E6E0] hover:bg-[#D5DCD0] text-charcoal rounded-md transition-colors"
            >
              本周
            </button>
          )}
        </div>

        {/* View Mode Segmented Tab Control */}
        <div className="flex bg-[#F0EBE1] border border-[#E0D7C6] p-1 rounded-xl">
          {(["day", "week", "month"] as ViewMode[]).map((mode) => {
            const labels: Record<ViewMode, string> = {
              day: "日",
              week: "周",
              month: "月",
            };
            const isActive = viewMode === mode;
            return (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={cn(
                  "px-3 py-1 text-xs font-medium rounded-lg transition-all",
                  isActive
                    ? "bg-white text-charcoal shadow-subtle font-semibold"
                    : "text-[#676268] hover:text-charcoal"
                )}
              >
                {labels[mode]}
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
}
