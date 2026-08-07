"use client";

import React, { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const WEEKDAY_NAMES = ["一", "二", "三", "四", "五", "六", "日"];

export function MiniCalendar() {
  const [currentYear] = useState(2025);
  const [currentMonth] = useState(4); // 0-indexed: 4 = May
  const [selectedDay, setSelectedDay] = useState<number>(19);

  // May 2025 calendar days (starts on Thursday May 1)
  const prevDays = [28, 29, 30]; // April trailing days
  const currentDays = Array.from({ length: 31 }, (_, i) => i + 1);
  const nextDays = [1, 2, 3, 4, 5, 6, 7, 8];

  return (
    <div className="bg-white border border-[#E7E3DD] rounded-2xl p-4 shadow-subtle flex flex-col">
      {/* Calendar Header */}
      <div className="flex items-center justify-between pb-2.5 border-b border-[#F0EBE1]">
        <h3 className="text-xs font-bold text-charcoal">
          5月 2025
        </h3>
        <div className="flex items-center space-x-1">
          <button className="p-1 hover:bg-[#F0EBE1] text-[#676268] rounded-lg transition-colors">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button className="p-1 hover:bg-[#F0EBE1] text-[#676268] rounded-lg transition-colors">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setSelectedDay(19)}
            className="px-2 py-0.5 text-[10px] font-medium bg-[#F0EBE1] hover:bg-[#E3DDD2] text-charcoal rounded-md transition-colors ml-1"
          >
            今日
          </button>
        </div>
      </div>

      {/* Weekday Titles */}
      <div className="grid grid-cols-7 gap-1 my-1.5 text-center text-[10px] font-medium text-[#8C827A]">
        {WEEKDAY_NAMES.map((name) => (
          <div key={name}>{name}</div>
        ))}
      </div>

      {/* Days Grid */}
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {/* Previous Month Days */}
        {prevDays.map((d) => (
          <div key={`p-${d}`} className="py-1 text-[#CCCCCC] text-[11px]">
            {d}
          </div>
        ))}

        {/* Current Month Days */}
        {currentDays.map((d) => {
          const isSelected = d === selectedDay;
          const hasRedDot = d === 21;
          const hasOrangeDot = d === 22;
          const hasGreenDot = d === 22 || d === 24;
          const hasYellowDot = d === 23;

          return (
            <button
              key={`c-${d}`}
              onClick={() => setSelectedDay(d)}
              className={cn(
                "relative py-1 rounded-full transition-all flex flex-col items-center justify-center h-7 w-7 mx-auto text-[11px]",
                isSelected
                  ? "bg-charcoal text-white font-bold shadow-subtle"
                  : "hover:bg-[#F7F5F5] text-charcoal font-normal"
              )}
            >
              <span>{d}</span>

              {/* Dots */}
              <div className="flex space-x-0.5 -mt-0.5">
                {hasGreenDot && <span className="w-1 h-1 rounded-full bg-[#4A7C59]" />}
                {hasRedDot && <span className="w-1 h-1 rounded-full bg-[#D94F4F]" />}
                {hasOrangeDot && <span className="w-1 h-1 rounded-full bg-[#E28743]" />}
                {hasYellowDot && <span className="w-1 h-1 rounded-full bg-[#D9A05B]" />}
              </div>
            </button>
          );
        })}

        {/* Next Month Days */}
        {nextDays.map((d) => (
          <div key={`n-${d}`} className="py-1 text-[#CCCCCC] text-[11px]">
            {d}
          </div>
        ))}
      </div>

      {/* Legend Footer */}
      <div className="mt-2.5 pt-2.5 border-t border-[#F0EBE1] flex items-center justify-between text-[10px] text-[#676268]">
        <div className="flex items-center space-x-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#4A7C59]" />
          <span>课程</span>
        </div>
        <div className="flex items-center space-x-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#D94F4F]" />
          <span>DDL</span>
        </div>
        <div className="flex items-center space-x-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#8B5CF6]" />
          <span>考试</span>
        </div>
        <div className="flex items-center space-x-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]" />
          <span>活动</span>
        </div>
      </div>
    </div>
  );
}
