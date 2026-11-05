"use client";

import React, { useEffect, useRef, useState } from "react";
import { ExternalLink, AlertTriangle, ChevronLeft, ChevronRight, MapPin, User, CalendarPlus, FileUp } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { getWeekDateRange, formatWeekDateRange, getSemesterWeek } from "@/lib/semester";
import { resolveCourseOccurrencesForWeek } from "@/lib/scheduleOccurrences";
import { findScheduleConflicts } from "@/lib/conflicts";
import { isScheduleActive, timeToMinutes } from "@/lib/schedule";
import { getNowIndicatorPosition } from "@/lib/timeline/nowIndicator";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { MOTION_MS } from "@/lib/motion";
import { Course, CourseSchedule, ScheduleConflict } from "@/types";
import {
  TIMETABLE_DAY_START_MINUTES,
  TIMETABLE_DAY_END_MINUTES,
  pointerToMinutes,
  pointerToDayIndex,
  calculateDraggedSchedule,
  calculateResizedSchedule,
  validateScheduleCandidate,
} from "@/lib/timetableInteraction";

const TIME_SLOTS = [
  "08:00",
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00",
  "18:00",
  "19:00",
  "20:00",
  "21:00",
];

/** 分钟 → "HH:mm"（Now 胶囊用） */
function minutesToClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 点击 vs 拖动阈值（px）：未超过仍视为点击，打开课程 Drawer */
const DRAG_THRESHOLD_PX = 5;

/** 直接编辑状态机：idle / move / resize。仅候选值存在组件内，Store 只在 pointerup 提交 */
type Interaction =
  | { type: "idle" }
  | {
      type: "move";
      scheduleId: string;
      origin: CourseSchedule;
      candidate: CourseSchedule;
      valid: boolean;
      conflict: ScheduleConflict | null;
    }
  | {
      type: "resize";
      scheduleId: string;
      origin: CourseSchedule;
      candidate: CourseSchedule;
      valid: boolean;
      conflict: ScheduleConflict | null;
    };

/** 时间 gutter 固定宽度（Timeline / Overview / Fullscreen 统一，避免时间列与 Day 等宽浪费空间） */
export const TIMETABLE_GUTTER_PX = 56;

export function TimetableGrid({
  editable = false,
  density = "comfortable",
  showHeader = true,
  showWeekdayHeader = true,
  variant = "card",
  headerActions,
  fillAvailableHeight = false,
  extraLayers,
  courseIndicators,
}: {
  editable?: boolean;
  /** compact：仅 Overview 只读表示层（更紧凑的时间轴）；default 保持舒展（workspace / FullTimetableModal） */
  density?: "compact" | "comfortable";
  /** Timeline Workspace：Header 由外层 Timeline 提供（本组件不渲染自己的 header） */
  showHeader?: boolean;
  /** Timeline Workspace：Weekday Header 由外层 Timeline 提供（避免重复） */
  showWeekdayHeader?: boolean;
  /** card：独立 Card（Overview / Fullscreen）；embedded：嵌入外层 Surface（Timeline，去 border/padding/min-height） */
  variant?: "card" | "embedded";
  /** Overview：Header 右侧的 Quick Glance 等额外动作（渲染在「查看课表」之前） */
  headerActions?: React.ReactNode;
  /** Overview Hero：取消固定 min-height，由外层容器 flex 撑满首屏（08:00–21:00 均匀铺满） */
  fillAvailableHeight?: boolean;
  /** Timeline V1：在每一天列内渲染额外绝对定位层（如 StudyBlock） */
  extraLayers?: (ctx: {
    dayOfWeek: number;
    dayStartMinutes: number;
    totalMinutes: number;
    timeToMinutes: (t: string) => number;
  }) => React.ReactNode;
  /** Timeline Workspace：课程卡右上角 overlay（如重叠 StudyBlock 的 Task Marker）。
     渲染在课程 Card 之外（不受 overflow-hidden 限制）；Overview / FullTimetableModal 不传 → 不显示。 */
  courseIndicators?: (ctx: {
    schedule: CourseSchedule;
    course: Course;
    dayOfWeek: number;
    hasConflict: boolean;
    dayStartMinutes: number;
    totalMinutes: number;
  }) => React.ReactNode;
  }) {
  const isCompactDensity = density === "compact";
  // 精确 selector：避免整 store 订阅导致无关 state 更新触发整卡 re-render
  const courses = useAppStore((s) => s.courses);
  const schedules = useAppStore((s) => s.schedules);
  const scheduleOccurrenceOverrides = useAppStore((s) => s.scheduleOccurrenceOverrides);
  const semester = useAppStore((s) => s.semester);
  const currentSemesterWeek = useAppStore((s) => s.currentSemesterWeek);
  const preferences = useAppStore((s) => s.preferences);
  // actions（zustand 引用稳定）
  const setCurrentSemesterWeek = useAppStore((s) => s.setCurrentSemesterWeek);
  const setSelectedCourseId = useAppStore((s) => s.setSelectedCourseId);
  const setAddCourseModalOpen = useAppStore((s) => s.setAddCourseModalOpen);
  const setImportScheduleModalOpen = useAppStore((s) => s.setImportScheduleModalOpen);
  const setConflictModalOpen = useAppStore((s) => s.setConflictModalOpen);
  const setSelectedConflict = useAppStore((s) => s.setSelectedConflict);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const setFullTimetableModalOpen = useAppStore((s) => s.setFullTimetableModalOpen);
  const updateSchedule = useAppStore((s) => s.updateSchedule);
  const pushToast = useToastStore((s) => s.pushToast);

  // 周一至周日表头完全由 semester.startDate + currentSemesterWeek 推导。
  // showWeekends=false 时只渲染 Mon–Fri 5 列：dayOfWeek = 列序 + 1（前 5 天连续），
  // 指针几何、拖拽映射、表头与网格宽度全部一致；周六/周日课程数据不删除，重新打开即恢复。
  const weekDays = getWeekDateRange(semester, currentSemesterWeek);
  const dayCount = preferences.showWeekends ? 7 : 5;
  const weekdays = (preferences.showWeekends
    ? ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    : ["周一", "周二", "周三", "周四", "周五"]
  ).map((label, idx) => {
    return {
      dayOfWeek: idx + 1,
      label,
      dateStr: format(weekDays[idx], "M/d"),
    };
  });

  const timeToMinutesSafe = (timeStr: string) => timeToMinutes(timeStr) ?? 0;

  const dayStartMinutes = TIMETABLE_DAY_START_MINUTES; // 08:00
  const dayEndMinutes = TIMETABLE_DAY_END_MINUTES; // 21:00 (Includes evening classes)
  const totalMinutes = dayEndMinutes - dayStartMinutes; // 780 minutes total

  // Task 7：当前教学周的有效课程 = base + move + extra occurrences（唯一 Source of Truth：
  // cancel 消失 / move 显示目标位 / extra 出现；isScheduleActive 由 resolver 统一尊重）
  // P2：memo 化（此前 30s tick 每次全量重算；仅周/课表/覆盖变化才重算）
  const activeSchedules = React.useMemo(
    () =>
      resolveCourseOccurrencesForWeek({
        schedules,
        overrides: scheduleOccurrenceOverrides,
        week: currentSemesterWeek,
        totalWeeks: semester.totalWeeks,
      }),
    [schedules, scheduleOccurrenceOverrides, currentSemesterWeek, semester.totalWeeks]
  );

  // 今天 / 当前周（今天列 tint + 实时 Now Indicator）
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const isRealCurrentWeek = getSemesterWeek(new Date(), semester) === currentSemesterWeek;
  const [nowMinutes, setNowMinutes] = useState(() => new Date().getHours() * 60 + new Date().getMinutes());
  // 显式消费 reduced 标志：now-indicator 的 30s 线性位移是 JS 驱动视觉运动，
  // 全局 CSS override 兜底外再加显式分支，语义更清晰
  const reducedMotion = useEffectiveReducedMotion();
  // 实时更新：仅当前周 + 今天列需要；30s 节流 + CSS 30s linear transition 实现平滑流动
  React.useEffect(() => {
    if (!isRealCurrentWeek) return;
    const update = () => setNowMinutes(new Date().getHours() * 60 + new Date().getMinutes());
    update();
    const timer = setInterval(update, 30_000);
    return () => clearInterval(timer);
  }, [isRealCurrentWeek]);

  // 当前正在进行的课程（仅当前周 + 今天列；nowMinutes 落在某课程 [start,end) 内）
  const nowDayOfWeek = new Date().getDay() === 0 ? 7 : new Date().getDay();
  const nowCourseSchedule = isRealCurrentWeek
    ? activeSchedules.find(
        (s) =>
          s.dayOfWeek === nowDayOfWeek &&
          nowMinutes >= (timeToMinutes(s.startTime) ?? 0) &&
          nowMinutes < (timeToMinutes(s.endTime) ?? 0)
      )
    : undefined;

  // 统一冲突定义（与导入器一致）：星期相同 + 时间重叠 + 至少一个共同生效教学周；
  // ignoreSameCourse：同一门课内部时段重叠不标冲突（连堂/同课多节属该课程自身安排）
  const conflicts = React.useMemo(
    () => findScheduleConflicts(activeSchedules, { ignoreSameCourse: true }),
    [activeSchedules]
  );
  const firstConflict = conflicts[0];
  // 横幅退场播 stale 快照（DisclosureRegion 卸载延迟期内 conflicts 已空，直接解引用会崩）
  const lastConflictsRef = useRef<ScheduleConflict[]>([]);
  if (conflicts.length > 0) lastConflictsRef.current = conflicts;
  const shownConflicts = conflicts.length > 0 ? conflicts : lastConflictsRef.current;
  const shownFirstConflict = shownConflicts[0];

  // 周次切换方向：上一周 -6px 进入，下一周 +6px 进入（仅内容区，卡片本体不动）
  const prevWeekRef = useRef(currentSemesterWeek);
  const [weekDir, setWeekDir] = useState(0);
  const [weekMotionNonce, setWeekMotionNonce] = useState(0);
  useEffect(() => {
    if (prevWeekRef.current !== currentSemesterWeek) {
      setWeekDir(currentSemesterWeek > prevWeekRef.current ? 1 : -1);
      setWeekMotionNonce((n) => n + 1);
      prevWeekRef.current = currentSemesterWeek;
    }
  }, [currentSemesterWeek]);

  const handleOpenFullTimetable = () => {
    setActiveTab("timetable");
    setFullTimetableModalOpen(true);
  };

  // ---- 直接编辑：仅完整课表工作区 + viewport ≥768px + 精确指针（mouse/pen） ----
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
  // touch（手机/平板触摸）不进入拖动：不 setPointerCapture、不拦截滚动
  // 直接编辑：完整课表工作区（editable prop）+ viewport ≥768 + 精确指针 + 偏好开启
  const editingEnabled =
    editable &&
    mediaState.wide &&
    mediaState.fine &&
    preferences.enableScheduleDirectManipulation;

  const [interaction, setInteraction] = useState<Interaction>({ type: "idle" });
  // 成功落位后短暂 settle 的目标卡片（ux-settle 只作用于刚提交的卡）
  const [settleId, setSettleId] = useState<string | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  // 同步镜像：pointer 事件比 React 渲染更密集，handler 必须读 ref 而非闭包，
  // 否则 pointerup 可能提交滞后的 candidate（例如 13:45 而非 14:00）。
  const interactionRef = useRef<Interaction>({ type: "idle" });
  const setInteractionSync = (it: Interaction) => {
    interactionRef.current = it;
    setInteraction(it);
  };
  const gridBodyRef = useRef<HTMLDivElement | null>(null);
  /**
   * 窄容器卡片降级：按「每天列宽」而不是 viewport 判断。
   * Overview（density=compact）始终是摘要卡（~81–97px/天）；
   * Timeline 在 <132px/天 时同样降级，1440 宽屏保留完整 teacher/location。
   */
  const [compactCards, setCompactCards] = useState(isCompactDensity);
  useEffect(() => {
    const el = gridBodyRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const dayWidth = el.clientWidth / Math.max(1, dayCount);
      // Overview（density=compact）始终走摘要卡；Timeline 独立判定：
      // <132px/天（1024–1280）进入摘要卡，1440（~154px）保留 teacher + location。
      setCompactCards(isCompactDensity || dayWidth < 132);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dayCount, isCompactDensity]);
  const pendingRef = useRef<{
    origin: CourseSchedule;
    startX: number;
    startY: number;
  } | null>(null);
  const dragOffsetRef = useRef(0);
  const wasDraggedRef = useRef(false);

  // pointermove rAF 合并（与 Sidecar Shell 同模式）：高频事件只记最新坐标，
  // 每帧至多一次 setState + 冲突重算；松手/取消时同步 flush，保证最后一帧不丢。
  const moveFrameRef = useRef(0);
  const pendingPointerRef = useRef<{
    x: number;
    y: number;
    sched: CourseSchedule;
    kind: "move" | "resize";
  } | null>(null);

  const cancelInteraction = () => {
    pendingRef.current = null;
    wasDraggedRef.current = false;
    pendingPointerRef.current = null;
    if (moveFrameRef.current) {
      cancelAnimationFrame(moveFrameRef.current);
      moveFrameRef.current = 0;
    }
    setInteractionSync({ type: "idle" });
  };

  // Esc 取消；组件卸载清理
  useEffect(() => {
    if (interaction.type === "idle") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelInteraction();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interaction.type]);

  // 拖拽进行中标记：全局单键快捷键（如 N）据此跳过，避免拖拽中误触发
  useEffect(() => {
    document.body.dataset.dragActive = interaction.type !== "idle" ? "1" : "";
    return () => {
      document.body.dataset.dragActive = "";
    };
  }, [interaction.type]);

  useEffect(
    () => () => {
      pendingRef.current = null;
      wasDraggedRef.current = false;
      pendingPointerRef.current = null;
      if (moveFrameRef.current) cancelAnimationFrame(moveFrameRef.current);
      moveFrameRef.current = 0;
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
    },
    []
  );

  const getPointerMinutes = (clientY: number) => {
    const rect = gridBodyRef.current?.getBoundingClientRect();
    if (!rect) return dayStartMinutes;
    return pointerToMinutes(clientY, rect.top, rect.height);
  };

  const getDayIndex = (clientX: number) => {
    const rect = gridBodyRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return pointerToDayIndex(clientX, rect.left, rect.width, dayCount);
  };

  /** 冲突的另一门课程名（candidate 之外的那一方） */
  const conflictCourseName = (conflict: ScheduleConflict | null, candidateId: string) => {
    if (!conflict) return "未知课程";
    const other =
      conflict.scheduleA.id === candidateId ? conflict.scheduleB : conflict.scheduleA;
    return courses.find((c) => c.id === other.courseId)?.name ?? "未知课程";
  };

  // ---- Move ----
  const engageMove = (origin: CourseSchedule, clientX: number, clientY: number) => {
    const pointerMin = getPointerMinutes(clientY);
    const candidate = calculateDraggedSchedule(
      origin,
      pointerMin,
      dragOffsetRef.current,
      getDayIndex(clientX) + 1
    );
    const { valid, conflict } = validateScheduleCandidate(candidate, schedules, origin.id);
    wasDraggedRef.current = true;
    setInteractionSync({ type: "move", scheduleId: origin.id, origin, candidate, valid, conflict });
  };

  const handleCardPointerDown = (e: React.PointerEvent, sched: CourseSchedule) => {
    if (!editingEnabled || e.pointerType === "touch") return;
    // Task 7：moved / extra 一次性 occurrence 不可直接编辑（编辑会改变 recurring schedule）；
    // 仅 base occurrence 支持拖拽/缩放
    if ((sched as { source?: string }).source && (sched as { source?: string }).source !== "base") return;
    pendingRef.current = { origin: sched, startX: e.clientX, startY: e.clientY };
    dragOffsetRef.current = getPointerMinutes(e.clientY) - timeToMinutesSafe(sched.startTime);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* 已释放的 capture 忽略 */
    }
  };

  /** 同步执行一次 pending pointer（rAF 回调与 pointerup 共用，保证最后一帧不丢） */
  const flushPointerFrame = () => {
    moveFrameRef.current = 0;
    const pending = pendingPointerRef.current;
    pendingPointerRef.current = null;
    if (!pending) return;
    if (pending.kind === "move") processCardPointerMove(pending.x, pending.y, pending.sched);
    else processResizePointerMove(pending.x, pending.y, pending.sched);
  };

  const schedulePointerFrame = (x: number, y: number, sched: CourseSchedule, kind: "move" | "resize") => {
    pendingPointerRef.current = { x, y, sched, kind };
    if (moveFrameRef.current) return;
    moveFrameRef.current = requestAnimationFrame(flushPointerFrame);
  };

  const handleCardPointerMove = (e: React.PointerEvent, sched: CourseSchedule) => {
    schedulePointerFrame(e.clientX, e.clientY, sched, "move");
  };

  const processCardPointerMove = (clientX: number, clientY: number, sched: CourseSchedule) => {
    const current = interactionRef.current;
    const pending = pendingRef.current;
    if (pending && current.type === "idle") {
      const dist = Math.hypot(clientX - pending.startX, clientY - pending.startY);
      if (dist >= DRAG_THRESHOLD_PX) engageMove(pending.origin, clientX, clientY);
      return;
    }
    if (current.type === "move" && current.scheduleId === sched.id) {
      const pointerMin = getPointerMinutes(clientY);
      const candidate = calculateDraggedSchedule(
        current.origin,
        pointerMin,
        dragOffsetRef.current,
        getDayIndex(clientX) + 1
      );
      const { valid, conflict } = validateScheduleCandidate(
        candidate,
        schedules,
        current.origin.id
      );
      setInteractionSync({ ...current, candidate, valid, conflict });
    }
  };

  const handleCardPointerUp = (e: React.PointerEvent, sched: CourseSchedule) => {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* 已释放 */
    }
    // 先同步 flush 最后一帧（rAF 可能还没跑），再按最新 candidate 提交
    if (moveFrameRef.current) {
      cancelAnimationFrame(moveFrameRef.current);
      moveFrameRef.current = 0;
    }
    flushPointerFrame();
    const current = interactionRef.current;
    if (current.type === "move" && current.scheduleId === sched.id) {
      commitInteraction(current);
      return;
    }
    // 未跨阈值 → 保持 click 语义（打开课程 Drawer）
    pendingRef.current = null;
  };

  // ---- Resize ----
  const handleResizePointerDown = (e: React.PointerEvent, sched: CourseSchedule) => {
    e.stopPropagation();
    if (!editingEnabled || e.pointerType === "touch") return;
    // Task 7：moved / extra 一次性 occurrence 不可直接编辑
    if ((sched as { source?: string }).source && (sched as { source?: string }).source !== "base") return;
    e.preventDefault();
    const candidate = calculateResizedSchedule(sched, getPointerMinutes(e.clientY));
    const { valid, conflict } = validateScheduleCandidate(candidate, schedules, sched.id);
    wasDraggedRef.current = true;
    setInteractionSync({ type: "resize", scheduleId: sched.id, origin: sched, candidate, valid, conflict });
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const handleResizePointerMove = (e: React.PointerEvent, sched: CourseSchedule) => {
    // 必须阻断冒泡：handle 在课程卡内部，卡片的 onPointerMove 会把 pending frame
    // 覆盖成 "move"，导致 resize candidate 永远停在 pointerdown 的那一帧。
    e.stopPropagation();
    schedulePointerFrame(e.clientX, e.clientY, sched, "resize");
  };

  const processResizePointerMove = (clientX: number, clientY: number, sched: CourseSchedule) => {
    const current = interactionRef.current;
    if (current.type !== "resize" || current.scheduleId !== sched.id) return;
    const candidate = calculateResizedSchedule(current.origin, getPointerMinutes(clientY));
    const { valid, conflict } = validateScheduleCandidate(
      candidate,
      schedules,
      current.origin.id
    );
    setInteractionSync({ ...current, candidate, valid, conflict });
  };

  const handleResizePointerUp = (e: React.PointerEvent, sched: CourseSchedule) => {
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (moveFrameRef.current) {
      cancelAnimationFrame(moveFrameRef.current);
      moveFrameRef.current = 0;
    }
    flushPointerFrame();
    const current = interactionRef.current;
    if (current.type === "resize" && current.scheduleId === sched.id) {
      commitInteraction(current);
    } else {
      setInteractionSync({ type: "idle" });
    }
  };

  // ---- 提交 / 取消 ----
  const commitInteraction = (it: Interaction & { type: "move" | "resize" }) => {
    if (it.valid) {
      // Task 7：base occurrence 的编辑写回其 recurring schedule（保持 weeks/excludedWeeks 等字段）；
      // moved / extra occurrence 已禁止直接编辑（handleCardPointerDown 拦截）
      const originBase = schedules.find(
        (s) =>
          s.id === ((it.origin as { baseScheduleId?: string }).baseScheduleId ?? it.origin.id)
      );
      const originBaseId = originBase ?? null;
      const next = originBase
        ? {
            ...originBase,
            dayOfWeek: it.candidate.dayOfWeek,
            startTime: it.candidate.startTime,
            endTime: it.candidate.endTime,
          }
        : it.candidate;
      // 有效：立即写 Store，并给出可撤销 Toast（恢复 origin，同一 id，全部字段）
      updateSchedule(next);
      // 落位 settle：只给刚提交的卡片一个极轻的 opacity 归位
      // S3-3：flag 窗口 = data(200) + 60ms 掉帧余量 —— 计时必须 ≥ 视觉（ux-settle-in），
      // 对齐相等会在掉帧时闪回未 settle 态（与 Inspector 截断反方向，彼处是卸载早于视觉）。
      setSettleId(it.candidate.id);
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = window.setTimeout(() => setSettleId(null), MOTION_MS.data + 60);
      pushToast({
        message: "课程时间已调整",
        actionLabel: "撤销",
        onAction: () => {
          if (originBaseId) {
            updateSchedule({
              ...originBaseId,
              dayOfWeek: it.origin.dayOfWeek,
              startTime: it.origin.startTime,
              endTime: it.origin.endTime,
            });
          } else {
            updateSchedule(it.origin);
          }
        },
      });
    } else {
      // 冲突：不写 Store，回到 origin（opacity 由卡片自身过渡平滑恢复，不做 shake）
      pushToast({
        type: "error",
        message: `与《${conflictCourseName(it.conflict, it.candidate.id)}》时间冲突，未调整`,
      });
    }
    pendingRef.current = null;
    setInteractionSync({ type: "idle" });
  };

  return (
    <div
      data-testid="timetable-card"
      className={
        variant === "embedded"
          ? "flex flex-col flex-1 min-h-0 w-full"
          : "dashboard-card p-4 flex flex-col justify-between h-full w-full"
      }
    >
      {/* Header：视觉层级 本周课表 > 周次 > Quick Glance > 查看课表 */}
      {showHeader && (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2.5 border-b border-line-soft gap-2 shrink-0">
        <div className="flex items-center space-x-2">
          <h2 className="text-sm font-semibold text-charcoal tracking-tight">本周课表</h2>
          {/* Semester Week Picker（减重：非按钮块，弱边框 + 次级文字 + 透明底） */}
          <div className="flex items-center h-7 bg-transparent border border-line-soft rounded-md px-1.5 text-[11px] font-medium text-satin-grey">
            <button
              onClick={() => setCurrentSemesterWeek(currentSemesterWeek - 1)}
              disabled={currentSemesterWeek <= 1}
              aria-label="上一周"
              className="flex items-center justify-center w-5 h-5 rounded hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-satin-grey"
            >
              <ChevronLeft className="w-3 h-3" />
            </button>
            <span className="tabular-nums px-0.5">
              第 {currentSemesterWeek} 周 · {formatWeekDateRange(semester, currentSemesterWeek)}
            </span>
            <button
              onClick={() => setCurrentSemesterWeek(currentSemesterWeek + 1)}
              disabled={currentSemesterWeek >= semester.totalWeeks}
              aria-label="下一周"
              className="flex items-center justify-center w-5 h-5 rounded hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-satin-grey"
            >
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* 右侧：Quick Glance + 查看课表（同一 group，紧贴右对齐；hover 语言统一 = alabaster 填充 + line 边框） */}
        <div className="flex items-center gap-3 shrink-0">
          {headerActions}

          <button
            onClick={handleOpenFullTimetable}
            className="group flex items-center space-x-1 h-8 text-[11px] font-semibold text-sandrift hover:text-charcoal transition-colors hover:bg-alabaster px-2.5 rounded-lg border border-line-soft hover:border-line"
          >
            <span>查看课表</span>
            <ExternalLink className="w-3.5 h-3.5 transition-transform duration-[var(--motion-fast)] group-hover:translate-x-px" />
          </button>
        </div>
      </div>
      )}

      {/* Conflict Warning Banner：折叠进退（整块条件挂载会顶开下方网格）；
          内容走 stale 快照（退场延迟期内 live 数据已空）；内层再守卫一次——JSX children
          在父 render 时 eager 求值，DisclosureRegion 返回 null 也拦不住空解引用 */}
      <DisclosureRegion open={conflicts.length > 0}>
        {shownConflicts.length > 0 && shownFirstConflict ? (
        <div className="my-2 p-2.5 bg-danger-bg border border-danger-border rounded-lg flex items-center justify-between text-xs text-danger shrink-0">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              <strong>课程时间冲突：</strong>检测到 {shownConflicts.length} 处
              （例如 {["周一","周二","周三","周四","周五","周六","周日"][shownFirstConflict.dayOfWeek - 1]} {shownFirstConflict.timeRange}）
            </span>
          </div>
          <button
            onClick={() => {
              setSelectedConflict(shownFirstConflict);
              setConflictModalOpen(true);
            }}
            className="px-2.5 py-1 bg-danger text-white rounded-lg font-bold text-[11px] hover:bg-danger/85 transition-colors shrink-0"
          >
            查看冲突
          </button>
        </div>
        ) : null}
      </DisclosureRegion>

      {/* Grid Container：周切换时仅此区域（表头 + 课程网格）做方向淡入 */}
      <div
        key={currentSemesterWeek}
        className={cn(
          "mt-2 flex-1 flex flex-col min-h-0 select-none overflow-x-auto",
          weekDir !== 0 && (weekMotionNonce % 2 === 0 ? "ux-week-enter-a" : "ux-week-enter-b")
        )}
        style={
          weekDir !== 0
            ? ({ "--motion-shift-y": weekDir === 1 ? "6px" : "-6px" } as React.CSSProperties)
            : undefined
        }
      >
        {/* 内容最小宽度：窄容器内课表整体横向滚动，避免把课程信息压到不可读；
            560 允许 1024 桌面总览 7 天全部可见（卡片走 compactCards 降级）；
            <1024 的 web/tablet 保持 640，横向滚动时列宽仍有 ~91px。 */}
        <div className="min-w-[640px] lg:min-w-[560px] flex flex-col flex-1 min-h-0">
        {/* Weekday Header Row（列数随 showWeekends 5/7 天动态；Timeline 由外层提供，避免重复） */}
        {showWeekdayHeader && (
        <div
          className="grid border-b border-line pb-2 text-center text-xs shrink-0"
          style={{ gridTemplateColumns: `${TIMETABLE_GUTTER_PX}px repeat(${dayCount}, minmax(0, 1fr))` }}
        >
          <div className="sticky left-0 z-[9] bg-surface text-sandrift font-medium py-0.5 text-[11px]">时间</div>
          {weekdays.map((wd) => (
            <div
              key={wd.dayOfWeek}
              className={cn(
                "py-0.5 rounded-lg font-medium",
                wd.dateStr === format(new Date(), "M/d") ? "text-charcoal font-bold" : "text-satin-grey"
              )}
            >
              <span>{wd.label}</span>
              <span className="text-[10px] text-sandrift ml-1">
                {wd.dateStr}
              </span>
            </div>
          ))}
        </div>
        )}

        {/* Timetable Body Grid (08:00 to 21:00 Evening Range) */}
        <div
          className={cn(
            "relative flex-1 grid mt-1",
            // Timeline embedded：高度由外层分配；
            // Overview Hero：md+ 由外层 flex 撑满首屏，mobile 保留 520px 可读高度
            // （fillAvailableHeight 曾让 390px 下课表塌成 ~300px，08:00–21:00 不可读）。
            variant === "embedded"
              ? "min-h-0"
              : fillAvailableHeight
                ? "min-h-0 max-md:min-h-[520px]"
                : "min-h-[520px]",
            // Overview compact：md+ 压缩时间轴（每小时 ~33-35px），完整保留 08:00-21:00
            isCompactDensity && !fillAvailableHeight && "md:min-h-[440px]"
          )}
          style={{ gridTemplateColumns: `${TIMETABLE_GUTTER_PX}px repeat(${dayCount}, minmax(0, 1fr))` }}
        >
          {/* Time Labels Column */}
          <div className="sticky left-0 z-[9] bg-surface flex flex-col justify-between text-[10px] text-satin-grey font-mono border-r border-line-soft pr-1.5 py-0.5 h-full">
            {TIME_SLOTS.map((time, idx) => (
              <div
                key={time}
                className={cn(
                  "flex items-center leading-none",
                  idx === 0 ? "pt-0.5" : ""
                )}
              >
                {time}
              </div>
            ))}
          </div>

          {/* Day Columns（列数随 showWeekends 5/7 天动态） */}
          <div
            ref={gridBodyRef}
            data-testid="timetable-body"
            className="relative grid border-l border-line-soft h-full"
            style={{
              gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))`,
              gridColumn: `span ${dayCount} / span ${dayCount}`,
            }}
          >
            {/* Horizontal Grid lines（小时线：比 line-soft 强一档，可快速判断小时区间） */}
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none h-full">
              {Array.from({ length: 13 }).map((_, i) => (
                <div
                  key={i}
                  className="flex-1 border-b border-line w-full"
                />
              ))}
            </div>

            {/* Render Overflow-proof Course Cards */}
            {weekdays.map((wd) => {
              const daySchedules = activeSchedules.filter(
                (s) => s.dayOfWeek === wd.dayOfWeek
              );

              // Hotfix：Now Indicator 位置（actual time ≠ visual position；21:00 后固定底部安全位）
              const nowIndicator =
                isRealCurrentWeek && wd.dateStr === format(new Date(), "M/d") && !nowCourseSchedule
                  ? getNowIndicatorPosition({ nowMinutes, dayStartMinutes, totalMinutes })
                  : null;

              return (
                <div
                  key={wd.dayOfWeek}
                  data-timetable-day={wd.dayOfWeek}
                  className={cn(
                    "relative border-r border-line-soft h-full",
                    // 今天列轻量 tint（极弱，仅快速定位「今天」）
                    wd.dateStr === format(new Date(), "M/d") && "bg-pastel-mint/[0.06]"
                  )}
                >
                  {/* Now Indicator：仅真实当前周 + 今天列；当前无进行中课程时才显示。
                      时间胶囊水平居中压在线上（胶囊底色遮挡线中央），无右端圆点；
                      位置随真实时间平滑移动；横线 z 低于课程卡（被自然遮挡），胶囊 z 高于课程卡。
                      21:00 后视觉位置固定，胶囊文字仍用真实 nowMinutes 持续更新 */}
                  {nowIndicator && (
                    <div
                      aria-hidden="true"
                      data-now-position={nowIndicator.position}
                      className="absolute inset-x-0 z-[6] pointer-events-none"
                      style={{
                        top: nowIndicator.top,
                        transition: reducedMotion ? "none" : "top 30s linear",
                      }}
                    >
                      <div className="relative flex items-center -translate-y-1/2 h-[1.5px]">
                        <span className="flex-1 h-[1.5px] bg-sandrift/60" />
                        <span className="shrink-0 z-[7] h-[21px] px-2.5 rounded-full border bg-background border-line-strong/70 text-[11px] font-semibold tabular-nums text-charcoal flex items-center shadow-subtle">
                          {minutesToClock(nowMinutes)}
                        </span>
                        <span className="flex-1 h-[1.5px] bg-sandrift/60" />
                      </div>
                    </div>
                  )}
                  {extraLayers?.({
                    dayOfWeek: wd.dayOfWeek,
                    dayStartMinutes,
                    totalMinutes,
                    timeToMinutes: timeToMinutesSafe,
                  })}
                  {daySchedules.map((sched) => {
                    const course = courses.find((c) => c.id === sched.courseId);
                    if (!course) return null;

                    const hasConflict = conflicts.some(
                      (c) => c.scheduleA.id === sched.id || c.scheduleB.id === sched.id
                    );

                    const startM = timeToMinutesSafe(sched.startTime);
                    const endM = timeToMinutesSafe(sched.endTime);
                    const topPct =
                      ((startM - dayStartMinutes) / totalMinutes) * 100;
                    const heightPct =
                      ((endM - startM) / totalMinutes) * 100;
                    // 窄列：只保留课程名；Overview（density=compact）列宽仅 81–97px，
                    // 再塞 teacher/location 会碎成「王 教…」这类不可读片段，统一降为 sr-only + 卡片 title。
                    const hideMeta = compactCards && (isCompactDensity || heightPct < 9);
                    const cardTitle = [
                      course.name,
                      course.teacher,
                      sched.location,
                      sched.source === "extra" ? "补课" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ");

                    const isOrigin = interaction.type !== "idle" && interaction.scheduleId === sched.id;

                    return (
                      <div
                        key={sched.id}
                        // Geometry Wrapper：只负责定位（top/height/left/right）+ hover 位移。
                        // top/height 不进过渡：拖拽/缩放按指针逐帧写定位，过渡会让卡片永远慢 3 帧；
                        // 周切换等结构变化走容器 ux-week-enter，无需此处补间。
                        className={cn(
                          "absolute left-0.5 right-0.5 z-[5]",
                          "transition-[transform,box-shadow] duration-[var(--motion-base)] ease-[var(--ease-standard)]",
                          "hover:shadow-card hover:-translate-y-px"
                        )}
                        style={{
                          top: `${topPct}%`,
                          height: `${Math.max(heightPct - 0.3, 7.5)}%`,
                        }}
                      >
                        <div
                          data-testid="schedule-card"
                          data-compact={compactCards || undefined}
                          title={compactCards ? cardTitle : undefined}
                          onClick={() => {
                            // 拖动结束后浏览器仍会在 capture 目标上派发 click，需吞掉
                            if (wasDraggedRef.current) {
                              wasDraggedRef.current = false;
                              return;
                            }
                            // 课程卡始终打开 Course Drawer；冲突有独立入口（卡片角标 + 顶部横幅）
                            setSelectedCourseId(course.id);
                          }}
                          onPointerDown={(e) => handleCardPointerDown(e, sched)}
                          onPointerMove={(e) => handleCardPointerMove(e, sched)}
                          onPointerUp={(e) => handleCardPointerUp(e, sched)}
                          onPointerCancel={cancelInteraction}
                          className={cn(
                            "absolute inset-0 rounded-xl shadow-subtle border flex flex-col overflow-hidden group select-none",
                            compactCards ? "justify-center" : "justify-between",
                            // 只过渡实际会变化的属性（透明度/阴影/边框），避免无关属性建立 transition
                            "transition-[opacity,box-shadow,border-color,background-color] duration-[var(--motion-base)] ease-[var(--ease-standard)]",
                            // 紧凑卡：更小的卡内边距，把宽度让给课程名
                            compactCards ? "p-1" : isCompactDensity ? "p-1.5" : "p-1.5 sm:p-2",
                            hasConflict && "ring-2 ring-danger bg-danger-bg border-danger-border",
                            // 当前正在上课：克制外框高亮（优先于 hover/其他，但让位于冲突提示）
                            !hasConflict && nowCourseSchedule?.id === sched.id && "kiro-now-course ring-2",
                            editingEnabled && "cursor-grab active:cursor-grabbing",
                            // 拖动中：原卡轻微降存在感（0.5 左右），保持原位置，不 scale/rotate/blur
                            isOrigin && "opacity-50",
                            settleId === sched.id && "ux-settle"
                          )}
                          style={{
                            backgroundColor: hasConflict ? "var(--danger-bg)" : course.bgHex,
                            borderColor: hasConflict ? "var(--danger-border)" : course.borderHex,
                            color: hasConflict ? "var(--danger)" : course.textHex,
                            touchAction: editingEnabled ? "none" : "auto",
                          }}
                        >
                        {/* Top Section */}
                        <div className="space-y-0.5 min-w-0">
                          {/* 1. Course Title
                              课表卡是信息密集的软件特性：课程名/教师/地点保留原生 title，
                              用于 hover 查看被 truncate 的完整文本（产品例外，见 nativeTitleContract）。 */}
                          <div className="flex items-start justify-between">
                            <h4
                              title={course.name}
                              className={cn(
                                "font-extrabold tracking-tight leading-tight text-charcoal min-w-0 flex-1",
                                compactCards
                                  ? "text-[10.5px] leading-[1.25] line-clamp-2"
                                  : "text-[11px] sm:text-xs truncate"
                              )}
                            >
                              {course.name}
                            </h4>
                            {hasConflict && (
                              compactCards ? (
                                <span
                                  role="img"
                                  className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-danger ml-1"
                                  aria-label="课程时间冲突"
                                  title="课程时间冲突"
                                />
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const foundConf = conflicts.find(
                                      (c) => c.scheduleA.id === sched.id || c.scheduleB.id === sched.id
                                    );
                                    if (foundConf) {
                                      setSelectedConflict(foundConf);
                                      setConflictModalOpen(true);
                                    }
                                  }}
                                  onPointerDown={(e) => e.stopPropagation()}
                                  className="text-[10px] bg-danger text-white px-1.5 py-0.5 rounded font-bold shrink-0 ml-1 hover:bg-danger/85 transition-colors"
                                >
                                  冲突
                                </button>
                              )
                            )}
                          </div>

                          {/* 2. Teacher / Location Info
                              compact：只保留教师一行（1024/1280 时间表列宽 117–131px，
                              合并 teacher · location 会把两者都压成 1–2 字 + 省略号）；
                              地点进卡片 title / sr-only。非 compact 保持 teacher + location 两行。 */}
                          {compactCards ? (
                            <div
                              className={cn(
                                "items-center gap-1 text-[9px] sm:text-[10px] opacity-85 font-medium leading-none min-w-0",
                                hideMeta ? "sr-only" : "flex"
                              )}
                            >
                              {sched.source === "extra" && (
                                <span className="shrink-0 font-extrabold opacity-80" aria-hidden="true">+</span>
                              )}
                              <User className="w-2.5 h-2.5 shrink-0 opacity-70" />
                              <span title={course.teacher} className="truncate min-w-0">{course.teacher}</span>
                              {sched.location && <span className="sr-only">，地点 {sched.location}</span>}
                            </div>
                          ) : (
                            <div className="flex items-center text-[10px] sm:text-[11px] opacity-85 space-x-1 font-medium leading-none">
                              <User className="w-2.5 h-2.5 shrink-0 opacity-70" />
                              <span title={course.teacher} className="truncate min-w-0">{course.teacher}</span>
                            </div>
                          )}
                        </div>

                        {/* Bottom Row: Extra Marker + Location Badge（compact 不渲染地点行，地点进卡片 title / sr-only） */}
                        {!compactCards && (
                        <div className="flex items-center text-[10px] sm:text-[11px] opacity-90 pt-0.5 border-t border-black/5 font-medium leading-none mt-0.5">
                          {sched.source === "extra" && (
                            <span
                              className="text-[11px] font-extrabold leading-none shrink-0 opacity-80 mr-1"
                            >
                              <span aria-hidden="true">+</span>
                              <span className="sr-only">补课</span>
                            </span>
                          )}
                          <MapPin className="w-2.5 h-2.5 mr-1 shrink-0 opacity-75" />
                          <span title={sched.location} className="truncate min-w-0">{sched.location}</span>
                        </div>
                        )}

                        {/* Resize Handle：仅工作区显示（moved/extra 一次性 occurrence 不显示），hover/focus/拖拽中才明显 */}
                        {editingEnabled && (!(sched as { source?: string }).source || (sched as { source?: string }).source === "base") && (
                          <button
                            data-testid="resize-handle"
                            aria-label="调整课程结束时间"
                            onPointerDown={(e) => handleResizePointerDown(e, sched)}
                            onPointerMove={(e) => handleResizePointerMove(e, sched)}
                            onPointerUp={(e) => handleResizePointerUp(e, sched)}
                            onPointerCancel={cancelInteraction}
                            onClick={(e) => e.stopPropagation()}
                            className={cn(
                              "absolute bottom-0.5 left-1/2 -translate-x-1/2 w-8 h-3.5 flex items-center justify-center rounded-md",
                              "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
                              "transition-opacity duration-[var(--motion-fast)]",
                              interaction.type === "resize" &&
                                interaction.scheduleId === sched.id &&
                                "opacity-100"
                            )}
                            style={{ touchAction: "none" }}
                          >
                            <span
                              className={cn(
                                "w-5 h-1 rounded-full transition-colors duration-[var(--motion-fast)]",
                                interaction.type === "resize" &&
                                  interaction.scheduleId === sched.id
                                  ? "bg-charcoal/60"
                                  : "bg-charcoal/30 group-hover:bg-charcoal/50"
                              )}
                            />
                          </button>
                        )}

                        {/* Course Overlay（Task Marker 等）：在 overflow-hidden Card 之外，几何跟随课程卡 */}
                        {courseIndicators?.({
                          schedule: sched,
                          course,
                          dayOfWeek: wd.dayOfWeek,
                          hasConflict,
                          dayStartMinutes,
                          totalMinutes,
                        })}
                        </div>
                      </div>
                    );
                  })}

                  {/* Drag / Resize Ghost + 目标时间提示；
                      Reduced Motion：不渲染跟随 ghost（原位半透明即可），只留时间文案 */}
                  {interaction.type !== "idle" &&
                    !reducedMotion &&
                    interaction.candidate.dayOfWeek === wd.dayOfWeek && (
                      <>
                        {(() => {
                          const c = interaction.candidate;
                          const cStartM = timeToMinutesSafe(c.startTime);
                          const cEndM = timeToMinutesSafe(c.endTime);
                          const ghostTopPct =
                            ((cStartM - dayStartMinutes) / totalMinutes) * 100;
                          const ghostHeightPct =
                            ((cEndM - cStartM) / totalMinutes) * 100;
                          const invalid = !interaction.valid;
                          return (
                            <div
                              aria-hidden="true"
                              className={cn(
                                "absolute left-0.5 right-0.5 rounded-xl p-1.5 border-2 border-dashed pointer-events-none flex flex-col justify-between overflow-hidden z-10",
                                // 跟手 Ghost：top/height 逐帧更新必须 1:1，只过渡颜色/透明度
                                "transition-[background-color,border-color,opacity] duration-[var(--motion-snap)] ease-[var(--ease-standard)]",
                                invalid
                                  ? "bg-danger-bg border-danger-border"
                                  : "bg-white/85 border-line-strong"
                              )}
                              style={{
                                top: `${ghostTopPct}%`,
                                height: `${Math.max(ghostHeightPct, 2.5)}%`,
                              }}
                            >
                              <h4
                                className={cn(
                                  "font-extrabold text-[11px] tracking-tight leading-tight truncate",
                                  invalid ? "text-danger" : "text-charcoal"
                                )}
                              >
                                {courses.find((crs) => crs.id === c.courseId)?.name ?? ""}
                              </h4>
                              {invalid && (
                                <p className="text-[10px] font-bold text-danger leading-none mt-0.5 truncate">
                                  与《{conflictCourseName(interaction.conflict, c.id)}》冲突
                                </p>
                              )}
                            </div>
                          );
                        })()}

                        {/* 目标时间提示：靠近 ghost，不挡标题；无动画（Reduced Motion 下天然静态） */}
                        {(() => {
                          const c = interaction.candidate;
                          const cStartM = timeToMinutesSafe(c.startTime);
                          const ghostTopPct =
                            ((cStartM - dayStartMinutes) / totalMinutes) * 100;
                          const above = ghostTopPct >= 2.4;
                          return (
                            <div
                              aria-hidden="true"
                              className="absolute left-0.5 right-0.5 z-20 pointer-events-none flex justify-end"
                              style={{
                                top: `${above ? ghostTopPct - 2.2 : 0.6}%`,
                                transform: above ? "translateY(-100%)" : "none",
                              }}
                            >
                              <span className="px-1.5 py-0.5 rounded-md bg-charcoal text-white text-[10px] font-semibold whitespace-nowrap shadow-card">
                                {wd.label} · {c.startTime}–{c.endTime}
                              </span>
                             </div>
                           );
                         })()}
                       </>
                     )}
                </div>
              );
            })}
            {/* 本周零排课空态：网格线之上居中引导（z-10，不挡拖拽 ghost z-20）；有排课即消失 */}
            {activeSchedules.length === 0 && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-surface/70 rounded-xl ux-fade">
                <CalendarPlus className="w-8 h-8 text-sandrift" strokeWidth={1.5} />
                <p className="text-xs font-bold text-charcoal">本周暂无课程</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAddCourseModalOpen(true)}
                    className="px-3 h-7 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black transition-colors"
                  >
                    添加课程
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportScheduleModalOpen(true)}
                    className="px-3 h-7 rounded-lg text-[11px] font-bold text-satin-grey bg-alabaster border border-line hover:text-charcoal hover:border-line-strong transition-colors flex items-center gap-1"
                  >
                    <FileUp className="w-3 h-3" />
                    导入课表
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        </div>
      </div>

      {/* Bottom Breathing Space（仅 Timeline embedded）：21:00 时间轴终点与外框之间纯视觉留白。
          不参与时间几何：08:00–21:00 比例、课程 / StudyBlock 定位、拖拽计算完全不变。 */}
      {variant === "embedded" && <div aria-hidden="true" className="h-2.5 md:h-3 shrink-0" />}
    </div>
  );
}
