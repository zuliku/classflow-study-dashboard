"use client";

import React, { useMemo } from "react";
import { Calendar, ClipboardList, Clock } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { getSemesterWeek } from "@/lib/semester";
import { parseLocalDDL } from "@/lib/ddl";
import { isScheduleActive, timeToMinutes } from "@/lib/schedule";
import { isSameWeek, differenceInDays, format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { cn } from "@/lib/utils";

const PANEL_MAX = 5;

/**
 * Overview Quick Glance（首页时间表 Header 内的 3 个微型状态入口）：
 * 今日课程 / 本周待完成任务 / 临近 DDL。
 * - 默认只显示 Icon + Count（26–28px compact chip，neutral）
 * - Hover / Focus：轻量 Detail Popover（最多 5 项 + 还有 N 项）
 * - Click：跳转对应 Workspace（Hover = Preview，Click = Go）
 * 统计口径与 StatCards / UpcomingDDL 完全一致。
 */
export function TimetableQuickGlance() {
  const { schedules, assignments, courses, semester, preferences, setActiveTab, setAssignmentTimeSlice } =
    useAppStore();

  const today = new Date();
  const currentDayOfWeek = today.getDay() === 0 ? 7 : today.getDay();
  const realCurrentWeek = getSemesterWeek(today, semester);
  const isInSemester = realCurrentWeek >= 1 && realCurrentWeek <= semester.totalWeeks;

  // ---- 今日课程：真实教学周 + isScheduleActive（单双周 / excludedWeeks 正确） ----
  const todaySchedules = useMemo(
    () =>
      isInSemester
        ? schedules
            .filter((s) => s.dayOfWeek === currentDayOfWeek && isScheduleActive(s, realCurrentWeek))
            .sort((a, b) => (timeToMinutes(a.startTime) ?? 0) - (timeToMinutes(b.startTime) ?? 0))
        : [],
    [schedules, isInSemester, realCurrentWeek, currentDayOfWeek]
  );

  // ---- 本周任务：本周 DDL 截止（首页口径 = 待完成） ----
  const thisWeekPending = useMemo(
    () =>
      assignments
        .filter((a) => {
          if (a.status === "completed") return false;
          const ddl = parseLocalDDL(a.ddl);
          return !!ddl && isSameWeek(ddl, today, { weekStartsOn: 1 });
        })
        .sort((a, b) => (parseLocalDDL(a.ddl)?.getTime() ?? 0) - (parseLocalDDL(b.ddl)?.getTime() ?? 0)),
    [assignments, today]
  );

  // ---- 临近 DDL：与 UpcomingDDL 同源（未完成 / 未逾期 / ddlWarningDays 窗口内） ----
  const warningDays = preferences.ddlWarningDays;
  const upcoming = useMemo(
    () =>
      [...assignments]
        .filter((a) => {
          if (a.status === "completed") return false;
          const ddlDate = parseLocalDDL(a.ddl);
          if (!ddlDate) return false;
          const diff = differenceInDays(ddlDate, today);
          return diff >= 0 && diff <= warningDays;
        })
        .sort((a, b) => (parseLocalDDL(a.ddl)?.getTime() ?? 0) - (parseLocalDDL(b.ddl)?.getTime() ?? 0)),
    [assignments, warningDays, today]
  );

  const courseNameOf = (id: string) => courses.find((c) => c.id === id)?.name ?? "";

  const navigate = (id: "timetable" | "assignments") => {
    if (id === "timetable") {
      setActiveTab("timetable");
    } else {
      setActiveTab("assignments");
      setAssignmentTimeSlice("all");
    }
  };

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {/* 今日课程 */}
      <GlanceChip
        icon={Calendar}
        iconColor="text-sandrift"
        label={`今日课程，共 ${todaySchedules.length} 节`}
        count={todaySchedules.length}
        onClick={() => navigate("timetable")}
      >
        <div className="space-y-1">
          <p className="text-[10px] font-bold text-sandrift">今日课程 · {todaySchedules.length}</p>
          {todaySchedules.length === 0 ? (
            <p className="text-[11px] text-charcoal font-semibold">今日暂无课程</p>
          ) : (
            <>
              {todaySchedules.slice(0, PANEL_MAX).map((s) => (
                <div key={s.id} className="flex items-baseline gap-2">
                  <span className="text-[10px] tabular-nums text-sandrift shrink-0 w-11">{s.startTime}</span>
                  <span className="text-[11px] font-semibold text-charcoal truncate">{courseNameOf(s.courseId)}</span>
                </div>
              ))}
              {todaySchedules.length > PANEL_MAX && (
                <p className="text-[10px] text-sandrift">还有 {todaySchedules.length - PANEL_MAX} 节课程</p>
              )}
            </>
          )}
        </div>
      </GlanceChip>

      {/* 本周任务（待完成） */}
      <GlanceChip
        icon={ClipboardList}
        iconColor="text-sandrift"
        label={`本周待完成任务，共 ${thisWeekPending.length} 项`}
        count={thisWeekPending.length}
        onClick={() => navigate("assignments")}
      >
        <div className="space-y-1">
          <p className="text-[10px] font-bold text-sandrift">本周任务 · {thisWeekPending.length} 待完成</p>
          {thisWeekPending.length === 0 ? (
            <p className="text-[11px] text-charcoal font-semibold">本周任务已全部完成</p>
          ) : (
            <>
              {thisWeekPending.slice(0, PANEL_MAX).map((a) => {
                const ddl = parseLocalDDL(a.ddl);
                return (
                  <div key={a.id} className="flex items-center justify-between gap-3">
                    <span className="text-[11px] font-semibold text-charcoal truncate">{a.title}</span>
                    <span className="text-[10px] tabular-nums text-sandrift shrink-0">
                      {ddl ? format(ddl, "E HH:mm", { locale: zhCN }) : ""}
                    </span>
                  </div>
                );
              })}
              {thisWeekPending.length > PANEL_MAX && (
                <p className="text-[10px] text-sandrift">还有 {thisWeekPending.length - PANEL_MAX} 项</p>
              )}
            </>
          )}
        </div>
      </GlanceChip>

      {/* 临近 DDL */}
      <GlanceChip
        icon={Clock}
        iconColor={upcoming.length > 0 ? "text-danger/80" : "text-sandrift"}
        label={`临近 DDL，共 ${upcoming.length} 项`}
        count={upcoming.length}
        onClick={() => {
          setActiveTab("assignments");
          setAssignmentTimeSlice("7days");
        }}
      >
        <div className="space-y-1">
          <p className="text-[10px] font-bold text-sandrift">临近 DDL · {upcoming.length}</p>
          {upcoming.length === 0 ? (
            <p className="text-[11px] text-charcoal font-semibold">暂无临近 DDL</p>
          ) : (
            <>
              {upcoming.slice(0, PANEL_MAX).map((a) => {
                const ddl = parseLocalDDL(a.ddl);
                const hot = a.priority === "urgent" || a.priority === "high";
                return (
                  <div key={a.id} className="flex items-center justify-between gap-3">
                    <span className="text-[11px] font-semibold text-charcoal truncate">
                      {hot && <span aria-hidden="true" className="inline-block w-1.5 h-1.5 rounded-full bg-danger/70 mr-1.5 align-middle" />}
                      {a.title}
                    </span>
                    <span className="text-[10px] tabular-nums text-sandrift shrink-0">
                      {ddl ? format(ddl, "E HH:mm", { locale: zhCN }) : ""}
                    </span>
                  </div>
                );
              })}
              {upcoming.length > PANEL_MAX && (
                <p className="text-[10px] text-sandrift">还有 {upcoming.length - PANEL_MAX} 项</p>
              )}
            </>
          )}
        </div>
      </GlanceChip>
    </div>
  );
}

/** 单个 Quick Glance chip：Icon + Count；Hover / Focus 展开 Detail Popover（与按钮同 group，鼠标可移入） */
function GlanceChip({
  icon: Icon,
  iconColor,
  label,
  count,
  onClick,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  label: string;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative group">
      <button
        onClick={onClick}
        aria-label={label}
        className={cn(
          "flex items-center gap-1.5 h-7 px-2 rounded-lg border border-line-soft bg-transparent",
          "text-[11px] font-bold text-charcoal",
          "hover:bg-alabaster hover:border-line transition-colors duration-[var(--motion-fast)]",
          "focus-visible:bg-alabaster focus-visible:border-line focus:outline-none"
        )}
      >
        <Icon className={cn("w-3.5 h-3.5", iconColor)} />
        <span className="tabular-nums leading-none">{count}</span>
      </button>
      {/* Detail Popover：hover / focus-within 显示；right-0 对齐避免越出 Card */}
      <div
        role="tooltip"
        className="absolute right-0 top-full mt-1.5 w-[240px] bg-surface border border-line-strong rounded-xl shadow-card px-3 py-2.5 z-30 ux-inline opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible transition-opacity duration-[var(--motion-fast)]"
      >
        {children}
      </div>
    </div>
  );
}
