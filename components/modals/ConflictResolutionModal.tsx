"use client";

import React, { useEffect } from "react";
import { AlertTriangle, X, Trash2 } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { usePresence } from "@/lib/usePresence";
import { cn } from "@/lib/utils";

export function ConflictResolutionModal() {
  const {
    isConflictModalOpen,
    setConflictModalOpen,
    selectedConflict,
    courses,
    currentSemesterWeek,
    deleteSchedule,
    excludeWeekFromSchedule,
  } = useAppStore();

  const { mounted, visible } = usePresence(isConflictModalOpen, 220);

  // Esc 关闭
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConflictModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mounted, setConflictModalOpen]);

  if (!mounted || !selectedConflict) return null;

  const { scheduleA, scheduleB, dayOfWeek, timeRange } = selectedConflict;
  const courseA = courses.find((c) => c.id === scheduleA.courseId);
  const courseB = courses.find((c) => c.id === scheduleB.courseId);

  const dayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const dayName = dayNames[dayOfWeek - 1];

  const handleResolveSkipA = () => {
    excludeWeekFromSchedule(scheduleA.id, currentSemesterWeek);
    setConflictModalOpen(false);
  };

  const handleResolveSkipB = () => {
    excludeWeekFromSchedule(scheduleB.id, currentSemesterWeek);
    setConflictModalOpen(false);
  };

  const handleDeleteA = () => {
    deleteSchedule(scheduleA.id);
    setConflictModalOpen(false);
  };

  const handleDeleteB = () => {
    deleteSchedule(scheduleB.id);
    setConflictModalOpen(false);
  };

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4",
        "ux-overlay",
        visible ? "opacity-100" : "opacity-0"
      )}
    >
      <div
        className={cn(
          "w-full max-w-md bg-white rounded-2xl shadow-drawer border border-[#E7E3DD] overflow-hidden flex flex-col",
          "ux-modal-panel",
          visible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-[0.985] translate-y-1"
        )}
      >
        {/* Header */}
        <div className="p-4 px-6 border-b border-[#F8D7D7] bg-[#FDF0F0] flex items-center justify-between">
          <div className="flex items-center space-x-2 text-[#D94F4F]">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <h3 className="text-base font-bold">课程时间重叠</h3>
          </div>
          <button
            onClick={() => setConflictModalOpen(false)}
            className="p-1 rounded-lg text-[#8C4A4A] hover:bg-[#F8D7D7] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-xs">
          <p className="text-[#676268]">
            以下两门课程在第 {currentSemesterWeek} 周时间重叠（{dayName} {timeRange}）：
          </p>

          {/* Conflicting Courses Cards */}
          <div className="space-y-2">
            {/* Course A */}
            <div
              className="p-3 rounded-xl border flex items-center justify-between"
              style={{ backgroundColor: `${courseA?.bgHex || "#E3E6E0"}60`, borderColor: courseA?.borderHex || "#D0D5CC" }}
            >
              <div>
                <span className="font-bold text-charcoal text-xs">{courseA?.name || "课程 A"}</span>
                <p className="text-[10px] text-[#676268] mt-0.5">
                  教室: {scheduleA.location} · 教师: {courseA?.teacher}
                </p>
              </div>
              <div className="flex space-x-1">
                <button
                  onClick={handleResolveSkipA}
                  className="px-2 py-1 text-[10px] bg-white border border-[#E0D7C6] rounded-lg text-charcoal hover:bg-[#F0EBE1] font-medium"
                  title="本周停课"
                >
                  本周停课
                </button>
                <button
                  onClick={handleDeleteA}
                  className="p-1 text-[#D94F4F] hover:bg-[#FDF0F0] rounded-lg"
                  title="删除该排课"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Course B */}
            <div
              className="p-3 rounded-xl border flex items-center justify-between"
              style={{ backgroundColor: `${courseB?.bgHex || "#F0EBE1"}60`, borderColor: courseB?.borderHex || "#E0D7C6" }}
            >
              <div>
                <span className="font-bold text-charcoal text-xs">{courseB?.name || "课程 B"}</span>
                <p className="text-[10px] text-[#676268] mt-0.5">
                  教室: {scheduleB.location} · 教师: {courseB?.teacher}
                </p>
              </div>
              <div className="flex space-x-1">
                <button
                  onClick={handleResolveSkipB}
                  className="px-2 py-1 text-[10px] bg-white border border-[#E0D7C6] rounded-lg text-charcoal hover:bg-[#F0EBE1] font-medium"
                  title="本周停课"
                >
                  本周停课
                </button>
                <button
                  onClick={handleDeleteB}
                  className="p-1 text-[#D94F4F] hover:bg-[#FDF0F0] rounded-lg"
                  title="删除该排课"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          <div className="p-3 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl text-[11px] text-[#8C827A] space-y-1">
            <p>「本周停课」仅跳过本周；删除将移除该排课。</p>
          </div>

          {/* Footer */}
          <div className="flex justify-end pt-2 border-t border-[#F0EBE1]">
            <button
              onClick={() => setConflictModalOpen(false)}
              className="px-4 py-2 text-xs font-medium text-white bg-charcoal rounded-xl hover:bg-black"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
