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
import { useToastStore } from "@/store/useToastStore";
import { FocusControl } from "@/components/focus/FocusControl";
import { getSemesterWeek } from "@/lib/semester";
import { getLocalDDLDate, getLocalDDLTime } from "@/lib/ddl";
import { isScheduleActive } from "@/lib/schedule";
import { openAssignmentEditor } from "@/lib/uiEvents";
import { cn, cardKeyHandler } from "@/lib/utils";
import { Assignment } from "@/types";
import { isValidDDL, moveAssignmentDDL, editAssignmentDDLTime } from "@/lib/ddlInteraction";
import { useSlidingIndicator } from "@/lib/useSlidingIndicator";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { usePresence } from "@/lib/usePresence";
import { useInertOnHidden } from "@/lib/useInertOnHidden";
import { MOTION_EXIT_MS } from "@/lib/motion";
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

/** Agenda 可见性决策（hysteresis；纯函数便于测试）：
 *  visible 时：containerHeight < required → hide
 *  hidden 时：containerHeight >= required + hysteresis → show */
export function shouldShowAgenda(input: {
  visible: boolean;
  containerHeight: number;
  requiredHeight: number;
  hysteresis?: number;
}): boolean {
  const h = input.hysteresis ?? AGENDA_SHOW_HYSTERESIS_PX;
  if (input.visible) {
    return input.containerHeight >= input.requiredHeight;
  }
  return input.containerHeight >= input.requiredHeight + h;
}

const FEEDBACK_MS = 5000;

// ---- Layout Hotfix：Agenda 自适应（container-height 判断；不再用 viewport max-height）----
// 最小日期行高（px）：空间不足时缩到此值；空间充足时由 1fr 均分扩展。
// 实测校准（2026-08）：6 行月份 required = 370（32 padding + 36 gaps + header 40 + weekday 24 +
// 6×22+20 日期格 + agenda 86）；基础 shell 380 → 容器 ~378 ≥ 370 → 手机/平板 6 行月份 Agenda 仍显示
// （既有 mobile DDL cell 测试语义保持）；315 短 shell → 313 < 349（5 行也放不下）→ 正确隐藏。
const MIN_DATE_ROW_HEIGHT = 22;
// 日期格行间 gap（grid gap-1 = 4px）
const GRID_ROW_GAP_PX = 4;
// Card root 垂直 padding（p-4 = 16×2）
const CARD_PADDING_VERTICAL_PX = 32;
// space-y-3 的 section gap（Agenda visible 时 3 段 / hidden 时 2 段）
const SECTION_GAP_PX = 12;
// Agenda 恢复阈值 hysteresis：容器高度由外层 Shell 固定（不随 Agenda 状态变化）——
// 不存在 show/hide 反馈回路，8px 足够覆盖 ResizeObserver 测量抖动（±1-2px），
// 且能保证所有 shell 档位（378/388/408/418）在变高后都能重新显示 Agenda。
const AGENDA_SHOW_HYSTERESIS_PX = 8;
// 未测量前的兜底 chrome 高度（首次渲染 / Agenda 隐藏期间使用）
const FALLBACK_HEADER_PX = 44;
const FALLBACK_WEEKDAY_PX = 24;
const FALLBACK_AGENDA_PX = 88;

/** Agenda visible 所需的最小容器高度（weekRows-aware；纯函数便于测试）：
 *  padding + sections + header + weekday + 日期格（rows×min + gaps）+ agenda natural。
 *  Agenda 隐藏 / 恢复共用同一 requiredHeight（阈值差由调用方 hysteresis 提供）。 */
export function computeAgendaRequiredHeight(input: {
  weekRows: number;
  headerHeight: number;
  weekdayHeight: number;
  agendaHeight: number;
}): number {
  const { weekRows, headerHeight, weekdayHeight, agendaHeight } = input;
  const dateRows =
    weekRows * MIN_DATE_ROW_HEIGHT + Math.max(0, weekRows - 1) * GRID_ROW_GAP_PX;
  return (
    CARD_PADDING_VERTICAL_PX +
    3 * SECTION_GAP_PX +
    headerHeight +
    weekdayHeight +
    dateRows +
    agendaHeight
  );
}

export function MiniCalendar() {
  // 精确 selector：避免整 store 订阅导致无关 state 更新触发整卡 re-render
  const schedules = useAppStore((s) => s.schedules);
  const assignments = useAppStore((s) => s.assignments);
  const calendarMarks = useAppStore((s) => s.calendarMarks);
  const courses = useAppStore((s) => s.courses);
  const semester = useAppStore((s) => s.semester);
  const ddlDirectEnabled = useAppStore((s) => s.preferences.enableDDLDirectManipulation);
  // actions（zustand 引用稳定）
  const setSelectedCourseId = useAppStore((s) => s.setSelectedCourseId);
  const setSelectedAssignmentId = useAppStore((s) => s.setSelectedAssignmentId);
  // Workflow UX V2：exam/activity agenda cell → 统一 CalendarMarkDetailDrawer
  const setSelectedCalendarMarkId = useAppStore((s) => s.setSelectedCalendarMarkId);
  const updateAssignment = useAppStore((s) => s.updateAssignment);
  const pushToast = useToastStore.getState().pushToast;

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  // ---- Layout Hotfix：container-height 驱动的 Agenda 可见性 ----
  // 判断依据是 MiniCalendar 自身可用高度（Sidebar/Header/Browser chrome/Overview 布局都会改变它），
  // 不再使用 window.innerHeight / @media(max-height:800px)。
  const cardRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const weekdayRef = useRef<HTMLDivElement | null>(null);
  const agendaRef = useRef<HTMLDivElement | null>(null);
  const [containerHeight, setContainerHeight] = useState<number | null>(null);
  const [agendaVisible, setAgendaVisible] = useState(true);
  const [measured, setMeasured] = useState({
    header: FALLBACK_HEADER_PX,
    weekday: FALLBACK_WEEKDAY_PX,
    agenda: FALLBACK_AGENDA_PX,
  });

  // 容器高度：真实 DOM 测量（Shell 高度由外层布局决定；Agenda 显示状态不影响容器高度）
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const apply = () => setContainerHeight(el.clientHeight);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const monthKey = format(currentMonth, "yyyy-MM");

  // 实测 Header / Weekday / Agenda natural 高度（Agenda 隐藏期间沿用最后一次测量值；
  // 月份切换（weekRows 变化）后重新测量）
  useEffect(() => {
    const h = headerRef.current?.offsetHeight;
    const w = weekdayRef.current?.offsetHeight;
    const a = agendaRef.current?.offsetHeight;
    if (h) setMeasured((m) => (m.header === h ? m : { ...m, header: h }));
    if (w) setMeasured((m) => (m.weekday === w ? m : { ...m, weekday: w }));
    if (a) setMeasured((m) => (m.agenda === a ? m : { ...m, agenda: a }));
  }, [monthKey, agendaVisible]);

  const monthStart = startOfMonth(currentMonth);  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const days = eachDayOfInterval({ start: startDate, end: endDate });
  const weekRows = days.length / 7;

  // ---- Layout Hotfix：weekRows-aware required height + hysteresis ----
  const agendaRequiredHeight = computeAgendaRequiredHeight({
    weekRows,
    headerHeight: measured.header,
    weekdayHeight: measured.weekday,
    agendaHeight: measured.agenda,
  });
  useEffect(() => {
    if (containerHeight === null) return;
    const next = shouldShowAgenda({
      visible: agendaVisible,
      containerHeight,
      requiredHeight: agendaRequiredHeight,
    });
    if (next !== agendaVisible) setAgendaVisible(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerHeight, agendaRequiredHeight, agendaVisible]);

  // 月份切换方向：上一月 -6px 进入，下一月 +6px 进入（仅网格，卡片不动）
  const prevMonthRef = useRef(currentMonth);
  const [monthDir, setMonthDir] = useState(0);
  useEffect(() => {
    if (prevMonthRef.current.getTime() !== currentMonth.getTime()) {
      setMonthDir(currentMonth.getTime() > prevMonthRef.current.getTime() ? 1 : -1);
      prevMonthRef.current = currentMonth;
    }
  }, [currentMonth]);

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
    mediaState.wide && mediaState.fine && ddlDirectEnabled;

  const [drag, setDrag] = useState<DDLDragState>({ type: "idle" });
  // 同步镜像：pointer 事件快于 React 渲染，handler 一律读 ref（见 Task 2 竞态修复）
  const dragRef = useRef<DDLDragState>({ type: "idle" });
  const setDragSync = (d: DDLDragState) => {
    dragRef.current = d;
    setDrag(d);
  };
  const wasDraggedRef = useRef(false);
  // pointermove rAF 合并：hit-test（elementFromPoint 强制布局）+ setState 每帧至多一次；
  // 松手/取消时同步 flush，保证最后一帧不丢（与课表拖拽同模式）
  const ddlMoveFrameRef = useRef(0);
  const pendingDdlMoveRef = useRef<{ x: number; y: number } | null>(null);

  // ---- DDL 移动反馈（局部，4-6 秒）----
  const [feedback, setFeedback] = useState<DDLMoveFeedbackState | null>(null);
  // 退场播 stale 快照（DisclosureRegion 卸载延迟期内内容仍在，与抽屉 staleMark 同模式）
  const lastFeedbackRef = useRef<DDLMoveFeedbackState | null>(null);
  if (feedback) lastFeedbackRef.current = feedback;
  const shownFeedback = feedback ?? lastFeedbackRef.current;
  const feedbackTimerRef = useRef<number | null>(null);
  const [timeEditOpen, setTimeEditOpen] = useState(false);
  // 时间编辑浮层对称进退（absolute，不顶布局）；退出窗口内输入框不可聚焦
  const timeEditPresence = usePresence(timeEditOpen, MOTION_EXIT_MS.fast);
  const timeEditInertRef = useInertOnHidden<HTMLDivElement>(!timeEditPresence.visible);
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
      pendingDdlMoveRef.current = null;
      if (ddlMoveFrameRef.current) cancelAnimationFrame(ddlMoveFrameRef.current);
      ddlMoveFrameRef.current = 0;
    },
    []
  );

  const cancelDrag = () => {
    wasDraggedRef.current = false;
    pendingDdlMoveRef.current = null;
    if (ddlMoveFrameRef.current) {
      cancelAnimationFrame(ddlMoveFrameRef.current);
      ddlMoveFrameRef.current = 0;
    }
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

  const flushDdlMoveFrame = () => {
    ddlMoveFrameRef.current = 0;
    const pending = pendingDdlMoveRef.current;
    pendingDdlMoveRef.current = null;
    if (!pending) return;
    const current = dragRef.current;
    if (current.type === "pending") {
      const dist = Math.hypot(pending.x - current.startX, pending.y - current.startY);
      if (dist >= DRAG_THRESHOLD_PX) {
        wasDraggedRef.current = true;
        setDragSync({
          type: "dragging",
          assignment: current.assignment,
          x: pending.x,
          y: pending.y,
          hoverDateStr: null,
        });
      }
      return;
    }
    if (current.type === "dragging") {
      const hit = document
        .elementFromPoint(pending.x, pending.y)
        ?.closest?.("[data-calendar-day]");
      const hoverDateStr = hit?.getAttribute("data-calendar-day") ?? null;
      setDragSync({ ...current, x: pending.x, y: pending.y, hoverDateStr });
    }
  };

  const handleDDLPointerMove = (e: React.PointerEvent) => {
    pendingDdlMoveRef.current = { x: e.clientX, y: e.clientY };
    if (ddlMoveFrameRef.current) return;
    ddlMoveFrameRef.current = requestAnimationFrame(flushDdlMoveFrame);
  };

  const handleDDLPointerUp = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    // 先同步 flush 最后一帧，再按最新 hover 落位
    if (ddlMoveFrameRef.current) {
      cancelAnimationFrame(ddlMoveFrameRef.current);
      ddlMoveFrameRef.current = 0;
    }
    flushDdlMoveFrame();
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
    // Stale-snapshot 防御：feedback 挂着拖动时刻的任务快照（存活 4-6s），
    // 期间任务可能已被删除（其它 surface / Kiro）。已删除 → 放弃写回 + 提示。
    const stillExists = assignments.some((a) => a.id === feedback.current.id);
    if (!stillExists) {
      setFeedback(null);
      setTimeEditOpen(false);
      pushToast({ message: "该任务已被删除，修改未保存", type: "warning" });
      return;
    }
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
    // Stale-snapshot 防御：同 saveTimeEdit —— 任务已删除则撤销恢复同样必须放弃
    const stillExists = assignments.some((a) => a.id === feedback.origin.id);
    if (!stillExists) {
      setFeedback(null);
      if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
      return;
    }
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
      onClick: () => setSelectedCalendarMarkId(m.id),
    })),
    ...dayActivities.map((m) => ({
      key: `ac_${m.id}`,
      kind: "activity" as const,
      label: "活动",
      time: "99:00",
      onClick: () => setSelectedCalendarMarkId(m.id),
    })),
  ].sort((x, y) => x.time.localeCompare(y.time));

  const agendaPaged = paginate(agendaCells, agendaPage, 4);
  const pagedCells = agendaPaged.items;
  const agendaSafePage = agendaPaged.currentPage;
  const showAgendaPagination = agendaCells.length > 4;

  // ---- Desktop Header Compact Controls V1 ----
  // 基于 Header 真实容器宽度切换（非 viewport breakpoint）；带 hysteresis 防抖动。
  const COMPACT_HEADER_THRESHOLD = 520;
  const COMPACT_HEADER_HYSTERESIS = 16;
  const [headerWidth, setHeaderWidth] = useState(0);
  const [compactHeaderControls, setCompactHeaderControls] = useState(false);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHeaderWidth(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (headerWidth <= 0) return;
    setCompactHeaderControls((prev) => {
      if (!prev && headerWidth < COMPACT_HEADER_THRESHOLD) return true;
      if (prev && headerWidth >= COMPACT_HEADER_THRESHOLD + COMPACT_HEADER_HYSTERESIS) return false;
      return prev;
    });
  }, [headerWidth]);

  return (
    <div
      ref={cardRef}
      data-testid="calendar-card"
      data-week-rows={weekRows}
      data-agenda-required={Math.round(agendaRequiredHeight)}
      data-agenda-visible={agendaVisible ? "1" : "0"}
      className="dashboard-card p-4 space-y-3 flex flex-col min-h-0 h-full"
    >
      {/* Header：年月 min-w-0 不主动 truncate；右侧 controls shrink-0（compact 释放空间） */}
      <div
        ref={headerRef}
        className="flex items-center justify-between gap-2 pb-2 border-b border-line-soft"
      >
        <div className="flex items-center space-x-2 min-w-0">
          <CalendarIcon className="w-4 h-4 text-sandrift shrink-0" />
          <h3 key={monthKey} className="ux-fade text-sm font-semibold text-charcoal whitespace-nowrap">
            {format(currentMonth, "yyyy年 M月", { locale: zhCN })}
          </h3>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <FocusControl compact={compactHeaderControls} />
          <button
            onClick={handleResetToday}
            aria-label="回到今天"
            title="回到今天"
            className={
              compactHeaderControls
                ? "w-8 h-8 flex items-center justify-center rounded-lg bg-alabaster hover:bg-alba text-charcoal transition-colors"
                : "text-[11px] bg-alabaster hover:bg-alba text-charcoal h-8 px-2 rounded-lg font-bold transition-colors mr-1"
            }
          >
            {compactHeaderControls ? (
              <CalendarDays className="w-3.5 h-3.5" />
            ) : (
              "回到今天"
            )}
          </button>
          <button
            onClick={handlePrevMonth}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
            title="上一月"
            aria-label="上一月"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleNextMonth}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
            title="下一月"
            aria-label="下一月"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Weekday Row */}
      <div ref={weekdayRef} className="grid grid-cols-7 text-center text-[11px] font-bold text-sandrift">
        {["一", "二", "三", "四", "五", "六", "日"].map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar Grid（日期格 = DDL drop target；共享 Selection Indicator 位于 z-0）。
          Layout Hotfix：wrapper 为弹性区域（flex-1 min-h-0，不再 shrink-0）——
          Agenda hidden 时释放的 70–90px 按比例回流给日期格（grid-template-rows 1fr 均分），
          不是只拉高最后一行、也不是留下空白。 */}
      <div data-testid="calendar-grid-area" className="flex-1 min-h-0 overflow-hidden">
      <div
        ref={containerRef}
        data-selected-date={selectedDateKey}
        key={monthKey}
        className={cn(
          "relative grid grid-cols-7 gap-1 text-xs h-full",
          monthDir !== 0 && "ux-month-enter"
        )}
        style={{
          gridTemplateRows: `repeat(${weekRows}, minmax(${MIN_DATE_ROW_HEIGHT}px, 1fr))`,
          ...(monthDir !== 0
            ? ({ "--enter-x": monthDir === 1 ? "6px" : "-6px" } as React.CSSProperties)
            : undefined),
        }}
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
                // Layout Hotfix：日期格高度动态（h-full + min-height），由 grid-template-rows 1fr 均分；
                // 不再固定 h-8（否则 Agenda 隐藏后释放空间无法被利用）
                "relative z-10 h-full min-h-[22px] rounded-xl flex flex-col items-center justify-center",
                // 选中背景由共享 Indicator 承担；按钮只处理前景色（120–140ms 过渡，先于滑块到位）
                "transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
                // 日期格取消全局 button:active 缩放，避免「格子缩一下 + 滑块移动」双重抖动
                "active:transform-none",
                isSelected
                  ? "text-white font-bold"
                  : isTodayDate
                  ? "bg-pastel-mint text-charcoal font-extrabold border border-stone-beige"
                  : isCurrentMonth
                  ? "text-charcoal hover:bg-alabaster"
                  : "text-stone-beige opacity-40 hover:opacity-80",
                // DDL 拖动中：全部日期格低饱和 outline；当前目标 1px 低对比 + 极弱 tint（与
                // Timeline day target 同强度；强语义交给 drag preview，不大面积填色）
                dragActive && "outline outline-1 outline-line-soft",
                isHoverTarget && "outline-charcoal/30 bg-alabaster/55"
              )}
            >
              {/* Fixed Content Stack：数字 → gap-1(4px) → indicator rail（永远存在，h-1）。
                  数字与 dots 的相对距离由 stack 决定，不再随 Cell 高度漂移；
                  无事件日期也 render 空 rail，保证有/无事件日期数字垂直位置完全一致。 */}
              <span
                data-testid="calendar-date-content"
                className="flex flex-col items-center justify-center gap-1"
              >
                <span className="leading-none">{format(day, "d")}</span>
                <span
                  aria-hidden="true"
                  data-testid="calendar-indicator-rail"
                  className="flex h-1 items-center justify-center gap-0.5"
                >
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
                </span>
              </span>
            </button>
          );
        })}
      </div>
      </div>

      {/* Drag Preview：跟随 pointer，不复制完整卡片；无动画（Reduced Motion 下天然静态）。
          禁止 left/top/transform transition——否则 preview 拖尾 */}
      {dragActive && (
        <div
          aria-hidden="true"
          data-testid="ddl-drag-preview"
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

      {/* Selected Date Agenda：横向 Compact Event Grid（4 列/页，仅类型 + 图标；详情走 Drawer）。
          Layout Hotfix：可见性由 MiniCalendar 容器真实高度 + weekRows + hysteresis 决定
          （不再用 @media(max-height:800px)）。
          显隐走 DisclosureRegion（grid 折叠 + fade）：隐藏时高度平滑回流给 Calendar Grid，
          不再整块卸载跳变；测量逻辑不受影响（折叠期 offsetHeight 0 被 if (a) 忽略）。 */}
      <DisclosureRegion open={agendaVisible} className="shrink-0">
      <div
        ref={agendaRef}
        data-testid="calendar-agenda"
        className="pt-1.5 pb-1 border-t border-line-soft"
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 min-h-6 text-xs">
          <span className="font-bold text-charcoal min-w-0 truncate whitespace-nowrap">
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
                  className="w-6 h-6 flex items-center justify-center rounded-md text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-sandrift"
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
                  className="w-6 h-6 flex items-center justify-center rounded-md text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-sandrift"
                >
                  <ChevronRight className="w-3 h-3" />
                </button>
              </span>
            )}
          </span>
        </div>

        {/* Compact Event Grid：高度恒定（一行 h-12），不随数量变化 */}
        <div
          key={`${selectedDateStr}-${agendaSafePage}`}
          data-testid="agenda-grid"
          className="ux-agenda-swap grid grid-cols-4 gap-1.5 mt-1 min-h-[48px]"
        >
          {pagedCells.length === 0 ? (
            <div className="col-span-4 h-12 flex items-center justify-center gap-2 text-[10px] text-sandrift">
              <span>暂无安排</span>
              <button
                onClick={handleQuickAddAssignment}
                className="ux-press inline-flex items-center gap-1 px-2 py-1 bg-charcoal hover:bg-black text-white text-[11px] font-bold rounded-lg transition-colors"
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
                    "h-12 rounded-lg border flex flex-col items-center justify-center gap-0.5 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
                    cell.kind === "course" && "cursor-pointer hover:opacity-90",
                    cell.kind === "ddl" && [
                      "bg-danger-bg border-danger-border text-danger cursor-pointer",
                      draggable && "cursor-grab active:cursor-grabbing",
                      // Grab 态统一语言：source 只降视觉权重（~40%），无 scale/shadow
                      isDraggingThis && "opacity-40",
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
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-[10px] font-bold leading-none">{cell.label}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
      </DisclosureRegion>

      {/* DDL Move Feedback：局部轻量反馈（撤销 + 修改时间），不破坏全局 Toast；折叠进退。
          退场播 stale 快照（内容在折叠播完前不消失，与抽屉 staleMark 同模式） */}
      <DisclosureRegion open={feedback != null}>
        {shownFeedback ? (
        <div className="relative">
          <div
            data-testid="ddl-move-feedback"
            className="ux-inline bg-surface border border-line-strong rounded-xl shadow-card p-2.5 space-y-2"
          >
              <p className="text-[11px] font-bold text-charcoal">
                已移动到{" "}
                {format(parseISO(shownFeedback.targetDate), "M月d日", { locale: zhCN })} ·{" "}
                {getLocalDDLTime(shownFeedback.current.ddl)}
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

            {/* 修改时间 Popover：贴近反馈区，Esc / click outside 关闭，对称进退 */}
            {timeEditPresence.mounted && (
              <div
                ref={(el) => {
                  timeEditRef.current = el;
                  timeEditInertRef(el);
                }}
                className={cn(
                  "absolute bottom-full right-0 mb-1 w-44 bg-background border border-line-strong rounded-xl shadow-card p-2.5 space-y-2 z-40 origin-bottom-right transition-[opacity,transform]",
                  timeEditPresence.visible
                    ? "opacity-100 scale-100 duration-[var(--motion-fast)]"
                    : "opacity-0 scale-[0.98] translate-y-[3px] pointer-events-none duration-[var(--motion-exit-fast)] ease-[var(--ease-exit)]"
                )}
              >
                <label className="block text-[10px] font-bold text-sandrift">
                  截止时间
                </label>
                <input
                  ref={timeInputRef}
                  type="time"
                  value={timeInput}
                  onChange={(e) => setTimeInput(e.target.value)}
                  className="w-full p-1.5 bg-background border border-line rounded-lg text-xs font-mono focus:outline-none"
                />
                <div className="flex justify-end space-x-1.5">
                  <button
                    onClick={() => setTimeEditOpen(false)}
                    className="px-2 py-1 text-[11px] font-medium text-satin-grey bg-background border border-line rounded-lg hover:bg-alba"
                  >
                    取消
                  </button>
                  <button
                    onClick={saveTimeEdit}
                    className="px-2 py-1 text-[11px] font-bold text-white bg-charcoal hover:bg-black rounded-lg"
                  >
                    保存
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        ) : null}
      </DisclosureRegion>
    </div>
  );
}
