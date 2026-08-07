"use client";

import React from "react";
import { ExternalLink, AlertTriangle, ChevronLeft, ChevronRight, MapPin, Clock, User } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { ScheduleConflict } from "@/types";
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
  "19:00",
  "20:00",
  "21:00",
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
  const {
    courses,
    schedules,
    currentSemesterWeek,
    setCurrentSemesterWeek,
    setSelectedCourseId,
    setConflictModalOpen,
    setSelectedConflict,
  } = useAppStore();

  const timeToMinutes = (timeStr: string) => {
    const [h, m] = timeStr.split(":").map(Number);
    return h * 60 + m;
  };

  const dayStartMinutes = 8 * 60;   // 08:00
  const dayEndMinutes = 21 * 60;     // 21:00 (Includes evening classes)
  const totalMinutes = dayEndMinutes - dayStartMinutes; // 780 minutes total

  // Filter schedules active in currentSemesterWeek
  const activeSchedules = schedules.filter((s) => {
    const isExcluded = s.excludedWeeks?.includes(currentSemesterWeek);
    if (isExcluded) return false;
    return true;
  });

  // Conflict Detection Algorithm
  const conflicts: ScheduleConflict[] = [];
  WEEKDAYS.forEach((wd) => {
    const dayScheds = activeSchedules.filter((s) => s.dayOfWeek === wd.dayOfWeek);
    for (let i = 0; i < dayScheds.length; i++) {
      for (let j = i + 1; j < dayScheds.length; j++) {
        const a = dayScheds[i];
        const b = dayScheds[j];
        const startA = timeToMinutes(a.startTime);
        const endA = timeToMinutes(a.endTime);
        const startB = timeToMinutes(b.startTime);
        const endB = timeToMinutes(b.endTime);

        if (startA < endB && startB < endA) {
          conflicts.push({
            scheduleA: a,
            scheduleB: b,
            dayOfWeek: wd.dayOfWeek,
            timeRange: `${a.startTime}-${a.endTime}`,
          });
        }
      }
    }
  });

  const firstConflict = conflicts[0];

  return (
    <div className="bg-white border border-[#E7E3DD] rounded-2xl p-4 shadow-subtle flex flex-col justify-between h-full w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2.5 border-b border-[#F0EBE1] gap-2 shrink-0">
        <div className="flex items-center space-x-2">
          <h2 className="text-sm font-bold text-charcoal">本周课表</h2>
          {/* Semester Week Picker */}
          <div className="flex items-center space-x-1 bg-[#F0EBE1] border border-[#E0D7C6] rounded-lg px-2 py-0.5 text-xs font-semibold text-charcoal">
            <button
              onClick={() => setCurrentSemesterWeek(Math.max(1, currentSemesterWeek - 1))}
              className="hover:text-black transition-colors"
            >
              <ChevronLeft className="w-3 h-3" />
            </button>
            <span>第 {currentSemesterWeek} 周 (学期周次)</span>
            <button
              onClick={() => setCurrentSemesterWeek(Math.min(16, currentSemesterWeek + 1))}
              className="hover:text-black transition-colors"
            >
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        <button
          onClick={() => setSelectedCourseId(courses[0]?.id || null)}
          className="flex items-center space-x-1 text-xs text-[#8C827A] hover:text-charcoal transition-colors bg-[#F7F5F5] px-2 py-1 rounded-lg border border-[#E7E3DD] self-start sm:self-auto"
        >
          <span>查看完整课表</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Conflict Warning Banner */}
      {conflicts.length > 0 && (
        <div className="my-2 p-2.5 bg-[#FDF0F0] border border-[#F8D7D7] rounded-xl flex items-center justify-between text-xs text-[#D94F4F] shrink-0">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              <strong>课程冲突提醒：</strong>检测到 {conflicts.length} 处时间重叠
              （例如 {["周一","周二","周三","周四","周五","周六","周日"][firstConflict.dayOfWeek - 1]} {firstConflict.timeRange}）
            </span>
          </div>
          <button
            onClick={() => {
              setSelectedConflict(firstConflict);
              setConflictModalOpen(true);
            }}
            className="px-2.5 py-1 bg-[#D94F4F] text-white rounded-lg font-bold text-[10px] hover:bg-[#c44343] transition-colors shrink-0"
          >
            解决冲突
          </button>
        </div>
      )}

      {/* Grid Container */}
      <div className="mt-2 flex-1 flex flex-col min-h-0 select-none">
        {/* Weekday Header Row */}
        <div className="grid grid-cols-8 border-b border-[#E7E3DD] pb-2 text-center text-xs shrink-0">
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

        {/* Timetable Body Grid (08:00 to 21:00 Evening Range) */}
        <div className="relative flex-1 grid grid-cols-8 mt-1 min-h-[520px]">
          {/* Time Labels Column */}
          <div className="flex flex-col justify-between text-[10px] text-[#8C827A] font-mono border-r border-[#F0EBE1] pr-1.5 py-0.5 h-full">
            {TIME_SLOTS.map((time, idx) => (
              <div
                key={time}
                className={cn(
                  "flex items-center leading-none",
                  idx === 0 ? "pt-0.5" : ""
                )}
              >
                {time}
              </div>
            ))}
          </div>

          {/* 7 Columns for Days */}
          <div className="col-span-7 grid grid-cols-7 relative border-l border-[#F0EBE1] h-full">
            {/* Horizontal Grid lines */}
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none h-full">
              {Array.from({ length: 13 }).map((_, i) => (
                <div
                  key={i}
                  className="flex-1 border-b border-[#F5F2EE] w-full"
                />
              ))}
            </div>

            {/* Render Compact & Overflow-proof Course Cards */}
            {WEEKDAYS.map((wd) => {
              const daySchedules = activeSchedules.filter(
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

                    const hasConflict = conflicts.some(
                      (c) => c.scheduleA.id === sched.id || c.scheduleB.id === sched.id
                    );

                    const startM = timeToMinutes(sched.startTime);
                    const endM = timeToMinutes(sched.endTime);
                    const topPct =
                      ((startM - dayStartMinutes) / totalMinutes) * 100;
                    const heightPct =
                      ((endM - startM) / totalMinutes) * 100;

                    return (
                      <div
                        key={sched.id}
                        onClick={() => {
                          if (hasConflict) {
                            const foundConf = conflicts.find(
                              (c) => c.scheduleA.id === sched.id || c.scheduleB.id === sched.id
                            );
                            if (foundConf) {
                              setSelectedConflict(foundConf);
                              setConflictModalOpen(true);
                              return;
                            }
                          }
                          setSelectedCourseId(course.id);
                        }}
                        className={cn(
                          "absolute left-0.5 right-0.5 rounded-xl p-2 transition-all duration-200 cursor-pointer shadow-subtle hover:shadow-card hover:-translate-y-0.5 border flex flex-col justify-between overflow-hidden group select-none",
                          hasConflict && "ring-2 ring-[#D94F4F] bg-[#FDF0F0] border-[#F8D7D7]"
                        )}
                        style={{
                          top: `${topPct}%`,
                          height: `${Math.max(heightPct - 0.3, 7.5)}%`,
                          backgroundColor: hasConflict ? "#FDF0F0" : course.bgHex,
                          borderColor: hasConflict ? "#F8D7D7" : course.borderHex,
                          color: hasConflict ? "#D94F4F" : course.textHex,
                        }}
                      >
                        {/* Compact 3-Row Content Layout to prevent any text clipping/overflow */}
                        <div className="space-y-0.5 min-w-0">
                          {/* Row 1: Course Title */}
                          <div className="flex items-center justify-between gap-1">
                            <h4 className="font-extrabold text-[12.5px] leading-tight text-charcoal truncate group-hover:underline">
                              {course.name}
                            </h4>
                            {hasConflict && (
                              <span className="text-[9px] bg-[#D94F4F] text-white px-1 py-0.2 rounded font-bold shrink-0">
                                冲突
                              </span>
                            )}
                          </div>

                          {/* Row 2: Time Range */}
                          <div className="flex items-center text-[9.5px] font-mono opacity-85 space-x-1 leading-none pt-0.5">
                            <Clock className="w-2.5 h-2.5 shrink-0 opacity-70" />
                            <span className="font-semibold">{sched.startTime} - {sched.endTime}</span>
                          </div>

                          {/* Row 3: Teacher & Location in one compact row */}
                          <div className="flex items-center text-[9.5px] opacity-85 space-x-1.5 font-medium leading-none pt-0.5 truncate">
                            <span className="flex items-center truncate">
                              <User className="w-2.5 h-2.5 mr-0.5 shrink-0 opacity-70" />
                              <span className="truncate">{course.teacher}</span>
                            </span>
                            <span className="opacity-40">·</span>
                            <span className="flex items-center truncate">
                              <MapPin className="w-2.5 h-2.5 mr-0.5 shrink-0 opacity-70" />
                              <span className="truncate">{sched.location}</span>
                            </span>
                          </div>
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
