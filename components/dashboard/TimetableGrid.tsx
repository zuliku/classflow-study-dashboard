"use client";

import React from "react";
import { ExternalLink, MapPin, Clock } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

const TIME_SLOTS = [
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
];

const WEEKDAYS = [
  { dayOfWeek: 1, label: "周一", dateStr: "5/19" },
  { dayOfWeek: 2, label: "周二", dateStr: "5/20" },
  { dayOfWeek: 3, label: "周三", dateStr: "5/21" },
  { dayOfWeek: 4, label: "周四", dateStr: "5/22" },
  { dayOfWeek: 5, label: "周五", dateStr: "5/23" },
  { dayOfWeek: 6, label: "周六", dateStr: "5/24" },
  { dayOfWeek: 7, label: "周日", dateStr: "5/25" },
];

export function TimetableGrid() {
  const { courses, schedules, setSelectedCourseId } = useAppStore();

  const timeToMinutes = (timeStr: string) => {
    const [h, m] = timeStr.split(":").map(Number);
    return h * 60 + m;
  };

  const dayStartMinutes = 8 * 60;  // 08:00
  const dayEndMinutes = 18 * 60;    // 18:00
  const totalMinutes = dayEndMinutes - dayStartMinutes; // 600 minutes total

  return (
    <div className="bg-white border border-[#E7E3DD] rounded-2xl p-4 shadow-subtle flex flex-col w-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[#F0EBE1]">
        <h2 className="text-sm font-bold text-charcoal flex items-center gap-1.5">
          本周课表
        </h2>
        <button
          onClick={() => setSelectedCourseId(courses[0]?.id || null)}
          className="flex items-center space-x-1 text-xs text-[#8C827A] hover:text-charcoal transition-colors bg-[#F7F5F5] px-2 py-1 rounded-lg border border-[#E7E3DD]"
        >
          <span>查看完整课表</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Grid Container */}
      <div className="mt-2.5 flex-1 flex flex-col overflow-x-auto select-none">
        {/* Weekday Header Row */}
        <div className="grid grid-cols-8 border-b border-[#E7E3DD] pb-2 text-center text-xs">
          <div className="text-[#8C827A] font-medium py-0.5 text-[11px]">时间</div>
          {WEEKDAYS.map((wd) => (
            <div
              key={wd.dayOfWeek}
              className="py-0.5 rounded-lg text-[#676268] font-medium"
            >
              <span>{wd.label}</span>
              <span className="text-[10px] text-[#8C827A] ml-1">
                {wd.dateStr}
              </span>
            </div>
          ))}
        </div>

        {/* Timetable Body Grid with Explicit Height */}
        <div className="relative grid grid-cols-8 mt-1 h-[520px]">
          {/* Time Labels Column */}
          <div className="flex flex-col justify-between text-[11px] text-[#8C827A] font-mono border-r border-[#F0EBE1] pr-1">
            {TIME_SLOTS.map((time) => (
              <div key={time} className="h-12 flex items-start -mt-2">
                {time}
              </div>
            ))}
          </div>

          {/* 7 Columns for Days */}
          <div className="col-span-7 grid grid-cols-7 relative border-l border-[#F0EBE1] h-full">
            {/* Horizontal Grid lines */}
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
              {TIME_SLOTS.map((_, i) => (
                <div
                  key={i}
                  className="border-b border-[#F5F2EE] w-full h-12"
                />
              ))}
            </div>

            {/* Render Course Blocks */}
            {WEEKDAYS.map((wd) => {
              const daySchedules = schedules.filter(
                (s) => s.dayOfWeek === wd.dayOfWeek
              );

              return (
                <div
                  key={wd.dayOfWeek}
                  className="relative border-r border-[#F5F2EE] h-full"
                >
                  {daySchedules.map((sched) => {
                    const course = courses.find((c) => c.id === sched.courseId);
                    if (!course) return null;

                    const startM = timeToMinutes(sched.startTime);
                    const endM = timeToMinutes(sched.endTime);
                    const topPct =
                      ((startM - dayStartMinutes) / totalMinutes) * 100;
                    const heightPct =
                      ((endM - startM) / totalMinutes) * 100;

                    return (
                      <div
                        key={sched.id}
                        onClick={() => setSelectedCourseId(course.id)}
                        className="absolute left-1 right-1 rounded-xl p-2.5 transition-all duration-200 cursor-pointer shadow-subtle hover:shadow-card hover:-translate-y-0.5 border flex flex-col justify-start space-y-1 overflow-hidden group"
                        style={{
                          top: `${topPct}%`,
                          height: `${Math.max(heightPct - 0.5, 8)}%`,
                          backgroundColor: course.bgHex,
                          borderColor: course.borderHex,
                          color: course.textHex,
                        }}
                      >
                        <h4 className="font-bold text-xs leading-snug truncate group-hover:underline">
                          {course.name}
                        </h4>
                        <p className="text-[10px] opacity-80 font-mono flex items-center shrink-0">
                          {sched.startTime} - {sched.endTime}
                        </p>
                        <div className="text-[10px] opacity-85 truncate flex items-center font-medium shrink-0">
                          {sched.location}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
