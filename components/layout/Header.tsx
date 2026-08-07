"use client";

import React, { useState, useEffect } from "react";
import { Search, Calendar as CalendarIcon } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { getWeekDateRange, getSemesterWeek } from "@/lib/semester";

export function Header() {
  const {
    userProfile,
    setSearchModalOpen,
    semester,
    currentSemesterWeek,
    resetToCurrentWeek,
  } = useAppStore();

  const [greeting, setGreeting] = useState("早上好");

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) {
      setGreeting("早上好");
    } else if (hour >= 12 && hour < 18) {
      setGreeting("下午好");
    } else {
      setGreeting("晚上好");
    }
  }, []);

  // 日期范围完全由学期模型推导，与课表表头保持同一数据源
  const weekDays = getWeekDateRange(semester, currentSemesterWeek);
  const dateRangeString = `${format(weekDays[0], "yyyy年M月d日", { locale: zhCN })} - ${format(
    weekDays[6],
    "M月d日",
    { locale: zhCN }
  )}`;

  const realCurrentWeek = Math.min(
    Math.max(getSemesterWeek(new Date(), semester), 1),
    semester.totalWeeks
  );
  const isCurrentWeek = currentSemesterWeek === realCurrentWeek;

  return (
    <header className="bg-[#F7F5F5] border-b border-[#E7E3DD] px-6 py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-4 sticky top-0 z-10">
      {/* Left: Clean Greeting */}
      <div>
        <h2 className="text-lg font-bold text-charcoal tracking-tight">
          {greeting}，{userProfile.name}
        </h2>
      </div>

      {/* Right: Global Search, Date Switcher, View Switcher */}
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Global Search Bar (Cmd+K) */}
        <div
          onClick={() => setSearchModalOpen(true)}
          className="flex items-center space-x-2 bg-white border border-[#E0D7C6] rounded-xl px-3 py-1.5 text-xs text-[#8C827A] cursor-pointer hover:border-charcoal hover:bg-[#FAF8F5] transition-all shadow-subtle min-w-[200px]"
        >
          <Search className="w-3.5 h-3.5 text-[#A48F82]" />
          <span className="flex-1 font-medium">搜索课程、任务、资料</span>
          <kbd className="hidden sm:inline-block bg-[#F0EBE1] text-charcoal text-[10px] font-mono px-1.5 py-0.5 rounded border border-[#E0D7C6]">
            ⌘ K
          </kbd>
        </div>

        {/* Date Range Picker Pill */}
        <div className="flex items-center space-x-1.5 bg-white border border-[#E0D7C6] rounded-xl px-3 py-1.5 text-xs font-semibold text-charcoal shadow-subtle">
          <CalendarIcon className="w-3.5 h-3.5 text-[#A48F82]" />
          <span>{dateRangeString}</span>
          <button
            onClick={resetToCurrentWeek}
            className={cn(
              "text-[10px] ml-1 px-1.5 py-0.5 rounded transition-colors",
              isCurrentWeek
                ? "bg-[#E3E6E0] text-charcoal"
                : "bg-[#F0EBE1] text-[#8C827A] hover:text-charcoal"
            )}
          >
            本周
          </button>
        </div>
      </div>
    </header>
  );
}
