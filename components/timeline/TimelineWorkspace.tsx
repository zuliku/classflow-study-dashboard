"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { KiroFlowButton } from "@/components/kiro/KiroFlow";
import { useKiroSession } from "@/components/kiro/KiroSessionProvider";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import { IconButton } from "@/components/ui/IconButton";
import { Popover, PopoverPanel } from "@/components/ui/Popover";
import { Dialog } from "@/components/ui/Dialog";
import {
  DropdownMenuPanel,
  DropdownMenuItem,
  DropdownMenuDivider,
} from "@/components/ui/DropdownMenu";
import { TimetableGrid } from "@/components/dashboard/TimetableGrid";
import { TimelineKeyLane } from "@/components/timeline/TimelineKeyLane";
import { FloatingTimelineDetail } from "@/components/timeline/FloatingTimelineDetail";
import { TimelineUnscheduledShelf } from "@/components/timeline/TimelineUnscheduledShelf";
import { getWeekDateRange, formatWeekDateRange } from "@/lib/semester";
import { deriveTimelineItems, deriveUnscheduledAssignments } from "@/lib/timeline/deriveTimelineItems";
import { timeToMinutes } from "@/lib/timeline/timelineGeometry";
import { isScheduleActive } from "@/lib/schedule";
import { Assignment, CalendarMark, CourseSchedule, StudyBlock } from "@/types";
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

/** 学习计划与课程 / 其他学习计划的时间重叠校验（课程只检查当前教学周真正生效的排课） */
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
    if (!isScheduleActive(sch as CourseSchedule, state.currentSemesterWeek)) continue;
    if (sch.dayOfWeek !== dow) continue;
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

/** StudyBlock 与某课程是否同时间重叠（视觉层判断；课程生效周由调用方过滤） */
function overlapsSchedule(
  block: { startTime: string; endTime: string },
  schedule: { startTime: string; endTime: string }
): boolean {
  const s = timeToMinutes(block.startTime);
  const e = timeToMinutes(block.endTime);
  const ss = timeToMinutes(schedule.startTime);
  const se = timeToMinutes(schedule.endTime);
  if (s === null || e === null || ss === null || se === null) return false;
  return s < se && ss < e;
}

/** 紧凑时长格式（Timeline 卡片空间紧）：30m / 1h / 1h30m（禁止出现 1min 式错误） */
function formatCompactMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
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
  // Ghost Preview（Kiro Planning Proposal；ephemeral，不写 Store / localStorage）
  const { planningPreview } = useKiroSession();

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

  // ---- StudyBlock 层（Grid 内弱时间块；Course > StudyBlock：重叠时不绘制 Card）----
  const studyLayer = (ctx: {
    dayOfWeek: number;
    dayStartMinutes: number;
    totalMinutes: number;
    timeToMinutes: (t: string) => number;
  }) => {
    if (!filters.studyBlocks) return null;
    const date = weekDates[ctx.dayOfWeek - 1];
    // 只与「当前教学周真正生效」的课程比较（单双周 / excludedWeeks / 调停课一致）
    const daySchedules = schedules.filter(
      (s) => s.dayOfWeek === ctx.dayOfWeek && isScheduleActive(s, currentSemesterWeek)
    );
    const dayBlocks = studyBlocks.filter((b) => b.date === date);
    const dayStart = ctx.dayStartMinutes;
    const dayEnd = ctx.dayStartMinutes + ctx.totalMinutes;
    // Kiro Proposal Ghost：ephemeral 预览（防御性冲突检查 → 标记「计划已过期」而非压课程）
    const ghostBlocks = (planningPreview?.blocks ?? []).filter((g) => g.date === date);
    return (
      <>
        {dayBlocks.map((b) => {
          // 与课程重叠：不绘制 Card（课程卡右上角由 courseIndicators 显示 Task Marker）
          if (daySchedules.some((s) => overlapsSchedule(b, s))) return null;
          const rawS = timeToMinutes(b.startTime);
          const rawE = timeToMinutes(b.endTime);
          if (rawS === null || rawE === null) return null;
          // Visual Clipping：只绘制 08:00–21:00 内的部分（不改真实数据）
          const s = Math.max(rawS, dayStart);
          const e = Math.min(rawE, dayEnd);
          if (e <= s) return null; // 完全在 Timeline Grid 之外（如 22:00–23:00）
          const topPct = ((s - dayStart) / ctx.totalMinutes) * 100;
          const heightPct = ((e - s) / ctx.totalMinutes) * 100;
          const durationMinutes = e - s;
          // 真实时间高度优先；跨界块不加 minimum（防突破 Grid 上下边界）
          const touchesEdge = s <= dayStart || e >= dayEnd;
          // 高度不足的短块：只显示 Title，不放 duration / delete
          const showMeta = heightPct >= 3.4;
          return (
            <div
              key={b.id}
              data-testid="timeline-study-block"
              title={`${b.title} · ${b.startTime}–${b.endTime}（${formatCompactMinutes(rawE - rawS)}）`}
              className="absolute left-1 right-1 z-[2] rounded-lg border border-dashed border-line-soft bg-pastel-mint/20 px-1.5 py-0.5 flex items-center gap-1 overflow-hidden pointer-events-auto group"
              style={{ top: `${topPct}%`, height: `${heightPct}%`, minHeight: touchesEdge ? undefined : 6 }}
            >
              <span className="truncate text-[10px] font-semibold text-satin-grey">{b.title}</span>
              {showMeta && (
                <>
                  <span className="text-[9px] text-sandrift font-medium shrink-0">
                    {formatCompactMinutes(durationMinutes)}
                  </span>
                  <button
                    onClick={() => {
                      deleteStudyBlock(b.id);
                      pushToast({ message: "已删除学习计划" });
                    }}
                    aria-label={`删除学习计划 ${b.title}`}
                    className="ml-auto p-0.5 rounded text-sandrift hover:text-danger transition-colors shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </>
              )}
            </div>
          );
        })}

        {/* Kiro Proposal Ghost（ephemeral；弱于真实 StudyBlock；冲突时标记「计划已过期」） */}
        {ghostBlocks.map((g) => {
          const gs = timeToMinutes(g.startTime);
          const ge = timeToMinutes(g.endTime);
          if (gs === null || ge === null) return null;
          const vs = Math.max(gs, dayStart);
          const ve = Math.min(ge, dayEnd);
          if (ve <= vs) return null;
          const gConflict =
            daySchedules.some((sc) => overlapsSchedule(g, sc)) ||
            studyBlocks.some((b) => b.date === date && overlapsSchedule(g, b));
          return (
            <div
              key={g.id}
              data-testid="timeline-ghost-block"
              title={gConflict ? "计划已过期（与当前课程 / 学习计划冲突）" : `${g.title} · Kiro 建议（未保存）`}
              className={cn(
                "absolute left-1 right-1 z-[3] rounded-lg border border-dashed px-1.5 py-0.5 flex items-center gap-1 overflow-hidden pointer-events-none",
                gConflict
                  ? "border-danger/50 bg-danger-bg/40"
                  : "border-line-strong bg-pastel-mint/15"
              )}
              style={{ top: `${((vs - dayStart) / ctx.totalMinutes) * 100}%`, height: `${((ve - vs) / ctx.totalMinutes) * 100}%`, minHeight: 6 }}
            >
              <span className="truncate text-[10px] font-semibold text-satin-grey">{g.title}</span>
              <span className="text-[9px] text-sandrift font-medium shrink-0">Kiro 建议</span>
            </div>
          );
        })}
      </>
    );
  };

  // ---- Course > StudyBlock：课程卡右上角 Task Marker（overlap 时替代 StudyBlock Card）----
  const courseIndicators = ({
    schedule,
    course,
    dayOfWeek,
    hasConflict,
    dayStartMinutes,
    totalMinutes,
  }: {
    schedule: CourseSchedule;
    course: { name: string };
    dayOfWeek: number;
    hasConflict: boolean;
    dayStartMinutes: number;
    totalMinutes: number;
  }) => {
    if (!filters.studyBlocks) return null;
    const date = weekDates[dayOfWeek - 1];
    const blocks = studyBlocks.filter((b) => b.date === date && overlapsSchedule(b, schedule));
    if (blocks.length === 0) return null;
    return (
      <CourseTaskMarker
        blocks={blocks}
        schedule={schedule}
        courseName={course.name}
        hasConflict={hasConflict}
        boundsRef={wrapRef}
      />
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

  return (
    <div className="flex flex-1 min-h-0 flex-col">
    {/* Timeline Workspace Header（App Shell Structural；周切换/Filter/+ /Ask Kiro/More 留在 Local Toolbar） */}
    <WorkspaceHeader
      title="时间表"
      context={`第 ${currentSemesterWeek} 周 · ${formatWeekDateRange(semester, currentSemesterWeek)}`}
      sticky
    />
    <div className="flex flex-1 min-h-0 flex-col p-4 pb-24 md:p-6 md:pb-6">
    <div
      ref={wrapRef}
      data-testid="timeline-workspace"
      className="flex flex-1 min-h-0 flex-col bg-surface border border-line rounded-2xl shadow-subtle overflow-hidden"
    >
      {/* ---------- Local Toolbar（周导航 | Actions；Week Meta 已上移 Workspace Header，不再重复） ---------- */}
      <div className="shrink-0 px-3 py-2 border-b border-line flex items-center justify-between gap-2">
        {/* Group A：Week Navigation（‹ › 今天坐标稳定） */}
        <div className="flex items-center gap-1 min-w-0">
          <button
            onClick={() => setCurrentSemesterWeek(currentSemesterWeek - 1)}
            disabled={currentSemesterWeek <= 1}
            aria-label="上一周"
            title="上一周"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-30"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCurrentSemesterWeek(currentSemesterWeek + 1)}
            disabled={currentSemesterWeek >= semester.totalWeeks}
            aria-label="下一周"
            title="下一周"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-30"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          {/* 今天：降权 neutral（当前周 subtle/disabled；非当前周增强） */}
          <button
            onClick={() => setCurrentSemesterWeek(Math.min(Math.max(getSemesterWeekOf(new Date(), semester), 1), semester.totalWeeks))}
            disabled={isCurrentWeek}
            title={isCurrentWeek ? "已在当前周" : "回到本周"}
            className={cn(
              "h-7 px-2.5 rounded-lg text-[11px] font-bold transition-colors",
              isCurrentWeek
                ? "text-sandrift/70 cursor-default"
                : "text-charcoal bg-alabaster hover:bg-line-soft"
            )}
          >
            今天
          </button>
        </div>

        {/* Group B：Timeline Actions（单一 flex 容器，逻辑间距用 margin 表达） */}
        <div className="flex items-center gap-0.5 shrink-0">
          {/* 筛选 → Control Popover（全局 primitive；role=group + checkbox） */}
          <Popover open={filterOpen} onOpenChange={setFilterOpen}>
            <IconButton
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilterOpen((v) => !v);
                setQuickOpen(false);
                setMoreOpen(false);
              }}
              aria-label="筛选"
              aria-expanded={filterOpen}
              title="筛选"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </IconButton>
            {filterOpen && (
              <PopoverPanel
                placement="bottom-end"
                role="group"
                aria-label="时间表筛选"
                className="w-44 p-1.5 space-y-0.5"
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
              </PopoverPanel>
            )}
          </Popover>

          {/* Quick Create +（主 Create Action）→ DropdownMenu */}
          <Popover open={quickOpen} onOpenChange={setQuickOpen}>
            <IconButton
              variant="primary"
              size="sm"
              onClick={() => { setQuickOpen((v) => !v); setFilterOpen(false); setMoreOpen(false); }}
              aria-label="新建"
              aria-expanded={quickOpen}
              title="新建"
            >
              <Plus className="w-4 h-4" />
            </IconButton>
            {quickOpen && (
              <DropdownMenuPanel placement="bottom-end" aria-label="新建" className="w-52">
                <DropdownMenuItem
                  icon={GraduationCap}
                  label="新建课程"
                  onClick={() => { setQuickOpen(false); setAddCourseModalOpen(true); }}
                />
                <DropdownMenuItem
                  icon={BookOpenCheck}
                  label="学习计划"
                  onClick={() => { setQuickOpen(false); setFreeBlockOpen(true); }}
                />
                <DropdownMenuItem
                  icon={ListChecks}
                  label="新建任务"
                  onClick={() => {
                    setQuickOpen(false);
                    import("@/lib/uiEvents").then(({ openAssignmentEditor }) => openAssignmentEditor({}));
                  }}
                />
                <DropdownMenuItem
                  icon={CalendarClock}
                  label="考试 / 日程"
                  onClick={() => { setQuickOpen(false); setMarkOpen(true); }}
                />
              </DropdownMenuPanel>
            )}
          </Popover>

          {/* Ask Kiro（Secondary Featured，与 Create 组间隔 6px） */}
          <KiroFlowButton
            icon={KIRO_ICON}
            label="Ask Kiro"
            size="sm"
            className="h-8 ml-1.5"
            onClick={() => handoff.openForWeek(currentSemesterWeek)}
          />
          {/* More → DropdownMenu */}
          <Popover open={moreOpen} onOpenChange={setMoreOpen} className="ml-0.5">
            <IconButton
              variant="ghost"
              size="sm"
              onClick={() => { setMoreOpen((v) => !v); setFilterOpen(false); setQuickOpen(false); }}
              aria-label="更多操作"
              aria-expanded={moreOpen}
              title="更多"
            >
              <MoreHorizontal className="w-4 h-4" />
            </IconButton>
            {moreOpen && (
              <DropdownMenuPanel placement="bottom-end" aria-label="更多操作">
                <DropdownMenuItem
                  icon={FileUp}
                  label="导入课表"
                  onClick={() => { setMoreOpen(false); setImportScheduleModalOpen(true); }}
                />
                <DropdownMenuItem
                  icon={ExternalLink}
                  label="全屏查看"
                  onClick={() => { setMoreOpen(false); setFullTimetableModalOpen(true); }}
                />
                <DropdownMenuDivider />
                <DropdownMenuItem
                  icon={SettingsIcon}
                  label="时间表设置"
                  onClick={() => {
                    setMoreOpen(false);
                    useAppStore.getState().setSettingsTargetSection?.("semester");
                    useAppStore.getState().setSettingsModalOpen(true);
                  }}
                />
              </DropdownMenuPanel>
            )}
          </Popover>
        </div>
      </div>

      {/* ---------- 主体：Weekday Header（唯一一份）+ Key Timeline + Course Grid ---------- */}
      <div className="flex-1 min-h-0 flex flex-col overflow-x-auto">
        <div className="min-w-[640px] w-full flex flex-col flex-1 min-h-0 px-3 pt-1.5">
          {/* Weekday Header（与 Key Lane / Grid 共用 56px 时间 gutter） */}
          <div
            className="grid border-b border-line-soft pb-1 text-center text-xs shrink-0"
            style={{ gridTemplateColumns: `56px repeat(${dayCount}, minmax(0, 1fr))` }}
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
          <TimelineKeyLane items={visibleItems} weekDates={weekDates.slice(0, dayCount)} boundsRef={wrapRef} />

          {/* Course-centric Hour Grid（embedded：无 Card 嵌套 / 无固定 min-height） */}
          <div className="flex-1 min-h-0 flex flex-col">
            <TimetableGrid
              editable
              variant="embedded"
              showHeader={false}
              showWeekdayHeader={false}
              extraLayers={studyLayer}
              courseIndicators={courseIndicators}
            />
          </div>
        </div>
      </div>

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

    {/* ---------- 待安排：独立 Secondary Panel（首屏之后，不挤压时间表） ---------- */}
    <TimelineUnscheduledShelf
      assignments={unscheduled}
      onArrange={(a) => { setArrangeFor(a); setMarkOpen(false); }}
    />
    </div>
    </div>
  );
}

/**
 * Course > StudyBlock 的 Task Marker：
 * 课程卡右上角 secondary signal（默认纯 dot；多个 overlap 时 + 轻量 count）。
 * Hover / Focus / Tap 通过 FloatingTimelineDetail（Portal + collision）显示详情；
 * 点击不导航（stopPropagation 防误开课程 Drawer）。
 */
function CourseTaskMarker({
  blocks,
  schedule,
  courseName,
  hasConflict,
  boundsRef,
}: {
  blocks: StudyBlock[];
  schedule: CourseSchedule;
  courseName: string;
  hasConflict: boolean;
  boundsRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const markerRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const count = blocks.length;

  const scheduleClose = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 100);
  };
  const cancelClose = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  // Touch / 外部点击关闭（capture；Marker 自身由 onClick toggle）
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (markerRef.current && !markerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  return (
    <>
      <div
        ref={markerRef}
        data-testid="course-task-marker"
        className="absolute z-[7]"
        style={{ top: 7, right: hasConflict ? 28 : 8 }}
      >
        <button
          type="button"
          tabIndex={0}
          aria-label={`${count} 个学习任务与本课程时间重叠`}
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          onMouseEnter={() => {
            cancelClose();
            setOpen(true);
          }}
          onMouseLeave={scheduleClose}
          onFocus={() => {
            cancelClose();
            setOpen(true);
          }}
          onBlur={scheduleClose}
          className="w-[20px] h-[20px] -m-[1px] flex items-center justify-center gap-0.5 rounded-full cursor-pointer outline-none hover:scale-[1.12] transition-transform duration-[var(--motion-fast)]"
          title="查看重叠的学习任务"
        >
          <span className="block w-[7px] h-[7px] rounded-full bg-[#A87952] shadow-subtle" />
          {count > 1 && (
            <span className="text-[9px] font-bold text-[#A87952] leading-none">{count}</span>
          )}
        </button>
      </div>

      <FloatingTimelineDetail
        anchorRef={markerRef}
        boundsRef={boundsRef}
        open={open}
        kind="marker"
        ariaLabel="重叠的学习任务"
        onRequestClose={() => setOpen(false)}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        <div className="px-2.5 py-2 space-y-1.5">
          <p className="text-[11px] font-bold text-charcoal">
            学习任务{count > 1 ? ` · ${count}` : ""}
          </p>
          {blocks.slice(0, 4).map((b) => (
            <div key={b.id} className="space-y-0.5">
              <p className="text-[10px] font-semibold text-charcoal leading-snug">{b.title}</p>
              <p className="text-[9px] text-satin-grey">
                {b.startTime}–{b.endTime} · 与《{courseName}》时间重叠
              </p>
            </div>
          ))}
          {blocks.length > 4 && (
            <p className="text-[10px] font-semibold text-satin-grey">还有 {blocks.length - 4} 项</p>
          )}
        </div>
      </FloatingTimelineDetail>
    </>
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
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      overlayId="timeline-arrange-sheet"
      stackZ={50}
      closeOnBackdrop
      aria-label="安排学习计划"
      data-testid="timeline-arrange-sheet"
      className="max-w-sm p-4 space-y-3 border-line-strong rounded-2xl shadow-card"
    >
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
      </Dialog>
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
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      overlayId="timeline-mark-sheet"
      stackZ={50}
      closeOnBackdrop
      aria-label="添加考试或日程"
      data-testid="timeline-mark-sheet"
      className="max-w-sm p-4 space-y-3 border-line-strong rounded-2xl shadow-card"
    >
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
      </Dialog>
  );
}
