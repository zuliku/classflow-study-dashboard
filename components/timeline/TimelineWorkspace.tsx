"use client";

import React, { useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Plus,
  MoreHorizontal,
  FileUp,
  ExternalLink,
  Settings as SettingsIcon,
  GraduationCap,
  ListChecks,
  CalendarClock,
  BookOpenCheck,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { useKiroHandoff } from "@/hooks/useKiroHandoff";
import { KIRO_ICON } from "@/components/layout/navItems";
import { TimetableGrid } from "@/components/dashboard/TimetableGrid";
import { TimelineKeyLane } from "@/components/timeline/TimelineKeyLane";
import { TimelineUnscheduledShelf } from "@/components/timeline/TimelineUnscheduledShelf";
import { KiroMenuPanel, KiroMenuItem, KiroMenuDivider } from "@/components/kiro/KiroMenu";
import { getWeekDateRange, formatWeekDateRange } from "@/lib/semester";
import { deriveTimelineItems, deriveUnscheduledAssignments } from "@/lib/timeline/deriveTimelineItems";
import { timeToMinutes } from "@/lib/timeline/timelineGeometry";
import { Assignment, CalendarMark, StudyBlock } from "@/types";
import { cn } from "@/lib/utils";

interface TimelineFilters {
  studyBlocks: boolean;
  ddl: boolean;
  exam: boolean;
  activity: boolean;
  group: boolean;
}

const DEFAULT_FILTERS: TimelineFilters = {
  studyBlocks: true,
  ddl: true,
  exam: true,
  activity: true,
  group: true,
};

/** 学习计划与课程 / 其他学习计划的时间重叠校验 */
export function studyBlockConflict(
  block: { date: string; startTime: string; endTime: string; courseId?: string; id?: string },
  state: {
    schedules: { id: string; courseId: string; dayOfWeek: number; startTime: string; endTime: string; weeks: string }[];
    studyBlocks: StudyBlock[];
    currentSemesterWeek: number;
  }
): { courseName?: string; otherTitle?: string } | null {
  const s = timeToMinutes(block.startTime) ?? 0;
  const e = timeToMinutes(block.endTime) ?? s + 60;
  if (e <= s) return { otherTitle: "结束时间需晚于开始时间" };
  const dow = new Date(`${block.date}T00:00:00`).getDay() || 7;
  for (const sch of state.schedules) {
    if (sch.dayOfWeek !== dow || (block.courseId && sch.courseId !== block.courseId && false)) continue;
    const ss = timeToMinutes(sch.startTime) ?? 0;
    const se = timeToMinutes(sch.endTime) ?? ss + 60;
    if (s < se && ss < e) {
      return { courseName: `课程时间重叠（${sch.startTime}–${sch.endTime}）` };
    }
  }
  for (const b of state.studyBlocks) {
    if (b.id === block.id || b.date !== block.date) continue;
    const bs = timeToMinutes(b.startTime) ?? 0;
    const be = timeToMinutes(b.endTime) ?? bs + 60;
    if (s < be && bs < e) return { otherTitle: `与学习计划《${b.title}》重叠` };
  }
  return null;
}

/**
 * ClassFlow Timeline V1 Workspace：
 * 以课程为骨架的学生时间表。单 Card：Header Controls → Weekday → Key Timeline → Course Grid → Unscheduled Shelf。
 */
export function TimelineWorkspace() {
  const {
    courses,
    schedules,
    assignments,
    calendarMarks,
    groupProjects,
    studyBlocks,
    semester,
    currentSemesterWeek,
    setCurrentSemesterWeek,
    preferences,
    setAddCourseModalOpen,
    setImportScheduleModalOpen,
    setFullTimetableModalOpen,
    addStudyBlock,
    deleteStudyBlock,
    addCalendarMark,
  } = useAppStore();
  const pushToast = useToastStore((s) => s.pushToast);
  const handoff = useKiroHandoff();

  const [filters, setFilters] = useState<TimelineFilters>(DEFAULT_FILTERS);
  const [quickOpen, setQuickOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [arrangeFor, setArrangeFor] = useState<Assignment | null>(null);
  const [freeBlockOpen, setFreeBlockOpen] = useState(false);
  const [markOpen, setMarkOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const weekDays = getWeekDateRange(semester, currentSemesterWeek);
  const weekDates = weekDays.map((d) => format(d, "yyyy-MM-dd"));
  const dayCount = preferences.showWeekends ? 7 : 5;
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const isCurrentWeek = todayStr >= weekDates[0] && todayStr <= weekDates[6];

  const courseNameOf = useMemo(
    () => (courseId: string) => courses.find((c) => c.id === courseId)?.name ?? "",
    [courses]
  );

  const items = useMemo(
    () =>
      deriveTimelineItems({
        weekDates,
        assignments,
        calendarMarks,
        groupProjects,
        studyBlocks,
        courseNameOf,
      }),
    [weekDates, assignments, calendarMarks, groupProjects, studyBlocks, courseNameOf]
  );

  const visibleItems = useMemo(
    () =>
      items.filter((it) => {
        if (it.sourceType === "group-task") return filters.group;
        if (it.sourceType === "exam") return filters.exam;
        if (it.sourceType === "activity") return filters.activity;
        return filters.ddl;
      }),
    [items, filters]
  );

  const unscheduled = useMemo(
    () => deriveUnscheduledAssignments({ assignments, studyBlocks }),
    [assignments, studyBlocks]
  );

  // ---- StudyBlock 层（Grid 内弱时间块）----
  const studyLayer = (ctx: {
    dayOfWeek: number;
    dayStartMinutes: number;
    totalMinutes: number;
    timeToMinutes: (t: string) => number;
  }) => {
    if (!filters.studyBlocks) return null;
    const date = weekDates[ctx.dayOfWeek - 1];
    const dayBlocks = studyBlocks.filter((b) => b.date === date);
    return (
      <>
        {dayBlocks.map((b) => {
          const s = ctx.timeToMinutes(b.startTime) ?? 0;
          const e = ctx.timeToMinutes(b.endTime) ?? s + 60;
          const topPct = ((s - ctx.dayStartMinutes) / ctx.totalMinutes) * 100;
          const heightPct = ((e - s) / ctx.totalMinutes) * 100;
          const duration = Math.round((e - s) / 60);
          return (
            <div
              key={b.id}
              data-testid="timeline-study-block"
              title={`${b.title} · ${b.startTime}–${b.endTime}（${duration} 分钟）`}
              className="absolute left-1 right-1 rounded-lg border border-dashed border-line-strong bg-pastel-mint/20 px-1.5 py-0.5 flex items-center gap-1 overflow-hidden pointer-events-auto"
              style={{ top: `${topPct}%`, height: `${Math.max(heightPct - 0.3, 7)}%` }}
            >
              <span className="truncate text-[10px] font-semibold text-satin-grey">{b.title}</span>
              <span className="text-[9px] text-sandrift font-medium shrink-0">{duration}min</span>
              <button
                onClick={() => {
                  deleteStudyBlock(b.id);
                  pushToast({ message: "已删除学习计划" });
                }}
                aria-label={`删除学习计划 ${b.title}`}
                className="ml-auto p-0.5 rounded text-sandrift hover:text-danger transition-colors shrink-0 opacity-60 hover:opacity-100"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          );
        })}
      </>
    );
  };

  // ---- 安排学习计划 ----
  const submitArrange = (a: Assignment | null, date: string, start: string, end: string) => {
    const conflict = studyBlockConflict(
      { date, startTime: start, endTime: end, courseId: a?.courseId },
      { schedules, studyBlocks, currentSemesterWeek }
    );
    if (conflict) {
      pushToast({ type: "error", message: conflict.courseName ?? conflict.otherTitle ?? "时间重叠" });
      return;
    }
    addStudyBlock({
      title: a?.title ?? "学习计划",
      date,
      startTime: start,
      endTime: end,
      assignmentId: a?.id,
      courseId: a?.courseId,
      source: "manual",
    });
    pushToast({ message: `已安排学习计划：${a?.title ?? "学习计划"}` });
    setArrangeFor(null);
  };

  const submitMark = (m: { title: string; type: "exam" | "activity"; date: string; startTime?: string; endTime?: string }) => {
    addCalendarMark({
      date: m.date,
      type: m.type,
      title: m.title,
      startTime: m.startTime || undefined,
      endTime: m.endTime || undefined,
    });
    pushToast({ message: `已添加${m.type === "exam" ? "考试" : "活动"}` });
    setMarkOpen(false);
  };

  const isToday = (dateStr: string) => dateStr === todayStr;

  // 当前时间线（真实当前周才显示）
  const nowLine = isCurrentWeek
    ? { date: todayStr, ratio: (new Date().getHours() * 60 + new Date().getMinutes()) / 1440 }
    : null;

  return (
    <div
      ref={wrapRef}
      data-testid="timeline-workspace"
      className="flex-1 flex flex-col min-h-0 bg-surface border border-line rounded-2xl shadow-subtle overflow-hidden"
    >
      {/* ---------- Header Controls（第 N 周 · 日期范围 + 操作） ---------- */}
      <div className="shrink-0 px-3 py-2.5 border-b border-line-soft flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <h2 className="text-sm font-bold text-charcoal whitespace-nowrap">
            第 {currentSemesterWeek} 周
          </h2>
          <span className="text-[11px] text-sandrift truncate">
            {formatWeekDateRange(semester, currentSemesterWeek)}
          </span>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {/* 今天 */}
          <button
            onClick={() => setCurrentSemesterWeek(Math.min(Math.max(getSemesterWeekOf(new Date(), semester), 1), semester.totalWeeks))}
            disabled={isCurrentWeek}
            title="回到本周"
            className="h-8 px-2.5 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint disabled:opacity-40 disabled:cursor-default transition-colors"
          >
            今天
          </button>
          {/* ‹ › */}
          <button
            onClick={() => setCurrentSemesterWeek(currentSemesterWeek - 1)}
            disabled={currentSemesterWeek <= 1}
            aria-label="上一周"
            title="上一周"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-30"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCurrentSemesterWeek(currentSemesterWeek + 1)}
            disabled={currentSemesterWeek >= semester.totalWeeks}
            aria-label="下一周"
            title="下一周"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-30"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <div className="w-px h-5 bg-line-soft mx-1" />

          {/* 筛选 */}
          <div className="relative">
            <button
              onClick={() => { setFilterOpen((v) => !v); setQuickOpen(false); setMoreOpen(false); }}
              aria-label="筛选"
              aria-expanded={filterOpen}
              title="筛选"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
            {filterOpen && (
              <div
                role="menu"
                aria-label="时间表筛选"
                className="absolute right-0 top-full mt-1 w-44 bg-surface border border-line-strong rounded-2xl shadow-card z-40 ux-inline p-1.5 space-y-0.5"
              >
                <p className="px-1.5 pb-1 text-[10px] font-bold text-sandrift">显示</p>
                <FilterToggle label="课程" checked disabled hint="时间表骨架，恒显示" />
                <FilterToggle
                  label="学习计划"
                  checked={filters.studyBlocks}
                  onChange={(v) => setFilters((f) => ({ ...f, studyBlocks: v }))}
                />
                <FilterToggle
                  label="DDL"
                  checked={filters.ddl}
                  onChange={(v) => setFilters((f) => ({ ...f, ddl: v }))}
                />
                <FilterToggle
                  label="考试"
                  checked={filters.exam}
                  onChange={(v) => setFilters((f) => ({ ...f, exam: v }))}
                />
                <FilterToggle
                  label="活动"
                  checked={filters.activity}
                  onChange={(v) => setFilters((f) => ({ ...f, activity: v }))}
                />
                <FilterToggle
                  label="小组节点"
                  checked={filters.group}
                  onChange={(v) => setFilters((f) => ({ ...f, group: v }))}
                />
              </div>
            )}
          </div>

          {/* Quick Create + */}
          <div className="relative">
            <button
              onClick={() => { setQuickOpen((v) => !v); setFilterOpen(false); setMoreOpen(false); }}
              aria-label="新建"
              aria-expanded={quickOpen}
              title="新建"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-charcoal bg-charcoal text-white hover:bg-black transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
            {quickOpen && (
              <div role="menu" aria-label="新建" className="absolute right-0 top-full mt-1 w-52 bg-surface border border-line-strong rounded-2xl shadow-card z-40 ux-inline p-1">
                <KiroMenuItem
                  icon={GraduationCap}
                  label="新建课程"
                  onClick={() => { setQuickOpen(false); setAddCourseModalOpen(true); }}
                />
                <KiroMenuItem
                  icon={BookOpenCheck}
                  label="学习计划"
                  onClick={() => { setQuickOpen(false); setFreeBlockOpen(true); }}
                />
                <KiroMenuItem
                  icon={ListChecks}
                  label="新建任务"
                  onClick={() => {
                    setQuickOpen(false);
                    import("@/lib/uiEvents").then(({ openAssignmentEditor }) => openAssignmentEditor({}));
                  }}
                />
                <KiroMenuItem
                  icon={CalendarClock}
                  label="考试 / 日程"
                  onClick={() => { setQuickOpen(false); setMarkOpen(true); }}
                />
              </div>
            )}
          </div>

          {/* Ask Kiro */}
          <button
            onClick={() => handoff.openForWeek(currentSemesterWeek)}
            className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors"
          >
            <KIRO_ICON className="w-3.5 h-3.5" />
            Ask Kiro
          </button>

          {/* More */}
          <div className="relative">
            <button
              onClick={() => { setMoreOpen((v) => !v); setFilterOpen(false); setQuickOpen(false); }}
              aria-label="更多操作"
              aria-expanded={moreOpen}
              title="更多"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {moreOpen && (
              <KiroMenuPanel placement="bottom-end">
                <KiroMenuItem
                  icon={FileUp}
                  label="导入课表"
                  onClick={() => { setMoreOpen(false); setImportScheduleModalOpen(true); }}
                />
                <KiroMenuItem
                  icon={ExternalLink}
                  label="全屏查看"
                  onClick={() => { setMoreOpen(false); setFullTimetableModalOpen(true); }}
                />
                <KiroMenuDivider />
                <KiroMenuItem
                  icon={SettingsIcon}
                  label="时间表设置"
                  onClick={() => {
                    setMoreOpen(false);
                    useAppStore.getState().setSettingsTargetSection?.("semester");
                    useAppStore.getState().setSettingsModalOpen(true);
                  }}
                />
              </KiroMenuPanel>
            )}
          </div>
        </div>
      </div>

      {/* ---------- 主体：Weekday Header + Key Timeline + Course Grid + Shelf ---------- */}
      <div className="flex-1 min-h-0 flex flex-col overflow-x-auto">
        <div className="min-w-[640px] flex flex-col flex-1 min-h-0 px-3 pt-2">
          {/* Weekday Header（含今天轻高亮） */}
          <div
            className="grid border-b border-line-soft pb-1.5 text-center text-xs shrink-0"
            style={{ gridTemplateColumns: `minmax(0, 1fr) repeat(${dayCount}, minmax(0, 1fr))` }}
          >
            <div className="text-sandrift font-medium py-0.5 text-[11px]" />
            {weekDates.slice(0, dayCount).map((date, idx) => {
              const label = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"][idx];
              return (
                <div key={date} className={cn("py-0.5 rounded-lg font-medium", isToday(date) ? "text-charcoal font-bold" : "text-satin-grey")}>
                  <span>{label}</span>
                  <span className="text-[10px] text-sandrift ml-1">{date.slice(5).replace("-", "/")}</span>
                </div>
              );
            })}
          </div>

          {/* 关键时间轴（真正的时间轴：24h 比例） */}
          <TimelineKeyLane items={visibleItems} weekDates={weekDates.slice(0, dayCount)} nowLine={nowLine} />

          {/* Course-centric Hour Grid（复用 TimetableGrid；StudyBlock 走 extraLayers） */}
          <div className="flex-1 min-h-0 flex flex-col">
            <TimetableGrid editable showHeader={false} extraLayers={studyLayer} />
          </div>
        </div>
      </div>

      {/* ---------- Unscheduled Shelf ---------- */}
      <TimelineUnscheduledShelf
        assignments={unscheduled}
        weekDates={weekDates}
        onArrange={(a) => { setArrangeFor(a); setMarkOpen(false); }}
      />

      {/* ---------- 安排学习计划（popover） ---------- */}
      {arrangeFor && <ArrangeSheet assignment={arrangeFor} weekDates={weekDates} onClose={() => setArrangeFor(null)} onSubmit={submitArrange} />}

      {/* ---------- 自由学习计划（Quick Create） ---------- */}
      {freeBlockOpen && (
        <ArrangeSheet
          assignment={null}
          weekDates={weekDates}
          onClose={() => setFreeBlockOpen(false)}
          onSubmit={(_a, date, start, end) => {
            const conflict = studyBlockConflict(
              { date, startTime: start, endTime: end },
              { schedules, studyBlocks, currentSemesterWeek }
            );
            if (conflict) {
              pushToast({ type: "error", message: conflict.courseName ?? conflict.otherTitle ?? "时间重叠" });
              return;
            }
            addStudyBlock({ title: "学习计划", date, startTime: start, endTime: end, source: "manual" });
            pushToast({ message: "已添加学习计划" });
            setFreeBlockOpen(false);
          }}
        />
      )}

      {/* ---------- 考试 / 日程（popover） ---------- */}
      {markOpen && <MarkSheet weekDates={weekDates} onClose={() => setMarkOpen(false)} onSubmit={submitMark} />}
    </div>
  );
}

function FilterToggle({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-2 px-1.5 py-1.5 rounded-lg text-[11px] font-semibold text-charcoal cursor-pointer hover:bg-alabaster transition-colors",
        disabled && "cursor-default opacity-80"
      )}
      title={hint}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="w-3.5 h-3.5 rounded accent-charcoal"
      />
      {label}
    </label>
  );
}

function getSemesterWeekOf(date: Date, semester: { startDate: string; totalWeeks: number }): number {
  const start = new Date(`${semester.startDate}T00:00:00`);
  const diff = Math.floor((date.getTime() - start.getTime()) / 86400000);
  return Math.floor(diff / 7) + 1;
}

/** 安排学习计划小表单（assignment 可选：来自 Shelf 或自由创建） */
function ArrangeSheet({
  assignment,
  weekDates,
  onClose,
  onSubmit,
}: {
  assignment: Assignment | null;
  weekDates: string[];
  onClose: () => void;
  onSubmit: (a: Assignment | null, date: string, start: string, end: string) => void;
}) {
  const today = new Date();
  const defaultDate = weekDates.includes(format(today, "yyyy-MM-dd")) ? format(today, "yyyy-MM-dd") : weekDates[0];
  const [date, setDate] = useState(defaultDate);
  const [start, setStart] = useState("19:00");
  const [end, setEnd] = useState("20:00");
  const [title, setTitle] = useState(assignment?.title ?? "");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="timeline-arrange-sheet">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[1px]" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-label="安排学习计划" className="relative w-full max-w-sm bg-surface border border-line-strong rounded-2xl shadow-card p-4 space-y-3 ux-modal-panel">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-charcoal">安排学习计划</h3>
          <button onClick={onClose} aria-label="关闭" className="p-1.5 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal">
            <X className="w-4 h-4" />
          </button>
        </div>
        {assignment ? (
          <p className="text-[11px] font-semibold text-charcoal">{assignment.title}</p>
        ) : (
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="学习计划标题（如：复习计量经济学）"
            aria-label="学习计划标题"
            className="w-full h-9 px-2.5 bg-[#F7F5F5] border border-line rounded-xl text-xs font-semibold text-charcoal focus:outline-none focus:border-charcoal placeholder-sandrift"
          />
        )}
        <div className="grid grid-cols-3 gap-2">
          <label className="space-y-1">
            <span className="text-[10px] font-bold text-sandrift">日期</span>
            <select value={date} onChange={(e) => setDate(e.target.value)} className="w-full h-8 bg-[#F7F5F5] border border-line rounded-lg px-1.5 text-[11px] font-semibold text-charcoal focus:outline-none">
              {weekDates.map((d) => (
                <option key={d} value={d}>{d.slice(5).replace("-", "/")}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold text-sandrift">开始</span>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-full h-8 bg-[#F7F5F5] border border-line rounded-lg px-1.5 text-[11px] font-semibold text-charcoal focus:outline-none" />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold text-sandrift">结束</span>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full h-8 bg-[#F7F5F5] border border-line rounded-lg px-1.5 text-[11px] font-semibold text-charcoal focus:outline-none" />
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 h-8 rounded-lg text-[11px] font-bold text-satin-grey hover:bg-alabaster transition-colors">取消</button>
          <button
            disabled={!assignment && title.trim().length === 0}
            onClick={() => onSubmit(assignment, date, start, end)}
            className="px-3 h-8 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors disabled:opacity-40"
          >
            确认安排
          </button>
        </div>
      </div>
    </div>
  );
}

/** 考试 / 日程小表单 */
function MarkSheet({
  weekDates,
  onClose,
  onSubmit,
}: {
  weekDates: string[];
  onClose: () => void;
  onSubmit: (m: { title: string; type: "exam" | "activity"; date: string; startTime?: string; endTime?: string }) => void;
}) {
  const today = new Date();
  const defaultDate = weekDates.includes(format(today, "yyyy-MM-dd")) ? format(today, "yyyy-MM-dd") : weekDates[0];
  const [title, setTitle] = useState("");
  const [type, setType] = useState<"exam" | "activity">("exam");
  const [date, setDate] = useState(defaultDate);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const canSubmit = title.trim().length > 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="timeline-mark-sheet">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[1px]" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-label="添加考试或日程" className="relative w-full max-w-sm bg-surface border border-line-strong rounded-2xl shadow-card p-4 space-y-3 ux-modal-panel">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-charcoal">考试 / 日程</h3>
          <button onClick={onClose} aria-label="关闭" className="p-1.5 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal">
            <X className="w-4 h-4" />
          </button>
        </div>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="标题（如：英语六级模拟考试）"
          aria-label="标题"
          className="w-full h-9 px-2.5 bg-[#F7F5F5] border border-line rounded-xl text-xs font-semibold text-charcoal focus:outline-none focus:border-charcoal placeholder-sandrift"
        />
        <div className="flex items-center gap-1.5">
          {(["exam", "activity"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              aria-pressed={type === t}
              className={cn(
                "px-2.5 h-7 rounded-lg text-[11px] font-bold transition-colors",
                type === t ? "bg-charcoal text-white" : "bg-alabaster text-satin-grey hover:text-charcoal"
              )}
            >
              {t === "exam" ? "考试" : "活动"}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <label className="space-y-1">
            <span className="text-[10px] font-bold text-sandrift">日期</span>
            <select value={date} onChange={(e) => setDate(e.target.value)} className="w-full h-8 bg-[#F7F5F5] border border-line rounded-lg px-1.5 text-[11px] font-semibold text-charcoal focus:outline-none">
              {weekDates.map((d) => (
                <option key={d} value={d}>{d.slice(5).replace("-", "/")}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold text-sandrift">开始（可选）</span>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-full h-8 bg-[#F7F5F5] border border-line rounded-lg px-1.5 text-[11px] font-semibold text-charcoal focus:outline-none" />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-bold text-sandrift">结束（可选）</span>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full h-8 bg-[#F7F5F5] border border-line rounded-lg px-1.5 text-[11px] font-semibold text-charcoal focus:outline-none" />
          </label>
        </div>
        <p className="text-[10px] text-sandrift">不填开始 / 结束时间时显示为「全天」事件。</p>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 h-8 rounded-lg text-[11px] font-bold text-satin-grey hover:bg-alabaster transition-colors">取消</button>
          <button
            disabled={!canSubmit}
            onClick={() => onSubmit({ title: title.trim(), type, date, startTime: start || undefined, endTime: end || undefined })}
            className="px-3 h-8 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors disabled:opacity-40"
          >
            添加
          </button>
        </div>
      </div>
    </div>
  );
}
