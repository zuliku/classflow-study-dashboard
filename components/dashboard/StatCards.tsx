"use client";

import React from "react";
import { Calendar, ClipboardList, Clock, CheckCircle2 } from "lucide-react";
import { useAppStore, isScheduleActive } from "@/store/useAppStore";
import { getSemesterWeek } from "@/lib/semester";
import { format, parseISO, isSameWeek, isSameDay } from "date-fns";

export function StatCards() {
  const { schedules, assignments, semester } = useAppStore();

  const today = new Date();
  // dayOfWeek: 1 (Mon) - 7 (Sun)
  const currentDayOfWeek = today.getDay() === 0 ? 7 : today.getDay();
  // "今日课程"以今天的真实学期周次为准（isScheduleActive 是唯一周次判断入口）
  const currentWeek = Math.min(
    Math.max(getSemesterWeek(today, semester), 1),
    semester.totalWeeks
  );

  // 1. Today's Courses Count
  const todaySchedules = schedules.filter(
    (s) => s.dayOfWeek === currentDayOfWeek && isScheduleActive(s, currentWeek)
  );
  const todayCourseCount = todaySchedules.length;

  // 2. This Week Assignments Count
  const thisWeekAssignments = assignments.filter((a) => {
    try {
      const ddl = parseISO(a.ddl);
      return isSameWeek(ddl, today, { weekStartsOn: 1 });
    } catch (e) {
      return false;
    }
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

  const STATS = [
    {
      id: "today-courses",
      title: "今日课程",
      value: `${todayCourseCount} 节`,
      subtext: todayCourseCount > 0 ? `已有 ${todayCourseCount} 节课程安排` : "今日暂无课程安排",
      icon: Calendar,
      bgHex: "#E3E6E0",
      borderHex: "#D0D5CC",
      iconColor: "text-charcoal",
    },
    {
      id: "week-assignments",
      title: "本周作业",
      value: `${thisWeekAssignmentsCount} 项`,
      subtext: `本周需交付作业 ${thisWeekAssignmentsCount} 项`,
      icon: ClipboardList,
      bgHex: "#F0EBE1",
      borderHex: "#E0D7C6",
      iconColor: "text-charcoal",
    },
    {
      id: "upcoming-ddl",
      title: "临近 DDL",
      value: `${urgentDDLCount} 项`,
      subtext: urgentDDLCount > 0 ? "需优先完成" : "暂无紧急任务",
      subtextColor: urgentDDLCount > 0 ? "text-[#D94F4F] font-semibold" : "text-[#8C827A]",
      icon: Clock,
      bgHex: "#FDF0F0",
      borderHex: "#F8D7D7",
      iconColor: "text-[#D94F4F]",
    },
    {
      id: "completed-tasks",
      title: "已完成任务",
      value: `${completedTasksCount} 项`,
      subtext: `累计完成 ${completedTasksCount} 项任务`,
      icon: CheckCircle2,
      bgHex: "#E3E6E0",
      borderHex: "#D0D5CC",
      iconColor: "text-[#4A7C59]",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {STATS.map((stat) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.id}
            className="bg-white border border-[#E7E3DD] rounded-2xl p-4 shadow-subtle flex items-center justify-between transition-all duration-200 hover:shadow-card hover:-translate-y-0.5 cursor-pointer"
          >
            <div className="space-y-1">
              <span className="text-xs font-semibold text-[#8C827A]">
                {stat.title}
              </span>
              <div className="text-xl font-extrabold text-charcoal tracking-tight">
                {stat.value}
              </div>
              <p
                className={`text-[11px] ${
                  stat.subtextColor || "text-[#8C827A]"
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
