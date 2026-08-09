"use client";

import React, { useState, useEffect } from "react";
import { Search, Calendar as CalendarIcon } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { getWeekDateRange, getSemesterWeek } from "@/lib/semester";
import { WORKSPACE_NAV_ITEMS } from "@/components/layout/navItems";

export function Header() {
  const {
    userProfile,
    setSearchModalOpen,
    setSearchModalView,
    semester,
    currentSemesterWeek,
    activeTab,
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

  const currentTabLabel =
    WORKSPACE_NAV_ITEMS.find((n) => n.id === activeTab)?.label ?? "总览";

  return (
    // 三档 Header：
    //   <768  当前页面标题 + 搜索入口（高频全局操作），不塞桌面控件
    //   768–1279  问候语 + 紧凑搜索 + 日期范围
    //   ≥1280  完整信息与间距
    <header className="bg-[#F7F5F5] border-b border-line px-4 md:px-6 py-3 md:py-3.5 md:min-h-16 flex flex-col md:flex-row md:items-center justify-between gap-3 sticky top-0 z-10">
      {/* Left: Mobile 显示当前页面标题；Desktop/Tablet 显示问候语 */}
      <div className="min-w-0">
        <h2 className="text-base md:text-lg font-bold text-charcoal tracking-tight truncate">
          <span className="md:hidden">{currentTabLabel}</span>
          <span className="hidden md:inline">
            {greeting}，{userProfile.name || "未设置姓名"}
          </span>
        </h2>
      </div>

      {/* Right: Global Search + Date Switcher */}
      <div className="flex items-center gap-2 md:gap-2.5">
        {/* Global Search（Cmd+K）：Mobile 仅图标，≥md 完整输入框 */}
        <button
          onClick={() => {
            setSearchModalView("palette");
            setSearchModalOpen(true);
          }}
          aria-label="全局搜索"
          className="flex items-center space-x-2 bg-white border border-line-strong rounded-xl px-2.5 md:px-3 py-1.5 text-xs text-sandrift cursor-pointer hover:border-charcoal hover:bg-surface transition-[background-color,border-color] shadow-subtle min-w-0 md:min-w-[200px]"
        >
          <Search className="w-3.5 h-3.5 text-[#A48F82] shrink-0" />
          <span className="hidden md:flex flex-1 font-medium min-w-0 truncate">
            搜索课程、任务、资料
          </span>
          <kbd className="hidden lg:inline-block bg-alabaster text-charcoal text-[10px] font-mono px-1.5 py-0.5 rounded border border-line-strong">
            ⌘ K
          </kbd>
        </button>

        {/* Date Range Picker Pill（Mobile 隐藏；Timeline Tab 由 Timeline 自身管理时间，不重复显示） */}
        {activeTab !== "timetable" && (
        <div className="hidden md:flex items-center space-x-1.5 bg-white border border-line-strong rounded-xl px-2.5 md:px-3 py-1.5 text-xs font-semibold text-charcoal shadow-subtle min-w-0">
          <CalendarIcon className="w-3.5 h-3.5 text-[#A48F82] shrink-0" />
          <span className="hidden lg:inline truncate">{dateRangeString}</span>
          <span className="lg:hidden truncate">{dateRangeString.slice(0, 10)}</span>
          <button
            onClick={resetToCurrentWeek}
            className={cn(
              "text-[10px] ml-1 px-1.5 py-0.5 rounded transition-colors shrink-0",
              isCurrentWeek
                ? "bg-pastel-mint text-charcoal"
                : "bg-alabaster text-sandrift hover:text-charcoal"
            )}
          >
            本周
          </button>
        </div>
        )}
      </div>
    </header>
  );
}
