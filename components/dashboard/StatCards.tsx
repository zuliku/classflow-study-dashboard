"use client";

import React from "react";
import { Calendar, ClipboardList, Clock, CheckCircle2 } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { getSemesterWeek } from "@/lib/semester";
import { parseLocalDDL } from "@/lib/ddl";
import { isScheduleActive } from "@/lib/schedule";
import { isSameWeek } from "date-fns";
import { cardKeyHandler } from "@/lib/utils";

/** 指标值变化：仅 2px 上移淡入（不做 count-up 数字滚动） */
function AnimatedMetric({ value }: { value: string }) {
  return (
    <div
      key={value}
      className="ux-metric text-xl font-extrabold text-charcoal tracking-tight"
    >
      {value}
    </div>
  );
}

export function StatCards() {
  const {
    schedules,
    assignments,
    semester,
    setActiveTab,
    setAssignmentTimeSlice,
  } = useAppStore();

  const today = new Date();
  // dayOfWeek: 1 (Mon) - 7 (Sun)
  const currentDayOfWeek = today.getDay() === 0 ? 7 : today.getDay();
  // "今日课程"必须同时判断今天对应的真实教学周与 isScheduleActive；
  // 学期范围外的日期不计入任何课程（如仅 1-8 周开设的课在第 12 周不能计入）
  const realCurrentWeek = getSemesterWeek(today, semester);
  const isInSemester =
    realCurrentWeek >= 1 && realCurrentWeek <= semester.totalWeeks;

  // 1. Today's Courses Count
  const todaySchedules = isInSemester
    ? schedules.filter(
        (s) => s.dayOfWeek === currentDayOfWeek && isScheduleActive(s, realCurrentWeek)
      )
    : [];
  const todayCourseCount = todaySchedules.length;

  // 2. This Week Assignments Count (DDL 按本地时间语义)
  const thisWeekAssignments = assignments.filter((a) => {
    const ddl = parseLocalDDL(a.ddl);
    if (!ddl) return false;
    return isSameWeek(ddl, today, { weekStartsOn: 1 });
  });
  const thisWeekAssignmentsCount = thisWeekAssignments.length;

  // 3. Urgent / High Priority Upcoming DDLs Count
  const urgentDDLs = assignments.filter((a) => {
    if (a.status === "completed") return false;
    return a.priority === "urgent" || a.priority === "high";
  });
  const urgentDDLCount = urgentDDLs.length;

  // 4. Completed Tasks Count
  const completedTasksCount = assignments.filter((a) => a.status === "completed").length;

  // 点击行为：卡片直接跳转到对应 Tab，并带上正确筛选
  const handleCardClick = (id: string) => {
    switch (id) {
      case "today-courses":
        setActiveTab("timetable");
        break;
      case "week-assignments":
        setActiveTab("assignments");
        setAssignmentTimeSlice("all");
        break;
      case "upcoming-ddl":
        setActiveTab("assignments");
        setAssignmentTimeSlice("7days");
        break;
      case "completed-tasks":
        setActiveTab("assignments");
        setAssignmentTimeSlice("completed");
        break;
    }
  };

  const STATS = [
    {
      id: "today-courses",
      title: "今日课程",
      value: `${todayCourseCount} 节`,
      subtext: todayCourseCount > 0 ? `今日共 ${todayCourseCount} 节课程` : "今日暂无课程",
      icon: Calendar,
      bgHex: "#E3E6E0",
      borderHex: "#D0D5CC",
      iconColor: "text-charcoal",
    },
    {
      id: "week-assignments",
      title: "本周任务",
      value: `${thisWeekAssignmentsCount} 项`,
      subtext: `本周有 ${thisWeekAssignmentsCount} 项任务截止`,
      icon: ClipboardList,
      bgHex: "#F0EBE1",
      borderHex: "#CDB9AB",
      iconColor: "text-charcoal",
    },
    {
      id: "upcoming-ddl",
      title: "临近 DDL",
      value: `${urgentDDLCount} 项`,
      subtext: urgentDDLCount > 0 ? "需优先完成" : "暂无紧急任务",
      subtextColor: urgentDDLCount > 0 ? "text-danger font-semibold" : "text-sandrift",
      icon: Clock,
      bgHex: "#F2E8E6",
      borderHex: "#D9BCB8",
      iconColor: "text-danger",
    },
    {
      id: "completed-tasks",
      title: "已完成任务",
      value: `${completedTasksCount} 项`,
      subtext: `累计完成 ${completedTasksCount} 项任务`,
      icon: CheckCircle2,
      bgHex: "#E3E6E0",
      borderHex: "#D0D5CC",
      iconColor: "text-success",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
      {STATS.map((stat) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.id}
            onClick={() => handleCardClick(stat.id)}
            role="button"
            tabIndex={0}
            onKeyDown={cardKeyHandler(() => handleCardClick(stat.id))}
            className="bg-surface border border-line rounded-2xl p-4 shadow-subtle flex items-center justify-between transition-[transform,box-shadow] duration-[var(--motion-base)] ease-[var(--ease-standard)] hover:shadow-card hover:-translate-y-px cursor-pointer"
          >
            <div className="space-y-1">
              <span className="text-xs font-semibold text-sandrift">
                {stat.title}
              </span>
              <AnimatedMetric value={stat.value} />
              <p
                className={`text-[11px] ${
                  stat.subtextColor || "text-sandrift"
                }`}
              >
                {stat.subtext}
              </p>
            </div>

            <div
              className={`w-11 h-11 rounded-2xl flex items-center justify-center border shadow-subtle ${stat.iconColor}`}
              style={{ backgroundColor: stat.bgHex, borderColor: stat.borderHex }}
            >
              <Icon className="w-5 h-5" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
