"use client";

import React, { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  format,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  parseISO,
} from "date-fns";
import { zhCN } from "date-fns/locale";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

export function MiniCalendar() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const { assignments, schedules, calendarMarks, currentSemesterWeek } = useAppStore();

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

  const getMarksForDay = (day: Date) => {
    const marks: { type: "course" | "ddl" | "exam" | "activity"; label: string }[] = [];
    const dateStr = format(day, "yyyy-MM-dd");

    // 1. Check assignments DDL on this day
    assignments.forEach((a) => {
      try {
        const ddlDate = parseISO(a.ddl);
        if (isSameDay(ddlDate, day)) {
          marks.push({ type: "ddl", label: a.title });
        }
      } catch (e) {}
    });

    // 2. Check schedules on this weekday
    const dayOfWeek = day.getDay() === 0 ? 7 : day.getDay();
    const activeSchedules = schedules.filter((s) => {
      if (s.dayOfWeek !== dayOfWeek) return false;
      if (s.excludedWeeks?.includes(currentSemesterWeek)) return false;
      return true;
    });
    if (activeSchedules.length > 0) {
      marks.push({ type: "course", label: `${activeSchedules.length} 节课` });
    }

    // 3. Check explicit calendarMarks from store
    calendarMarks.forEach((m) => {
      if (m.date === dateStr) {
        marks.push({ type: m.type, label: m.title });
      }
    });

    return marks;
  };

  return (
    <div className="bg-white border border-[#E7E3DD] rounded-2xl p-4 shadow-subtle flex flex-col justify-between space-y-3">
      {/* Month Navigation */}
      <div className="flex items-center justify-between border-b border-[#F0EBE1] pb-2">
        <h3 className="text-xs font-bold text-charcoal">
          {format(currentMonth, "yyyy年 M月", { locale: zhCN })}
        </h3>
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            className="p-1 rounded-lg text-[#8C827A] hover:bg-[#F0EBE1] hover:text-charcoal transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setCurrentMonth(new Date())}
            className="text-[10px] font-semibold text-[#8C827A] px-1.5 py-0.5 rounded bg-[#F7F5F5] hover:bg-[#F0EBE1] hover:text-charcoal border border-[#E7E3DD]"
          >
            今天
          </button>
          <button
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            className="p-1 rounded-lg text-[#8C827A] hover:bg-[#F0EBE1] hover:text-charcoal transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Weekday Header */}
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-[#8C827A]">
        {["一", "二", "三", "四", "五", "六", "日"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Days Grid */}
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {calendarDays.map((day, idx) => {
          const marks = getMarksForDay(day);
          const isCurrentMonth = isSameMonth(day, currentMonth);
          const isCurrentDay = isToday(day);

          const hasDDL = marks.some((m) => m.type === "ddl");
          const hasExam = marks.some((m) => m.type === "exam");
          const hasCourse = marks.some((m) => m.type === "course");

          return (
            <div
              key={idx}
              className={cn(
                "h-8 rounded-lg flex flex-col items-center justify-center relative transition-colors cursor-pointer group",
                !isCurrentMonth && "text-[#CCCBC4]",
                isCurrentMonth && "text-charcoal hover:bg-[#F0EBE1]",
                isCurrentDay && "bg-charcoal text-white font-bold hover:bg-black"
              )}
            >
              <span className="text-[11px] leading-none">{format(day, "d")}</span>

              {/* Status Dots */}
              <div className="flex items-center space-x-0.5 mt-0.5">
                {hasDDL && <span className="w-1 h-1 rounded-full bg-[#D94F4F]" />}
                {hasExam && <span className="w-1 h-1 rounded-full bg-[#E28743]" />}
                {hasCourse && <span className="w-1 h-1 rounded-full bg-[#4A7C59]" />}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-around text-[10px] text-[#8C827A] pt-2 border-t border-[#F0EBE1]">
        <span className="flex items-center space-x-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#4A7C59]" />
          <span>课程</span>
        </span>
        <span className="flex items-center space-x-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#D94F4F]" />
          <span>DDL</span>
        </span>
        <span className="flex items-center space-x-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#E28743]" />
          <span>考试</span>
        </span>
      </div>
    </div>
  );
}
