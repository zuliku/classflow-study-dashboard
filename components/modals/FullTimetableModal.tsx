"use client";

import React, { useEffect } from "react";
import { X, CalendarDays, Printer, BookOpen, ChevronLeft, ChevronRight } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { isScheduleActive } from "@/lib/schedule";
import { TimetableGrid } from "@/components/dashboard/TimetableGrid";
import { usePresence } from "@/lib/usePresence";
import { useRestoreFocus } from "@/lib/useRestoreFocus";
import { cn } from "@/lib/utils";
import { pushOverlay, popOverlay, isTopmostOverlay } from "@/lib/overlayStack";

const OVERLAY_ID = "full-timetable-modal";

export function FullTimetableModal() {
  const {
    isFullTimetableModalOpen,
    setFullTimetableModalOpen,
    semester,
    currentSemesterWeek,
    setCurrentSemesterWeek,
    courses,
    schedules,
    userProfile,
    setSelectedCourseId,
  } = useAppStore();

  const { mounted, visible } = usePresence(isFullTimetableModalOpen, 220);
  useRestoreFocus(isFullTimetableModalOpen);

  // Esc 关闭（仅在 Overlay 栈最上层时）
  useEffect(() => {
    if (!mounted) return;
    pushOverlay(OVERLAY_ID, 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopmostOverlay(OVERLAY_ID)) setFullTimetableModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      popOverlay(OVERLAY_ID);
      window.removeEventListener("keydown", onKey);
    };
  }, [mounted, setFullTimetableModalOpen]);

  if (!mounted) return null;

  const totalCredits = courses.reduce((sum, c) => sum + c.credit, 0);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6",
        "ux-overlay",
        visible ? "opacity-100" : "opacity-0"
      )}
    >
      <div
        className={cn(
          "w-full max-w-6xl bg-white rounded-3xl shadow-2xl border border-[#E7E3DD] flex flex-col h-[94vh] overflow-hidden",
          "ux-modal-panel",
          visible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-[0.985] translate-y-1"
        )}
      >
        {/* Modal Header */}
        <div className="p-4 px-6 border-b border-[#F0EBE1] bg-[#F7F5F5] flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-[#E3E6E0] border border-[#D0D5CC] flex items-center justify-center text-charcoal shadow-subtle">
              <CalendarDays className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-charcoal flex items-center gap-2">
                {semester.name} · 课表
              </h2>
              <p className="text-xs text-[#8C827A]">
                {userProfile.college} · 在读课程 {courses.length} 门 ({totalCredits} 学分)
              </p>
            </div>
          </div>

          {/* Controls & Actions */}
          <div className="flex items-center space-x-3 shrink-0">
            {/* Semester Week Picker */}
            <div className="flex items-center space-x-1.5 bg-white border border-[#E0D7C6] rounded-xl px-3 py-1.5 text-xs font-semibold text-charcoal shadow-subtle">
              <button
                onClick={() => setCurrentSemesterWeek(currentSemesterWeek - 1)}
                disabled={currentSemesterWeek <= 1}
                title="上一周"
                aria-label="上一周"
                className="hover:text-black p-0.5 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span>第 {currentSemesterWeek} 周 / {semester.totalWeeks}周</span>
              <button
                onClick={() => setCurrentSemesterWeek(currentSemesterWeek + 1)}
                disabled={currentSemesterWeek >= semester.totalWeeks}
                title="下一周"
                aria-label="下一周"
                className="hover:text-black p-0.5 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Print / Export */}
            <button
              onClick={handlePrint}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-[#F0EBE1] border border-[#E0D7C6] text-charcoal text-xs font-bold rounded-xl transition-colors shadow-subtle"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>打印课表</span>
            </button>

            {/* Close */}
            <button
              onClick={() => setFullTimetableModalOpen(false)}
              className="p-1.5 rounded-xl text-[#8C827A] hover:bg-[#E0D7C6] hover:text-charcoal transition-colors border border-[#E0D7C6] bg-white"
              aria-label="关闭"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Main Content Container */}
        <div className="flex-1 p-5 overflow-y-auto space-y-4 bg-[#F7F5F5]">
          {/* 16-Week Semester Matrix Bar */}
          <div className="bg-white border border-[#E7E3DD] rounded-2xl p-3 shadow-subtle space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-charcoal">教学周索引</span>
              <span className="text-[10px] text-[#8C827A]">点击切换周次</span>
            </div>
            <div
              className="grid gap-1.5"
              style={{ gridTemplateColumns: `repeat(${semester.totalWeeks}, minmax(0, 1fr))` }}
            >
              {Array.from({ length: semester.totalWeeks }).map((_, idx) => {
                const weekNum = idx + 1;
                const isActiveWeek = currentSemesterWeek === weekNum;
                const weekClassCount = schedules.filter((s) => isScheduleActive(s, weekNum)).length;

                return (
                  <button
                    key={weekNum}
                    onClick={() => setCurrentSemesterWeek(weekNum)}
                    className={`py-1.5 rounded-xl border text-center transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] ${
                      isActiveWeek
                        ? "bg-charcoal text-white font-extrabold border-black shadow-subtle ring-2 ring-black/10"
                        : weekClassCount > 0
                        ? "bg-[#E3E6E0] text-charcoal border-[#D0D5CC] hover:bg-[#D0D5CC]"
                        : "bg-[#F7F5F5] text-[#8C827A] border-[#E7E3DD]"
                    }`}
                  >
                    <div className="text-xs font-bold leading-none">{weekNum}</div>
                    <div className="text-[9px] opacity-75 leading-none mt-1">{weekClassCount}节</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Timetable Grid View with Spacious Vertical Room */}
          <div className="bg-white rounded-2xl p-1 border border-[#E7E3DD] shadow-subtle min-h-[580px] flex flex-col">
            <TimetableGrid />
          </div>

          {/* Enrolled Courses Summary List */}
          <div className="bg-white border border-[#E7E3DD] rounded-2xl p-4 shadow-subtle space-y-3">
            <h3 className="text-sm font-bold text-charcoal flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-[#A48F82]" />
              在读课程 ({courses.length} 门)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {courses.map((course) => {
                const courseScheds = schedules.filter((s) => s.courseId === course.id);
                return (
                  <div
                    key={course.id}
                    onClick={() => {
                      setFullTimetableModalOpen(false);
                      setSelectedCourseId(course.id);
                    }}
                    className="p-3 rounded-xl border flex flex-col justify-between cursor-pointer transition-all hover:shadow-subtle hover:-translate-y-px"
                    style={{ backgroundColor: `${course.bgHex}60`, borderColor: course.borderHex }}
                  >
                    <div>
                      <div className="flex justify-between items-start">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 bg-white/90 rounded border border-[#E0D7C6] text-charcoal font-semibold">
                          {course.code}
                        </span>
                        <span className="text-xs font-bold text-charcoal">
                          {course.credit} 学分
                        </span>
                      </div>
                      <h4 className="text-xs font-extrabold text-charcoal mt-1.5">
                        {course.name}
                      </h4>
                      <p className="text-[11px] text-[#676268] mt-0.5">
                        教师：{course.teacher} · 教室：{course.classroom}
                      </p>
                    </div>

                    <div className="mt-2 pt-1.5 border-t border-black/5 text-[10px] text-[#8C827A] flex items-center justify-between">
                      <span>{courseScheds.length} 个上课时段</span>
                      <span className="font-bold text-charcoal">详情</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
