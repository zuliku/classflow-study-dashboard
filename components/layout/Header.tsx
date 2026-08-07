"use client";

import React from "react";
import { Search, ChevronDown, Calendar as CalendarIcon } from "lucide-react";
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

  return (
    <header className="w-full bg-[#F7F5F5] border-b border-[#E7E3DD] px-6 py-3.5 flex items-center justify-between sticky top-0 z-10 backdrop-blur-md bg-opacity-95">
      {/* Left Greeting & Subtitle */}
      <div>
        <h1 className="text-base font-bold tracking-tight text-charcoal flex items-center gap-1.5">
          早上好，{userProfile.name} <span className="text-amber-500 text-sm">☀️</span>
        </h1>
        <p className="text-[11px] text-[#8C827A] mt-0.5 font-normal">
          专注学习，持续进步！
        </p>
      </div>

      {/* Center & Right Controls */}
      <div className="flex items-center space-x-3">
        {/* Global Search Trigger */}
        <button
          onClick={() => setSearchModalOpen(true)}
          className="flex items-center space-x-2 px-3 py-1.5 bg-white border border-[#E0D7C6] rounded-xl text-xs text-[#8C827A] transition-all shadow-subtle hover:shadow-card w-56"
        >
          <Search className="w-3.5 h-3.5 text-[#A48F82]" />
          <span className="flex-1 text-left truncate">搜索课程、作业、资料...</span>
          <kbd className="hidden sm:inline-block px-1 py-0.5 text-[9px] font-mono text-[#8C827A] bg-[#F0EBE1] border border-[#D5CBC0] rounded">
            ⌘ K
          </kbd>
        </button>

        {/* Date Range Selector Pill matching reference image */}
        <div
          onClick={resetToCurrentWeek}
          className="flex items-center space-x-2 px-3 py-1.5 bg-white border border-[#E0D7C6] rounded-xl text-xs font-medium text-charcoal shadow-subtle cursor-pointer hover:bg-[#F0EBE1]/50 transition-colors"
        >
          <CalendarIcon className="w-3.5 h-3.5 text-[#8C827A]" />
          <span>2025年5月19日 - 5月25日</span>
          <ChevronDown className="w-3.5 h-3.5 text-[#8C827A]" />
        </div>

        {/* View Mode Segmented Tab Control */}
        <div className="flex bg-[#E7E3DD]/70 p-0.5 rounded-lg border border-[#D5CBC0]">
          {(["day", "week", "month"] as ViewMode[]).map((mode) => {
            const labels: Record<ViewMode, string> = {
              day: "日",
              week: "周",
              month: "月",
            };
            const isActive = viewMode === mode || (mode === "week" && viewMode === "week");
            return (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded-md transition-all",
                  isActive
                    ? "bg-charcoal text-white font-semibold shadow-subtle"
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
