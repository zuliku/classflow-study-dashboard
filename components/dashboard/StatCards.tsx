"use client";

import React, { useMemo } from "react";
import { Calendar, ClipboardList, Clock, CheckCircle2, ArrowUpRight } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { getSemesterWeek } from "@/lib/semester";
import { parseLocalDDL } from "@/lib/ddl";
import { isScheduleActive, timeToMinutes } from "@/lib/schedule";
import { isSameWeek, differenceInDays, format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { cardKeyHandler, cn } from "@/lib/utils";

/** 指标值变化：仅 2px 上移淡入（不做 count-up 数字滚动）；semibold 为焦点而非 extrabold */
function AnimatedMetric({ value }: { value: string }) {
  return (
    <div
      key={value}
      className="ux-metric text-[26px] font-semibold text-charcoal tracking-tight leading-none"
    >
      {value}
    </div>
  );
}

/**
 * Overview 顶部 Stat Cards：克制型信息密度卡片。
 * - 统一 neutral surface + border-line-soft，hover 仅加深边框，无浮起/阴影
 * - 数据语义与业务模块一致：
 *   临近 DDL = 与 UpcomingDDL 同源（未完成 / 未逾期 / 在 ddlWarningDays 窗口内）
 *   本周任务 = 本周 DDL 截止的任务，副信息给待完成数
 *   已完成 = 总任务完成率
 */
export function StatCards() {
  const {
    schedules,
    assignments,
    courses,
    semester,
    preferences,
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

  // ---- 今日课程：数量 + 下一节课（startTime + 课程名） ----
  const todaySchedules = useMemo(
    () =>
      isInSemester
        ? schedules
            .filter(
              (s) =>
                s.dayOfWeek === currentDayOfWeek && isScheduleActive(s, realCurrentWeek)
            )
            .sort((a, b) => (timeToMinutes(a.startTime) ?? 0) - (timeToMinutes(b.startTime) ?? 0))
        : [],
    [schedules, isInSemester, realCurrentWeek, currentDayOfWeek]
  );
  const nowMinutes = today.getHours() * 60 + today.getMinutes();
  const nextClass = todaySchedules.find(
    (s) => (timeToMinutes(s.endTime) ?? 0) > nowMinutes
  );
  const nextCourse = nextClass ? courses.find((c) => c.id === nextClass.courseId) : null;

  // ---- 本周任务：本周 DDL 截止 + 待完成数 ----
  const thisWeekAssignments = useMemo(
    () =>
      assignments.filter((a) => {
        const ddl = parseLocalDDL(a.ddl);
        if (!ddl) return false;
        return isSameWeek(ddl, today, { weekStartsOn: 1 });
      }),
    [assignments, today]
  );
  const thisWeekPendingCount = thisWeekAssignments.filter(
    (a) => a.status !== "completed"
  ).length;

  // ---- 临近 DDL：与 UpcomingDDL 同源（未完成 / 未逾期 / ddlWarningDays 窗口内） ----
  const warningDays = preferences.ddlWarningDays;
  const upcomingAssignments = useMemo(
    () =>
      [...assignments]
        .filter((a) => {
          if (a.status === "completed") return false;
          const ddlDate = parseLocalDDL(a.ddl);
          if (!ddlDate) return false;
          const diff = differenceInDays(ddlDate, today);
          return diff >= 0 && diff <= warningDays;
        })
        .sort((a, b) => {
          const timeA = parseLocalDDL(a.ddl)?.getTime() ?? 0;
          const timeB = parseLocalDDL(b.ddl)?.getTime() ?? 0;
          return timeA - timeB;
        }),
    [assignments, warningDays, today]
  );
  const closestDDL = upcomingAssignments[0] ? parseLocalDDL(upcomingAssignments[0].ddl) : null;
  const highPriorityCount = upcomingAssignments.filter(
    (a) => a.priority === "urgent" || a.priority === "high"
  ).length;

  // ---- 已完成：总完成率 ----
  const completedTasksCount = assignments.filter((a) => a.status === "completed").length;
  const completionRate =
    assignments.length > 0
      ? Math.round((completedTasksCount / assignments.length) * 100)
      : 0;

  // 点击行为：卡片直接跳转到对应 Tab，并带上正确筛选
  const handleCardClick = (id: string) => {
    switch (id) {
      case "today-courses":
        setActiveTab("timetable");
        break;
      case "week-assignments":
        // 现有模型无 week filter；最小处理：保留现有 all 行为，不做 Store 改造
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
      value: `${todaySchedules.length} 节`,
      subtext:
        todaySchedules.length === 0
          ? "今日暂无课程"
          : nextClass
          ? `${nextCourse?.name ?? "课程"} · ${nextClass.startTime}`
          : "今日课程已结束",
      icon: Calendar,
      iconColor: "text-sandrift",
    },
    {
      id: "week-assignments",
      title: "本周任务",
      value: `${thisWeekAssignments.length} 项`,
      subtext:
        thisWeekAssignments.length === 0
          ? "本周暂无任务截止"
          : thisWeekPendingCount > 0
          ? `待完成 ${thisWeekPendingCount} 项`
          : "本周任务已全部完成",
      icon: ClipboardList,
      iconColor: "text-sandrift",
    },
    {
      id: "upcoming-ddl",
      title: "临近 DDL",
      value: `${upcomingAssignments.length} 项`,
      subtext:
        upcomingAssignments.length === 0
          ? "暂无临近 DDL"
          : closestDDL
          ? `最近 ${format(closestDDL, "M月d日 HH:mm")}${highPriorityCount > 0 ? ` · 高优 ${highPriorityCount}` : ""}`
          : "暂无临近 DDL",
      icon: Clock,
      iconColor: upcomingAssignments.length > 0 ? "text-danger" : "text-sandrift",
    },
    {
      id: "completed-tasks",
      title: "已完成任务",
      value: assignments.length > 0 ? `${completionRate}%` : "0%",
      subtext:
        assignments.length === 0
          ? "暂无任务"
          : `已完成 ${completedTasksCount} 项`,
      icon: CheckCircle2,
      iconColor: "text-success",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {STATS.map((stat) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.id}
            onClick={() => handleCardClick(stat.id)}
            role="button"
            tabIndex={0}
            onKeyDown={cardKeyHandler(() => handleCardClick(stat.id))}
            className="group h-[104px] p-3.5 bg-surface border border-line-soft rounded-xl flex flex-col transition-colors duration-[var(--motion-base)] ease-[var(--ease-standard)] hover:border-line-strong cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-sandrift">
                {stat.title}
              </span>
              <span className="flex items-center gap-1">
                <Icon className={cn("w-4 h-4 transition-colors", stat.iconColor)} />
                <ArrowUpRight className="w-3.5 h-3.5 text-satin-grey opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--motion-fast)]" />
              </span>
            </div>

            <div className="mt-auto space-y-1 pt-2">
              <AnimatedMetric value={stat.value} />
              <p className="text-[11px] text-sandrift truncate">{stat.subtext}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
