"use client";

import React, { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

const WEEKDAY_NAMES = ["一", "二", "三", "四", "五", "六", "日"];

export function MiniCalendar() {
  const { calendarMarks, assignments } = useAppStore();

  const [currentYear, setCurrentYear] = useState(2026);
  const [currentMonth, setCurrentMonth] = useState(7); // 0-indexed: 7 = August
  const [selectedDay, setSelectedDay] = useState<number | null>(7); // Aug 7 is current day

  const prevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const goToToday = () => {
    setCurrentYear(2026);
    setCurrentMonth(7);
    setSelectedDay(7);
  };

  // Build grid days for the selected month
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayOfWeek = (new Date(currentYear, currentMonth, 1).getDay() + 6) % 7; // Monday = 0

  const prevMonthDays = new Date(currentYear, currentMonth, 0).getDate();

  const gridCells: { day: number; isCurrentMonth: boolean; fullDateStr: string }[] = [];

  // Previous month trailing days
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const dayNum = prevMonthDays - i;
    const pm = currentMonth === 0 ? 12 : currentMonth;
    const py = currentMonth === 0 ? currentYear - 1 : currentYear;
    const dateStr = `${py}-${String(pm).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
    gridCells.push({ day: dayNum, isCurrentMonth: false, fullDateStr: dateStr });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    gridCells.push({ day: d, isCurrentMonth: true, fullDateStr: dateStr });
  }

  // Next month leading days to complete 35 or 42 cells
  const remainingCells = 35 - gridCells.length;
  for (let nd = 1; nd <= (remainingCells >= 0 ? remainingCells : remainingCells + 7); nd++) {
    const nm = currentMonth === 11 ? 1 : currentMonth + 2;
    const ny = currentMonth === 11 ? currentYear + 1 : currentYear;
    const dateStr = `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
    gridCells.push({ day: nd, isCurrentMonth: false, fullDateStr: dateStr });
  }

  return (
    <div className="bg-white border border-[#E7E3DD] rounded-2xl p-5 shadow-subtle flex flex-col">
      {/* Calendar Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[#F0EBE1]">
        <h3 className="text-sm font-bold text-charcoal">
          {currentYear}年 {currentMonth + 1}月
        </h3>
        <div className="flex items-center space-x-1">
          <button
            onClick={prevMonth}
            className="p-1 hover:bg-[#F0EBE1] text-[#676268] hover:text-charcoal rounded-lg transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={nextMonth}
            className="p-1 hover:bg-[#F0EBE1] text-[#676268] hover:text-charcoal rounded-lg transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={goToToday}
            className="px-2 py-0.5 text-xs font-medium bg-[#F0EBE1] hover:bg-[#E3DDD2] text-charcoal rounded-md transition-colors ml-1"
          >
            今日
          </button>
        </div>
      </div>

      {/* Weekday Titles */}
      <div className="grid grid-cols-7 gap-1 my-2 text-center text-xs font-medium text-[#8C827A]">
        {WEEKDAY_NAMES.map((name) => (
          <div key={name} className="py-1">
            {name}
          </div>
        ))}
      </div>

      {/* Days Grid */}
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {gridCells.map((cell, idx) => {
          const isToday =
            cell.isCurrentMonth &&
            cell.day === 7 &&
            currentMonth === 7 &&
            currentYear === 2026;
          const isSelected = cell.isCurrentMonth && cell.day === selectedDay;

          // Find marks for this date
          const dateMarks = calendarMarks.filter((m) => m.date === cell.fullDateStr);
          // Also check if any DDL matches this date
          const hasDDL = assignments.some(
            (a) => a.ddl.startsWith(cell.fullDateStr) && a.status !== "completed"
          );

          const hasCourseDot = dateMarks.some((m) => m.type === "course");
          const hasDDLDot = hasDDL || dateMarks.some((m) => m.type === "ddl");
          const hasExamDot = dateMarks.some((m) => m.type === "exam");
          const hasActivityDot = dateMarks.some((m) => m.type === "activity");

          return (
            <button
              key={idx}
              onClick={() => cell.isCurrentMonth && setSelectedDay(cell.day)}
              className={cn(
                "relative py-2 rounded-xl transition-all flex flex-col items-center justify-center min-h-[36px]",
                !cell.isCurrentMonth && "text-[#CCCCCC] cursor-default",
                cell.isCurrentMonth && !isToday && !isSelected && "hover:bg-[#F7F5F5] text-charcoal",
                isToday && !isSelected && "bg-[#E3E6E0] font-bold text-charcoal",
                isSelected && "bg-charcoal text-white font-bold shadow-subtle"
              )}
            >
              <span>{cell.day}</span>

              {/* Event Dots */}
              <div className="flex space-x-0.5 mt-0.5 h-1">
                {hasCourseDot && (
                  <span className="w-1 h-1 rounded-full bg-[#4A7C59]" />
                )}
                {hasDDLDot && (
                  <span className="w-1 h-1 rounded-full bg-[#D94F4F]" />
                )}
                {hasExamDot && (
                  <span className="w-1 h-1 rounded-full bg-[#8B5CF6]" />
                )}
                {hasActivityDot && (
                  <span className="w-1 h-1 rounded-full bg-[#F59E0B]" />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Legend Footer */}
      <div className="mt-3 pt-3 border-t border-[#F0EBE1] flex items-center justify-between text-[11px] text-[#676268]">
        <div className="flex items-center space-x-1">
          <span className="w-2 h-2 rounded-full bg-[#4A7C59]" />
          <span>课程</span>
        </div>
        <div className="flex items-center space-x-1">
          <span className="w-2 h-2 rounded-full bg-[#D94F4F]" />
          <span>DDL</span>
        </div>
        <div className="flex items-center space-x-1">
          <span className="w-2 h-2 rounded-full bg-[#8B5CF6]" />
          <span>考试</span>
        </div>
        <div className="flex items-center space-x-1">
          <span className="w-2 h-2 rounded-full bg-[#F59E0B]" />
          <span>活动</span>
        </div>
      </div>
    </div>
  );
}
