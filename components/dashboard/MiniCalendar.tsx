"use client";

import React, { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  CalendarDays,
  BookOpen,
  ClipboardCheck,
  Award,
  Plus,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { getSemesterWeek } from "@/lib/semester";
import { getLocalDDLDate, getLocalDDLTime } from "@/lib/ddl";
import { isScheduleActive } from "@/lib/schedule";
import { openAssignmentEditor } from "@/lib/uiEvents";
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
  getDay,
} from "date-fns";
import { zhCN } from "date-fns/locale";

export function MiniCalendar() {
  const {
    schedules,
    assignments,
    calendarMarks,
    courses,
    semester,
    setSelectedCourseId,
    setSelectedAssignmentId,
  } = useAppStore();

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const days = eachDayOfInterval({ start: startDate, end: endDate });

  const handlePrevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const handleNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const handleResetToday = () => {
    const now = new Date();
    setCurrentMonth(now);
    setSelectedDate(now);
  };

  // Selected date agenda items
  const selectedDateStr = format(selectedDate, "yyyy-MM-dd");
  const dayOfWeekNumber = getDay(selectedDate) === 0 ? 7 : getDay(selectedDate);

  // 选中日期的真实学期周次（超出学期范围则无课程）
  const selectedWeek = getSemesterWeek(selectedDate, semester);
  const isSelectedInSemester =
    selectedWeek >= 1 && selectedWeek <= semester.totalWeeks;

  // Active courses on selected date (per-date semester week, not global week)
  const daySchedules = isSelectedInSemester
    ? schedules.filter(
        (s) => s.dayOfWeek === dayOfWeekNumber && isScheduleActive(s, selectedWeek)
      )
    : [];

  // DDL assignments on selected date (本地日期匹配)
  const dayAssignments = assignments.filter(
    (a) => getLocalDDLDate(a.ddl) === selectedDateStr
  );

  // Calendar marks: 严格按类型区分，考试只匹配 exam，活动只匹配 activity
  const dayExams = calendarMarks.filter(
    (m) => m.date === selectedDateStr && m.type === "exam"
  );
  const dayActivities = calendarMarks.filter(
    (m) => m.date === selectedDateStr && m.type === "activity"
  );
  const dayMarks = [...dayExams, ...dayActivities];

  // 打开任务创建并预填选中日期
  const handleQuickAddAssignment = () => {
    openAssignmentEditor({ ddlDate: selectedDateStr });
  };

  // Agenda 按时间顺序排列：课程/DDL 按开始时间，考试/活动排在最后
  type AgendaItem = { key: string; time: string; node: React.ReactNode };
  const agendaItems: AgendaItem[] = [
    ...daySchedules.map((s) => {
      const c = courses.find((crs) => crs.id === s.courseId);
      return {
        key: `s_${s.id}`,
        time: s.startTime,
        node: (
          <div
            key={s.id}
            onClick={() => c && setSelectedCourseId(c.id)}
            className="p-1.5 rounded-lg border text-xs flex items-center justify-between cursor-pointer hover:opacity-90"
            style={{ backgroundColor: `${c?.bgHex || "#F0EBE1"}70`, borderColor: c?.borderHex }}
          >
            <div className="flex items-center space-x-1.5 min-w-0">
              <BookOpen className="w-3 h-3 text-[#A48F82] shrink-0" />
              <span className="font-semibold text-charcoal truncate">{c?.name}</span>
            </div>
            <span className="text-[10px] font-mono text-[#8C827A] shrink-0">
              {s.startTime} - {s.endTime}
            </span>
          </div>
        ),
      };
    }),
    ...dayAssignments.map((a) => ({
      key: `a_${a.id}`,
      time: getLocalDDLTime(a.ddl),
      node: (
        <div
          key={a.id}
          onClick={() => setSelectedAssignmentId(a.id)}
          className="p-1.5 bg-[#FDF0F0] border border-[#F8D7D7] rounded-lg text-xs flex items-center justify-between cursor-pointer text-[#D94F4F]"
        >
          <div className="flex items-center space-x-1.5 min-w-0">
            <ClipboardCheck className="w-3 h-3 shrink-0" />
            <span className="font-bold truncate">{a.title}</span>
          </div>
          <span className="text-[10px] font-bold shrink-0">DDL {getLocalDDLTime(a.ddl)}</span>
        </div>
      ),
    })),
    ...dayExams.map((m) => ({
      key: `e_${m.id}`,
      time: "99:00",
      node: (
        <div
          key={m.id}
          className="p-1.5 bg-[#FFF6EE] border border-[#FDE6D2] rounded-lg text-xs flex items-center justify-between text-[#D97706]"
        >
          <div className="flex items-center space-x-1.5 min-w-0">
            <Award className="w-3 h-3 shrink-0" />
            <span className="font-bold truncate">{m.title}</span>
          </div>
          <span className="text-[10px] font-bold shrink-0">考试</span>
        </div>
      ),
    })),
    ...dayActivities.map((m) => ({
      key: `ac_${m.id}`,
      time: "99:00",
      node: (
        <div
          key={m.id}
          className="p-1.5 bg-[#F2F7F3] border border-[#D4E7D7] rounded-lg text-xs flex items-center justify-between text-[#4A7C59]"
        >
          <div className="flex items-center space-x-1.5 min-w-0">
            <CalendarDays className="w-3 h-3 shrink-0" />
            <span className="font-bold truncate">{m.title}</span>
          </div>
          <span className="text-[10px] font-bold shrink-0">活动</span>
        </div>
      ),
    })),
  ].sort((x, y) => x.time.localeCompare(y.time));

  return (
    <div className="bg-white border border-[#E7E3DD] rounded-2xl p-4 shadow-subtle space-y-3 flex flex-col justify-between">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-[#F0EBE1]">
        <div className="flex items-center space-x-2">
          <CalendarIcon className="w-4 h-4 text-[#A48F82]" />
          <h3 className="text-xs font-bold text-charcoal">
            {format(currentMonth, "yyyy年 M月", { locale: zhCN })}
          </h3>
        </div>

        <div className="flex items-center space-x-1">
          <button
            onClick={handleResetToday}
            className="text-[10px] bg-[#F0EBE1] hover:bg-[#E0D7C6] text-charcoal px-2 py-0.5 rounded-lg font-bold transition-colors mr-1"
          >
            回到今天
          </button>
          <button
            onClick={handlePrevMonth}
            className="p-1 rounded-lg text-[#8C827A] hover:bg-[#F7F5F5] transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleNextMonth}
            className="p-1 rounded-lg text-[#8C827A] hover:bg-[#F7F5F5] transition-colors"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Weekday Row */}
      <div className="grid grid-cols-7 text-center text-[10px] font-bold text-[#8C827A]">
        {["一", "二", "三", "四", "五", "六", "日"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1 text-xs">
        {days.map((day) => {
          const dateStr = format(day, "yyyy-MM-dd");
          const isSelected = isSameDay(day, selectedDate);
          const isCurrentMonth = isSameMonth(day, currentMonth);
          const isTodayDate = isToday(day);

          const dayOfWeekNum = getDay(day) === 0 ? 7 : getDay(day);
          const daySemesterWeek = getSemesterWeek(day, semester);
          const inSemester =
            daySemesterWeek >= 1 && daySemesterWeek <= semester.totalWeeks;

          // Check event types (course activity judged by that date's real semester week)
          const hasCourse =
            inSemester &&
            schedules.some(
              (s) => s.dayOfWeek === dayOfWeekNum && isScheduleActive(s, daySemesterWeek)
            );
          const hasDDL = assignments.some(
            (a) => getLocalDDLDate(a.ddl) === dateStr
          );
          const hasExam = calendarMarks.some(
            (m) => m.date === dateStr && m.type === "exam"
          );
          const hasActivity = calendarMarks.some(
            (m) => m.date === dateStr && m.type === "activity"
          );

          return (
            <button
              key={dateStr}
              onClick={() => setSelectedDate(day)}
              className={`h-8 rounded-xl flex flex-col items-center justify-center relative transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] ${
                isSelected
                  ? "bg-charcoal text-white font-bold shadow-subtle ring-2 ring-black/10"
                  : isTodayDate
                  ? "bg-[#E3E6E0] text-charcoal font-extrabold border border-[#CDB9AB]"
                  : isCurrentMonth
                  ? "text-charcoal hover:bg-[#F7F5F5]"
                  : "text-[#CDB9AB] opacity-40 hover:opacity-80"
              }`}
            >
              <span>{format(day, "d")}</span>

              {/* Event Indicator Dots */}
              <div className="flex items-center space-x-0.5 absolute bottom-1">
                {hasCourse && (
                  <span
                    className={`w-1 h-1 rounded-full ${
                      isSelected ? "bg-white" : "bg-[#4A7C59]"
                    }`}
                  />
                )}
                {hasDDL && (
                  <span
                    className={`w-1 h-1 rounded-full ${
                      isSelected ? "bg-white" : "bg-[#D94F4F]"
                    }`}
                  />
                )}
                {hasExam && (
                  <span
                    className={`w-1 h-1 rounded-full ${
                      isSelected ? "bg-white" : "bg-[#E28743]"
                    }`}
                  />
                )}
                {hasActivity && (
                  <span
                    className={`w-1 h-1 rounded-full ${
                      isSelected ? "bg-white" : "bg-[#7A6FA8]"
                    }`}
                  />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected Date Agenda Details */}
      <div className="pt-2 border-t border-[#F0EBE1] space-y-2">
        <div className="flex justify-between items-center text-xs">
          <span className="font-bold text-charcoal">
            {isSelectedInSemester
              ? `第 ${selectedWeek} 周 · `
              : ""}
            {format(selectedDate, "M月d日 EEEE", { locale: zhCN })} 当日日程
          </span>
          <span className="text-[10px] text-[#8C827A]">
            {daySchedules.length} 门课 · {dayAssignments.length} 个 DDL
            {dayMarks.length > 0 ? ` · ${dayMarks.length} 项日程` : ""}
          </span>
        </div>

        {/* List of day's events */}
        <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
          {agendaItems.length === 0 ? (
            <div className="py-3 text-center space-y-2">
              <p className="text-[11px] text-[#8C827A]">暂无安排</p>
              <button
                onClick={handleQuickAddAssignment}
                className="inline-flex items-center space-x-1 px-3 py-1.5 bg-charcoal hover:bg-black text-white text-[11px] font-bold rounded-xl transition-colors"
              >
                <Plus className="w-3 h-3" />
                <span>添加任务</span>
              </button>
            </div>
          ) : (
            agendaItems.map((item) => <div key={item.key}>{item.node}</div>)
          )}
        </div>
      </div>
    </div>
  );
}
