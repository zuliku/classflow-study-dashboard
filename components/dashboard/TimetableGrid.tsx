"use client";

import React, { useEffect, useRef, useState } from "react";
import { ExternalLink, AlertTriangle, ChevronLeft, ChevronRight, MapPin, User } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { getWeekDateRange, formatWeekDateRange } from "@/lib/semester";
import { findScheduleConflicts } from "@/lib/conflicts";
import { isScheduleActive, timeToMinutes } from "@/lib/schedule";
import { CourseSchedule, ScheduleConflict } from "@/types";
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

export function TimetableGrid({ editable = false }: { editable?: boolean }) {
  const {
    courses,
    schedules,
    semester,
    currentSemesterWeek,
    setCurrentSemesterWeek,
    setSelectedCourseId,
    setConflictModalOpen,
    setSelectedConflict,
    setActiveTab,
    setFullTimetableModalOpen,
    updateSchedule,
  } = useAppStore();
  const pushToast = useToastStore((s) => s.pushToast);

  // 周一至周日表头完全由 semester.startDate + currentSemesterWeek 推导
  const weekDays = getWeekDateRange(semester, currentSemesterWeek);

  const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((label, idx) => {
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

  // Filter schedules active in currentSemesterWeek using unified isScheduleActive logic
  const activeSchedules = schedules.filter((s) => isScheduleActive(s, currentSemesterWeek));

  // 统一冲突定义（与导入器一致）：星期相同 + 时间重叠 + 至少一个共同生效教学周
  const conflicts = findScheduleConflicts(activeSchedules);
  const firstConflict = conflicts[0];

  // 周次切换方向：上一周 -6px 进入，下一周 +6px 进入（仅内容区，卡片本体不动）
  const prevWeekRef = useRef(currentSemesterWeek);
  const [weekDir, setWeekDir] = useState(0);
  useEffect(() => {
    if (prevWeekRef.current !== currentSemesterWeek) {
      setWeekDir(currentSemesterWeek > prevWeekRef.current ? 1 : -1);
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
  const editingEnabled = editable && mediaState.wide && mediaState.fine;

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
  const pendingRef = useRef<{
    origin: CourseSchedule;
    startX: number;
    startY: number;
  } | null>(null);
  const dragOffsetRef = useRef(0);
  const wasDraggedRef = useRef(false);

  const cancelInteraction = () => {
    pendingRef.current = null;
    wasDraggedRef.current = false;
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
    return pointerToDayIndex(clientX, rect.left, rect.width);
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
    pendingRef.current = { origin: sched, startX: e.clientX, startY: e.clientY };
    dragOffsetRef.current = getPointerMinutes(e.clientY) - timeToMinutesSafe(sched.startTime);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* 已释放的 capture 忽略 */
    }
  };

  const handleCardPointerMove = (e: React.PointerEvent, sched: CourseSchedule) => {
    const current = interactionRef.current;
    const pending = pendingRef.current;
    if (pending && current.type === "idle") {
      const dist = Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY);
      if (dist >= DRAG_THRESHOLD_PX) engageMove(pending.origin, e.clientX, e.clientY);
      return;
    }
    if (current.type === "move" && current.scheduleId === sched.id) {
      const pointerMin = getPointerMinutes(e.clientY);
      const candidate = calculateDraggedSchedule(
        current.origin,
        pointerMin,
        dragOffsetRef.current,
        getDayIndex(e.clientX) + 1
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
    const current = interactionRef.current;
    if (current.type !== "resize" || current.scheduleId !== sched.id) return;
    const candidate = calculateResizedSchedule(current.origin, getPointerMinutes(e.clientY));
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
      // 有效：立即写 Store，并给出可撤销 Toast（恢复 origin，同一 id，全部字段）
      updateSchedule(it.candidate);
      // 落位 settle：只给刚提交的卡片一个极轻的 opacity 归位
      setSettleId(it.candidate.id);
      if (settleTimerRef.current) window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = window.setTimeout(() => setSettleId(null), 260);
      pushToast({
        message: "课程时间已调整",
        actionLabel: "撤销",
        onAction: () => updateSchedule(it.origin),
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
    <div className="bg-surface border border-line rounded-2xl p-4 shadow-subtle flex flex-col justify-between h-full w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2.5 border-b border-[#F0EBE1] gap-2 shrink-0">
        <div className="flex items-center space-x-2">
          <h2 className="text-sm font-bold text-charcoal">本周课表</h2>
          {/* Semester Week Picker */}
          <div className="flex items-center space-x-1 bg-alabaster border border-line-strong rounded-lg px-2 py-0.5 text-xs font-semibold text-charcoal">
            <button
              onClick={() => setCurrentSemesterWeek(currentSemesterWeek - 1)}
              disabled={currentSemesterWeek <= 1}
              title="上一周"
              aria-label="上一周"
              className="hover:text-black transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-charcoal"
            >
              <ChevronLeft className="w-3 h-3" />
            </button>
            <span>
              第 {currentSemesterWeek} 周 · {formatWeekDateRange(semester, currentSemesterWeek)}
            </span>
            <button
              onClick={() => setCurrentSemesterWeek(currentSemesterWeek + 1)}
              disabled={currentSemesterWeek >= semester.totalWeeks}
              title="下一周"
              aria-label="下一周"
              className="hover:text-black transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-charcoal"
            >
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        <button
          onClick={handleOpenFullTimetable}
          className="group flex items-center space-x-1 text-xs text-sandrift hover:text-charcoal transition-colors bg-[#F7F5F5] hover:bg-alabaster px-2 py-1 rounded-lg border border-line self-start sm:self-auto font-medium"
        >
          <span>查看课表</span>
          <ExternalLink className="w-3.5 h-3.5 transition-transform duration-[var(--motion-fast)] group-hover:translate-x-px" />
        </button>
      </div>

      {/* Conflict Warning Banner */}
      {conflicts.length > 0 && (
        <div className="my-2 p-2.5 bg-danger-bg border border-danger-border rounded-xl flex items-center justify-between text-xs text-danger shrink-0">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              <strong>课程时间冲突：</strong>检测到 {conflicts.length} 处
              （例如 {["周一","周二","周三","周四","周五","周六","周日"][firstConflict.dayOfWeek - 1]} {firstConflict.timeRange}）
            </span>
          </div>
          <button
            onClick={() => {
              setSelectedConflict(firstConflict);
              setConflictModalOpen(true);
            }}
            className="px-2.5 py-1 bg-danger text-white rounded-lg font-bold text-[10px] hover:bg-danger/85 transition-colors shrink-0"
          >
            查看冲突
          </button>
        </div>
      )}

      {/* Grid Container：周切换时仅此区域（表头 + 课程网格）做方向淡入 */}
      <div
        key={currentSemesterWeek}
        className={cn(
          "mt-2 flex-1 flex flex-col min-h-0 select-none overflow-x-auto",
          weekDir !== 0 && "ux-week-enter"
        )}
        style={
          weekDir !== 0
            ? ({ "--enter-y": weekDir === 1 ? "6px" : "-6px" } as React.CSSProperties)
            : undefined
        }
      >
        {/* 内容最小宽度：窄容器内课表整体横向滚动，避免把课程信息压到不可读 */}
        <div className="min-w-[640px] flex flex-col flex-1 min-h-0">
        {/* Weekday Header Row */}
        <div className="grid grid-cols-8 border-b border-line pb-2 text-center text-xs shrink-0">
          <div className="text-sandrift font-medium py-0.5 text-[11px]">时间</div>
          {weekdays.map((wd) => (
            <div
              key={wd.dayOfWeek}
              className="py-0.5 rounded-lg text-satin-grey font-medium"
            >
              <span>{wd.label}</span>
              <span className="text-[10px] text-sandrift ml-1">
                {wd.dateStr}
              </span>
            </div>
          ))}
        </div>

        {/* Timetable Body Grid (08:00 to 21:00 Evening Range) */}
        <div className="relative flex-1 grid grid-cols-8 mt-1 min-h-[520px]">
          {/* Time Labels Column */}
          <div className="flex flex-col justify-between text-[10px] text-sandrift font-mono border-r border-[#F0EBE1] pr-1.5 py-0.5 h-full">
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

          {/* 7 Columns for Days */}
          <div
            ref={gridBodyRef}
            data-testid="timetable-body"
            className="col-span-7 grid grid-cols-7 relative border-l border-[#F0EBE1] h-full"
          >
            {/* Horizontal Grid lines */}
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none h-full">
              {Array.from({ length: 13 }).map((_, i) => (
                <div
                  key={i}
                  className="flex-1 border-b border-line-soft w-full"
                />
              ))}
            </div>

            {/* Render Overflow-proof Course Cards */}
            {weekdays.map((wd) => {
              const daySchedules = activeSchedules.filter(
                (s) => s.dayOfWeek === wd.dayOfWeek
              );

              return (
                <div
                  key={wd.dayOfWeek}
                  className="relative border-r border-line-soft h-full"
                >
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

                    const isOrigin = interaction.type !== "idle" && interaction.scheduleId === sched.id;

                    return (
                      <div
                        key={sched.id}
                        data-testid="schedule-card"
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
                        title={editingEnabled ? "拖动调整上课时间" : undefined}
                        className={cn(
                          "absolute left-0.5 right-0.5 rounded-xl p-1.5 sm:p-2 shadow-subtle hover:shadow-card hover:-translate-y-px border flex flex-col justify-between overflow-hidden group select-none",
                          // 只过渡实际会变化的属性（位置/尺寸/透明度/阴影/边框），避免无关属性建立 transition
                          "transition-[top,height,opacity,transform,box-shadow,border-color,background-color] duration-[var(--motion-base)] ease-[var(--ease-standard)]",
                          hasConflict && "ring-2 ring-danger bg-danger-bg border-danger-border",
                          editingEnabled && "cursor-grab active:cursor-grabbing",
                          // 拖动中：原卡轻微降存在感（0.5 左右），保持原位置，不 scale/rotate/blur
                          isOrigin && "opacity-50",
                          settleId === sched.id && "ux-settle"
                        )}
                        style={{
                          top: `${topPct}%`,
                          height: `${Math.max(heightPct - 0.3, 7.5)}%`,
                          backgroundColor: hasConflict ? "#F2E8E6" : course.bgHex,
                          borderColor: hasConflict ? "#D9BCB8" : course.borderHex,
                          color: hasConflict ? "#9B5B57" : course.textHex,
                          touchAction: editingEnabled ? "none" : "auto",
                        }}
                      >
                        {/* Top Section */}
                        <div className="space-y-0.5 min-w-0">
                          {/* 1. Course Title */}
                          <div className="flex items-start justify-between">
                            <h4 className="font-extrabold text-[11px] sm:text-xs tracking-tight leading-tight text-charcoal truncate">
                              {course.name}
                            </h4>
                            {hasConflict && (
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
                                className="text-[8px] bg-danger text-white px-1 py-0.2 rounded font-bold shrink-0 ml-1 hover:bg-danger/85 transition-colors"
                                title="查看冲突"
                              >
                                冲突
                              </button>
                            )}
                          </div>

                          {/* 2. Teacher Info */}
                          <div className="flex items-center text-[9.5px] sm:text-[10px] opacity-85 space-x-1 font-medium leading-none">
                            <User className="w-2.5 h-2.5 shrink-0 opacity-70" />
                            <span className="truncate">{course.teacher}</span>
                          </div>
                        </div>

                        {/* Bottom Row: Location Badge */}
                        <div className="flex items-center text-[9.5px] sm:text-[10px] opacity-90 pt-0.5 border-t border-black/5 font-medium leading-none mt-0.5">
                          <MapPin className="w-2.5 h-2.5 mr-1 shrink-0 opacity-75" />
                          <span className="truncate">{sched.location}</span>
                        </div>

                        {/* Resize Handle：仅工作区显示，hover/focus/拖拽中才明显 */}
                        {editingEnabled && (
                          <button
                            data-testid="resize-handle"
                            aria-label="调整课程结束时间"
                            title="拖动调整结束时间"
                            onPointerDown={(e) => handleResizePointerDown(e, sched)}
                            onPointerMove={(e) => handleResizePointerMove(e, sched)}
                            onPointerUp={(e) => handleResizePointerUp(e, sched)}
                            onPointerCancel={cancelInteraction}
                            onClick={(e) => e.stopPropagation()}
                            className={cn(
                              "absolute bottom-0.5 left-1/2 -translate-x-1/2 w-8 h-3.5 flex items-center justify-center rounded-md",
                              "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
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
                      </div>
                    );
                  })}

                  {/* Drag / Resize Ghost + 目标时间提示 */}
                  {interaction.type !== "idle" &&
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
                                // 15min 吸附 settle + valid/conflict 颜色过渡：短、可中断（100ms），跟手优先
                                "transition-[top,height,background-color,border-color,opacity] duration-[var(--motion-snap)] ease-[var(--ease-standard)]",
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
                                <p className="text-[9px] font-bold text-danger leading-none mt-0.5 truncate">
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
                              <span className="px-1.5 py-0.5 rounded-md bg-charcoal text-white text-[9px] font-semibold whitespace-nowrap shadow-card">
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
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
