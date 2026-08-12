"use client";

import React, { useState, useEffect, useRef } from "react";
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
import { FocusControl } from "@/components/focus/FocusControl";
import { getSemesterWeek } from "@/lib/semester";
import { getLocalDDLDate, getLocalDDLTime } from "@/lib/ddl";
import { isScheduleActive } from "@/lib/schedule";
import { openAssignmentEditor } from "@/lib/uiEvents";
import { cn, cardKeyHandler } from "@/lib/utils";
import { Assignment } from "@/types";
import { isValidDDL, moveAssignmentDDL, editAssignmentDDLTime } from "@/lib/ddlInteraction";
import { useSlidingIndicator } from "@/lib/useSlidingIndicator";
import { paginate } from "@/lib/pagination";
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
  parseISO,
} from "date-fns";
import { zhCN } from "date-fns/locale";

/** 点击 vs 拖动阈值（px）：未超过仍视为点击，打开 Assignment Drawer */
const DRAG_THRESHOLD_PX = 5;

/** DDL 拖动状态机（仅存组件内，Store 只在 drop 提交） */
type DDLDragState =
  | { type: "idle" }
  | { type: "pending"; assignment: Assignment; startX: number; startY: number }
  | {
      type: "dragging";
      assignment: Assignment;
      x: number;
      y: number;
      hoverDateStr: string | null;
    };

/** DDL 移动后的局部反馈：撤销 + 快速修改时间（不破坏全局 Toast 单 action API） */
interface DDLMoveFeedbackState {
  origin: Assignment;
  current: Assignment;
  targetDate: string;
}

const FEEDBACK_MS = 5000;

export function MiniCalendar() {
  const {
    schedules,
    assignments,
    calendarMarks,
    courses,
    semester,
    setSelectedCourseId,
    setSelectedAssignmentId,
    updateAssignment,
    preferences,
  } = useAppStore();

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const days = eachDayOfInterval({ start: startDate, end: endDate });

  // 月份切换方向：上一月 -6px 进入，下一月 +6px 进入（仅网格，卡片不动）
  const prevMonthRef = useRef(currentMonth);
  const [monthDir, setMonthDir] = useState(0);
  useEffect(() => {
    if (prevMonthRef.current.getTime() !== currentMonth.getTime()) {
      setMonthDir(currentMonth.getTime() > prevMonthRef.current.getTime() ? 1 : -1);
      prevMonthRef.current = currentMonth;
    }
  }, [currentMonth]);

  const monthKey = format(currentMonth, "yyyy-MM");

  const handlePrevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const handleNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const handleResetToday = () => {
    const now = new Date();
    setCurrentMonth(now);
    setSelectedDate(now);
  };

  // ---- DDL Drag 启用范围：>=768px + 精确指针（mouse/pen）；Mobile 不进入拖动 ----
  const [mediaState, setMediaState] = useState({ wide: false, fine: false });
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 768px)");
    const fine = window.matchMedia("(pointer: fine)");
    const apply = () => setMediaState({ wide: wide.matches, fine: fine.matches });
    apply();
    wide.addEventListener("change", apply);
    fine.addEventListener("change", apply);
    return () => {
      wide.removeEventListener("change", apply);
      fine.removeEventListener("change", apply);
    };
  }, []);
  // DDL Drag：>=768px + 精确指针 + 偏好开启；关闭时点击仍打开 Assignment Drawer
  const ddlDragEnabled =
    mediaState.wide && mediaState.fine && preferences.enableDDLDirectManipulation;

  const [drag, setDrag] = useState<DDLDragState>({ type: "idle" });
  // 同步镜像：pointer 事件快于 React 渲染，handler 一律读 ref（见 Task 2 竞态修复）
  const dragRef = useRef<DDLDragState>({ type: "idle" });
  const setDragSync = (d: DDLDragState) => {
    dragRef.current = d;
    setDrag(d);
  };
  const wasDraggedRef = useRef(false);

  // ---- DDL 移动反馈（局部，4-6 秒）----
  const [feedback, setFeedback] = useState<DDLMoveFeedbackState | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);
  const [timeEditOpen, setTimeEditOpen] = useState(false);
  const [timeInput, setTimeInput] = useState("");
  const timeEditRef = useRef<HTMLDivElement | null>(null);
  const timeInputRef = useRef<HTMLInputElement | null>(null);

  const showFeedback = (f: DDLMoveFeedbackState) => {
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    setFeedback(f);
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(null), FEEDBACK_MS);
  };

  useEffect(
    () => () => {
      if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    },
    []
  );

  const cancelDrag = () => {
    wasDraggedRef.current = false;
    setDragSync({ type: "idle" });
  };

  // 拖拽进行中标记：全局单键快捷键据此跳过（与完整课表共用同一信号）
  useEffect(() => {
    document.body.dataset.dragActive = drag.type !== "idle" ? "1" : "";
    return () => {
      document.body.dataset.dragActive = "";
    };
  }, [drag.type]);

  // Esc 取消拖动 / 关闭时间弹层
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (dragRef.current.type !== "idle") cancelDrag();
      if (timeEditOpen) setTimeEditOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [timeEditOpen]);

  // click outside 关闭时间弹层
  useEffect(() => {
    if (!timeEditOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (timeEditRef.current && !timeEditRef.current.contains(e.target as Node)) {
        setTimeEditOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [timeEditOpen]);

  // 打开修改时间：聚焦输入框
  useEffect(() => {
    if (timeEditOpen) timeInputRef.current?.focus();
  }, [timeEditOpen]);

  // ---- DDL item Pointer 交互 ----
  const handleDDLPointerDown = (e: React.PointerEvent, assignment: Assignment) => {
    if (!ddlDragEnabled || e.pointerType === "touch") return;
    if (!assignment.ddl || !isValidDDL(assignment.ddl)) return; // 无 DDL / 脏数据禁止拖动，点击仍可编辑
    setDragSync({
      type: "pending",
      assignment,
      startX: e.clientX,
      startY: e.clientY,
    });
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const handleDDLPointerMove = (e: React.PointerEvent) => {
    const current = dragRef.current;
    if (current.type === "pending") {
      const dist = Math.hypot(e.clientX - current.startX, e.clientY - current.startY);
      if (dist >= DRAG_THRESHOLD_PX) {
        wasDraggedRef.current = true;
        setDragSync({
          type: "dragging",
          assignment: current.assignment,
          x: e.clientX,
          y: e.clientY,
          hoverDateStr: null,
        });
      }
      return;
    }
    if (current.type === "dragging") {
      const hit = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest?.("[data-calendar-day]");
      const hoverDateStr = hit?.getAttribute("data-calendar-day") ?? null;
      setDragSync({ ...current, x: e.clientX, y: e.clientY, hoverDateStr });
    }
  };

  const handleDDLPointerUp = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const current = dragRef.current;
    if (current.type !== "dragging") {
      // 未跨阈值 → 保持 click 语义（打开 Assignment Drawer）
      return;
    }
    const targetDate = current.hoverDateStr;
    setDragSync({ type: "idle" });
    if (!targetDate) return; // 拖出日历区域 → 取消
    const result = moveAssignmentDDL(current.assignment, targetDate);
    if (!result) return; // 同日期 / 无法解析 → 无 mutation
    updateAssignment(result.assignment);
    const targetDateObj = parseISO(targetDate);
    setCurrentMonth(targetDateObj);
    setSelectedDate(targetDateObj);
    showFeedback({ origin: current.assignment, current: result.assignment, targetDate });
  };

  // ---- 快速修改时间 / 撤销 ----
  const openTimeEdit = () => {
    if (!feedback) return;
    setTimeInput(getLocalDDLTime(feedback.current.ddl));
    setTimeEditOpen(true);
  };

  const saveTimeEdit = () => {
    if (!feedback) return;
    const result = editAssignmentDDLTime(feedback.current, feedback.targetDate, timeInput);
    if (!result) {
      setTimeEditOpen(false);
      return;
    }
    updateAssignment(result.assignment);
    showFeedback({ ...feedback, current: result.assignment });
    setTimeEditOpen(false);
  };

  const handleUndoDDLMove = () => {
    if (!feedback) return;
    updateAssignment(feedback.origin); // 同一 id，完整原字段恢复（含原 DDL）
    setFeedback(null);
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
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

  const dragActive = drag.type === "dragging";

  // ---- 共享 Selection Indicator：选中背景属于 Indicator，不属于具体日期 Button ----
  // resetKey = 月份 → 月份切换时直接锚定（页面内容变化），日期点击才是平滑移动（同一空间选择变化）
  const selectedDateKey = format(selectedDate, "yyyy-MM-dd");
  const { containerRef, indicatorStyle } = useSlidingIndicator(selectedDateKey, {
    resetKey: monthKey,
  });

  // ---- Compact Event Grid：当日日程横向 4 列（每页最多 4 个，只显示类型 + 图标） ----
  type AgendaCellKind = "course" | "ddl" | "exam" | "activity";
  interface AgendaCell {
    key: string;
    kind: AgendaCellKind;
    label: string;
    time: string; // 排序用
    onClick?: () => void;
    style?: React.CSSProperties;
    assignmentId?: string;
    draggableAssignment?: Assignment; // DDL cell 的拖拽源
  }

  const [agendaPage, setAgendaPage] = useState(1);
  // 切换日期自动回到第 1 页
  useEffect(() => {
    setAgendaPage(1);
  }, [selectedDateStr]);

  const agendaCells: AgendaCell[] = [
    ...daySchedules.map((s) => {
      const c = courses.find((crs) => crs.id === s.courseId);
      return {
        key: `s_${s.id}`,
        kind: "course" as const,
        label: "课程",
        time: s.startTime,
        onClick: () => c && setSelectedCourseId(c.id),
        style: {
          backgroundColor: `${c?.bgHex || "#F0EBE1"}60`,
          borderColor: c?.borderHex,
        },
      };
    }),
    ...dayAssignments.map((a) => ({
      key: `a_${a.id}`,
      kind: "ddl" as const,
      label: "DDL",
      time: getLocalDDLTime(a.ddl),
      onClick: () => setSelectedAssignmentId(a.id),
      assignmentId: a.id,
      draggableAssignment: a,
    })),
    ...dayExams.map((m) => ({
      key: `e_${m.id}`,
      kind: "exam" as const,
      label: "考试",
      time: "99:00",
    })),
    ...dayActivities.map((m) => ({
      key: `ac_${m.id}`,
      kind: "activity" as const,
      label: "活动",
      time: "99:00",
    })),
  ].sort((x, y) => x.time.localeCompare(y.time));

  const agendaPaged = paginate(agendaCells, agendaPage, 4);
  const pagedCells = agendaPaged.items;
  const agendaSafePage = agendaPaged.currentPage;
  const showAgendaPagination = agendaCells.length > 4;

  return (
    <div
      data-testid="calendar-card"
      className="bg-surface border border-line rounded-2xl p-4 shadow-subtle space-y-3 flex flex-col min-h-0 h-full"
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-[#F0EBE1]">
        <div className="flex items-center space-x-2">
          <CalendarIcon className="w-4 h-4 text-[#A48F82]" />
          <h3 key={monthKey} className="ux-fade text-xs font-bold text-charcoal">
            {format(currentMonth, "yyyy年 M月", { locale: zhCN })}
          </h3>
        </div>

        <div className="flex items-center space-x-1">
          <FocusControl />
          <button
            onClick={handleResetToday}
            className="text-[10px] bg-alabaster hover:bg-alba text-charcoal px-2 py-0.5 rounded-lg font-bold transition-colors mr-1"
          >
            回到今天
          </button>
          <button
            onClick={handlePrevMonth}
            className="p-1.5 rounded-lg text-sandrift hover:bg-alabaster transition-colors"
            title="上一月"
            aria-label="上一月"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleNextMonth}
            className="p-1.5 rounded-lg text-sandrift hover:bg-alabaster transition-colors"
            title="下一月"
            aria-label="下一月"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Weekday Row */}
      <div className="grid grid-cols-7 text-center text-[10px] font-bold text-sandrift">
        {["一", "二", "三", "四", "五", "六", "日"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar Grid（日期格 = DDL drop target；共享 Selection Indicator 位于 z-0）。
          自然纵向结构（不垂直居中）：固定高度 Calendar 内 Header/Weekday/Grid/Agenda 紧凑均衡 */}
      <div className="shrink-0">
      <div
        ref={containerRef}
        data-selected-date={selectedDateKey}
        key={monthKey}
        className={cn(
          "relative grid grid-cols-7 gap-1 text-xs",
          monthDir !== 0 && "ux-month-enter"
        )}
        style={
          monthDir !== 0
            ? ({ "--enter-x": monthDir === 1 ? "6px" : "-6px" } as React.CSSProperties)
            : undefined
        }
      >
        {/* 共享选中滑块：黑色背景只属于它；只过渡 transform/width/height/opacity */}
        <div
          data-testid="calendar-selection-indicator"
          aria-hidden="true"
          className="absolute left-0 top-0 rounded-xl bg-charcoal shadow-subtle pointer-events-none z-0"
          style={indicatorStyle}
        />
        {days.map((day) => {
          const dateStr = format(day, "yyyy-MM-dd");
          const isSelected = isSameDay(day, selectedDate);
          const isCurrentMonth = isSameMonth(day, currentMonth);
          const isTodayDate = isToday(day);
          const isHoverTarget = dragActive && drag.hoverDateStr === dateStr;

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
              data-calendar-day={dateStr}
              data-indicator-key={dateStr}
              onClick={() => setSelectedDate(day)}
              className={cn(
                "relative z-10 h-8 rounded-xl flex flex-col items-center justify-center",
                // 选中背景由共享 Indicator 承担；按钮只处理前景色（120–140ms 过渡，先于滑块到位）
                "transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
                // 日期格取消全局 button:active 缩放，避免「格子缩一下 + 滑块移动」双重抖动
                "active:transform-none",
                isSelected
                  ? "text-white font-bold"
                  : isTodayDate
                  ? "bg-pastel-mint text-charcoal font-extrabold border border-[#CDB9AB]"
                  : isCurrentMonth
                  ? "text-charcoal hover:bg-alabaster"
                  : "text-[#CDB9AB] opacity-40 hover:opacity-80",
                // DDL 拖动中：全部日期格低饱和 outline；当前目标明确 ring
                dragActive && "outline outline-1 outline-line-soft",
                isHoverTarget && "outline-2 outline-sandrift bg-alabaster"
              )}
            >
              <span>{format(day, "d")}</span>

              {/* Event Indicator Dots */}
              <div className="flex items-center space-x-0.5 absolute bottom-1">
                {hasCourse && (
                  <span
                    className={`w-1 h-1 rounded-full transition-colors duration-[var(--motion-fast)] ${
                      isSelected ? "bg-white" : "bg-success"
                    }`}
                  />
                )}
                {hasDDL && (
                  <span
                    className={`w-1 h-1 rounded-full transition-colors duration-[var(--motion-fast)] ${
                      isSelected ? "bg-white" : "bg-danger"
                    }`}
                  />
                )}
                {hasExam && (
                  <span
                    className={`w-1 h-1 rounded-full transition-colors duration-[var(--motion-fast)] ${
                      isSelected ? "bg-white" : "bg-sandrift"
                    }`}
                  />
                )}
                {hasActivity && (
                  <span
                    className={`w-1 h-1 rounded-full transition-colors duration-[var(--motion-fast)] ${
                      isSelected ? "bg-white" : "bg-satin-grey"
                    }`}
                  />
                )}
              </div>
            </button>
          );
        })}
      </div>
      </div>

      {/* Drag Preview：跟随 pointer，不复制完整卡片；无动画（Reduced Motion 下天然静态） */}
      {dragActive && (
        <div
          aria-hidden="true"
          className="fixed z-[60] pointer-events-none px-3 py-2 rounded-xl bg-charcoal text-white shadow-card space-y-0.5"
          style={{ left: drag.x + 14, top: drag.y + 16 }}
        >
          <p className="text-[11px] font-bold leading-tight">{drag.assignment.title}</p>
          <p className="text-[10px] text-white/80 font-mono">
            DDL · {getLocalDDLTime(drag.assignment.ddl)}
          </p>
          {drag.hoverDateStr && (
            <p className="text-[10px] font-semibold text-pastel-mint">
              移动到 {format(parseISO(drag.hoverDateStr), "M月d日", { locale: zhCN })}
            </p>
          )}
        </div>
      )}

      {/* Selected Date Agenda：横向 Compact Event Grid（4 列/页，仅类型 + 图标；详情走 Drawer）
          矮视口（≤740px 高）下隐藏，避免与 Overview 首屏 hero 争高度 */}
      <div className="pt-2 border-t border-[#F0EBE1] shrink-0 [@media(max-height:740px)]:hidden">
        <div className="flex justify-between items-center text-xs">
          <span className="font-bold text-charcoal">
            {isSelectedInSemester
              ? `第 ${selectedWeek} 周 · `
              : ""}
            {format(selectedDate, "M月d日 EEEE", { locale: zhCN })} 当日日程
          </span>
          <span className="flex items-center gap-2">
            <span className="text-[10px] text-sandrift">
              {agendaCells.length} 项
            </span>
            {/* 分页器：标题行右侧；仅 >4 项时出现 */}
            {showAgendaPagination && (
              <span className="inline-flex items-center gap-1">
                <button
                  onClick={() => setAgendaPage(agendaSafePage - 1)}
                  disabled={agendaSafePage <= 1}
                  aria-label="上一页"
                  className="w-6 h-6 flex items-center justify-center rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-sandrift"
                >
                  <ChevronLeft className="w-3 h-3" />
                </button>
                <span className="min-w-[32px] text-center text-[10px] font-mono text-satin-grey">
                  {agendaSafePage} / {agendaPaged.totalPages}
                </span>
                <button
                  onClick={() => setAgendaPage(agendaSafePage + 1)}
                  disabled={agendaSafePage >= agendaPaged.totalPages}
                  aria-label="下一页"
                  className="w-6 h-6 flex items-center justify-center rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-sandrift"
                >
                  <ChevronRight className="w-3 h-3" />
                </button>
              </span>
            )}
          </span>
        </div>

        {/* Compact Event Grid：高度恒定（一行 h-14），不随数量变化 */}
        <div
          key={selectedDateStr}
          data-testid="agenda-grid"
          className="ux-agenda-enter grid grid-cols-4 gap-1.5 mt-1.5 min-h-[56px]"
        >
          {pagedCells.length === 0 ? (
            <div className="col-span-4 h-14 flex items-center justify-center gap-2 text-[10px] text-sandrift">
              <span>暂无安排</span>
              <button
                onClick={handleQuickAddAssignment}
                className="ux-press inline-flex items-center gap-1 px-2 py-1 bg-charcoal hover:bg-black text-white text-[10px] font-bold rounded-lg transition-colors"
              >
                <Plus className="w-3 h-3" />
                添加任务
              </button>
            </div>
          ) : (
            pagedCells.map((cell) => {
              const Icon =
                cell.kind === "course"
                  ? BookOpen
                  : cell.kind === "ddl"
                  ? ClipboardCheck
                  : cell.kind === "exam"
                  ? Award
                  : CalendarDays;
              const isDraggingThis =
                cell.kind === "ddl" &&
                drag.type === "dragging" &&
                drag.assignment.id === cell.assignmentId;
              const draggable =
                cell.kind === "ddl" &&
                !!cell.draggableAssignment &&
                ddlDragEnabled &&
                !!cell.draggableAssignment.ddl &&
                isValidDDL(cell.draggableAssignment.ddl);
              return (
                <button
                  key={cell.key}
                  data-testid={cell.kind === "ddl" ? "agenda-ddl-item" : undefined}
                  data-agenda-assignment={cell.assignmentId}
                  onClick={() => {
                    if (cell.kind === "ddl" && wasDraggedRef.current) {
                      wasDraggedRef.current = false;
                      return;
                    }
                    cell.onClick?.();
                  }}
                  onPointerDown={
                    cell.kind === "ddl" && cell.draggableAssignment
                      ? (e) => handleDDLPointerDown(e, cell.draggableAssignment!)
                      : undefined
                  }
                  onPointerMove={cell.kind === "ddl" ? handleDDLPointerMove : undefined}
                  onPointerUp={cell.kind === "ddl" ? handleDDLPointerUp : undefined}
                  onPointerCancel={cell.kind === "ddl" ? cancelDrag : undefined}
                  title={
                    cell.kind === "ddl" && draggable ? "拖动调整截止日期" : undefined
                  }
                  className={cn(
                    "h-14 rounded-lg border flex flex-col items-center justify-center gap-1 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
                    cell.kind === "course" && "cursor-pointer hover:opacity-90",
                    cell.kind === "ddl" && [
                      "bg-danger-bg border-danger-border text-danger cursor-pointer",
                      draggable && "cursor-grab active:cursor-grabbing",
                      isDraggingThis && "opacity-50",
                    ],
                    cell.kind === "exam" && "bg-alabaster/60 border-stone-beige text-sandrift",
                    cell.kind === "activity" &&
                      "bg-pastel-mint/60 border-ashy-beige text-satin-grey"
                  )}
                  style={{
                    ...cell.style,
                    touchAction: cell.kind === "ddl" && ddlDragEnabled ? "none" : "auto",
                  }}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="text-[9px] font-bold leading-none">{cell.label}</span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* DDL Move Feedback：局部轻量反馈（撤销 + 修改时间），不破坏全局 Toast */}
      {feedback && (
        <div className="relative">
          <div
            data-testid="ddl-move-feedback"
            className="ux-inline bg-surface border border-line-strong rounded-xl shadow-card p-2.5 space-y-2"
          >
            <p className="text-[11px] font-bold text-charcoal">
              已移动到{" "}
              {format(parseISO(feedback.targetDate), "M月d日", { locale: zhCN })} ·{" "}
              {getLocalDDLTime(feedback.current.ddl)}
            </p>
            <div className="flex items-center justify-between">
              <button
                onClick={openTimeEdit}
                className="text-[11px] font-semibold text-sandrift hover:text-charcoal transition-colors"
              >
                修改时间
              </button>
              <button
                onClick={handleUndoDDLMove}
                className="text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint px-2.5 py-1 rounded-lg transition-colors"
              >
                撤销
              </button>
            </div>

            {/* 修改时间 Popover：贴近反馈区，Esc / click outside 关闭 */}
            {timeEditOpen && (
              <div
                ref={timeEditRef}
                className="absolute bottom-full right-0 mb-1 w-44 bg-white border border-line-strong rounded-xl shadow-card p-2.5 space-y-2 z-40"
              >
                <label className="block text-[10px] font-bold text-sandrift">
                  截止时间
                </label>
                <input
                  ref={timeInputRef}
                  type="time"
                  value={timeInput}
                  onChange={(e) => setTimeInput(e.target.value)}
                  className="w-full p-1.5 bg-[#F7F5F5] border border-line rounded-lg text-xs font-mono focus:outline-none"
                />
                <div className="flex justify-end space-x-1.5">
                  <button
                    onClick={() => setTimeEditOpen(false)}
                    className="px-2 py-1 text-[10px] font-medium text-satin-grey bg-[#F7F5F5] border border-line rounded-lg hover:bg-alba"
                  >
                    取消
                  </button>
                  <button
                    onClick={saveTimeEdit}
                    className="px-2 py-1 text-[10px] font-bold text-white bg-charcoal hover:bg-black rounded-lg"
                  >
                    保存
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
