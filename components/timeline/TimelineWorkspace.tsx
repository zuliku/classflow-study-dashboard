"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  MoreHorizontal,
  FileUp,
  ExternalLink,
  Settings as SettingsIcon,
  GraduationCap,
  ListChecks,
  CalendarClock,
  BookOpenCheck,
  Pause,
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
import { Popover } from "@/components/ui/Popover";
import {
  TimelineWorkspaceViewBar,
  TimelineFilterOption,
} from "@/components/timeline/TimelineWorkspaceViewBar";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { UISelect } from "@/components/ui/Select";
import {
  DropdownMenuPanel,
  DropdownMenuItem,
  DropdownMenuDivider,
} from "@/components/ui/DropdownMenu";
import { TimetableGrid } from "@/components/dashboard/TimetableGrid";
import { TimelineKeyLane } from "@/components/timeline/TimelineKeyLane";
import { FloatingTimelineDetail } from "@/components/timeline/FloatingTimelineDetail";
import { TimelineActiveFocusChip } from "@/components/timeline/TimelineActiveFocusChip";
import { TimelineUnscheduledShelf } from "@/components/timeline/TimelineUnscheduledShelf";
import { getWeekDateRange, formatWeekDateRange } from "@/lib/semester";
import { deriveTimelineItems, deriveUnscheduledAssignments } from "@/lib/timeline/deriveTimelineItems";
import { pointerToMinutes } from "@/lib/timetableInteraction";
import {
  calculateMovedStudyBlock,
  isSameStudyBlockPosition,
  createQuickStudyBlockCandidate,
} from "@/lib/timeline/studyBlockInteraction";
import { timeToMinutes } from "@/lib/timeline/timelineGeometry";
import { resolveFocusStudyBlockAnchor } from "@/lib/timeline/focusStudyBlockAnchor";
import { isAssignmentPlanningEligible } from "@/lib/tasks/taskSemantics";
import {
  isStudyBlockPlanningActive,
} from "@/lib/planning/studyBlockLifecycle";
import { findCourseOverlapsForStudyBlock, isCourseOverlapApproved } from "@/lib/planning/courseOverlapPolicy";
import {
  analyzeStudyBlockPlacement,
  CourseOverlap,
  courseOverlapSuffix,
} from "@/lib/timeline/studyBlockPlacement";
import { resolveCourseOccurrencesForWeek } from "@/lib/scheduleOccurrences";
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
    setSelectedAssignmentId,
    updateStudyBlock,
    addCalendarMark,
    scheduleOccurrenceOverrides,
    focusSessions,
  } = useAppStore();
  const pushToast = useToastStore((s) => s.pushToast);
  const handoff = useKiroHandoff();
  // Ghost Preview（Kiro Planning Proposal；ephemeral，不写 Store / localStorage）
  const { planningPreview } = useKiroSession();
  // Rebalance Ghost Preview（Part 5）：原位置弱化 + 目标 ghost
  const { studyRebalancePreview } = useKiroSession();

  const [filters, setFilters] = useState<TimelineFilters>(DEFAULT_FILTERS);
  const [quickOpen, setQuickOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [arrangeFor, setArrangeFor] = useState<Assignment | null>(null);
  const [freeBlockOpen, setFreeBlockOpen] = useState(false);
  const [markOpen, setMarkOpen] = useState(false);

  // ---- Workflow UX V8：消费 Assignment → Timeline Arrange Deep Link（consume once）----
  // pending 是跨 Workspace 的一次性 intent：Assignment Drawer 先写目标 id 再切 tab，
  // 本组件 mount 后在此消费 → setArrangeFor(target) 打开现有 ArrangeSheet。
  // - target stale / 不存在：clear pending，不打开
  // - ArrangeSheet 已打开（arrangeFor/freeBlock）：先 semantic close 当前 session，
  //   pending 保持不消费；open=false 渲染后下一轮 effect 再 fresh-open target，
  //   保留 false→true 沿的 Fresh-open session reset（不发生 open→open payload morph）
  // - 消费时同步关闭临时 Popover / Sheet，避免叠层
  const pendingArrangeId = useAppStore((s) => s.pendingTimelineArrangeAssignmentId);
  const setPendingTimelineArrangeAssignmentId = useAppStore(
    (s) => s.setPendingTimelineArrangeAssignmentId
  );
  // consume once：消费即 clear——后续 assignments 更新重跑 effect 时 pending 已为 null，不重复打开
  useEffect(() => {
    // 无 pending：无事可做（consume 后的每次重跑都从这里退出，sheet 保持打开）
    if (!pendingArrangeId) return;
    const target = assignments.find((a) => a.id === pendingArrangeId);
    // stale target：clear 且不打开
    if (!target) {
      setPendingTimelineArrangeAssignmentId(null);
      return;
    }
    // Workflow UX V14：planning eligibility——terminal（submitted/completed）任务
    // consume 掉 stale intent：不打开 ArrangeSheet、不无限重试、不自动重开任务
    if (!isAssignmentPlanningEligible(target)) {
      setPendingTimelineArrangeAssignmentId(null);
      return;
    }
    // ArrangeSheet 已打开：semantic close 当前 session，pending 保持；
    // open=false 渲染后本轮 effect 再次执行 → fresh-open target（保留 false→true 沿 reset）
    if (arrangeFor !== null || freeBlockOpen || markOpen || quickOpen) {
      setArrangeFor(null);
      setFreeBlockOpen(false);
      setMarkOpen(false);
      setQuickOpen(false);
      return;
    }
    // 消费 intent：打开目标 Assignment 的 ArrangeSheet 并清 pending
    setArrangeFor(target);
    setPendingTimelineArrangeAssignmentId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingArrangeId, assignments, arrangeFor, freeBlockOpen, markOpen, quickOpen]);
  // 周切换动画：用 nonce 触发 CSS animation replay（不 remount 重型 TimetableGrid 子树）。
  // DOM identity 保持 → drag / pointer capture / weekSchedules 全部稳定；仅 animation 重新生效。
  const [weekMotion, setWeekMotion] = useState<{ nonce: number; shift: "prev" | "next" } | null>(null);
  const goToWeek = useCallback(
    (target: number) => {
      const next = Math.min(Math.max(target, 1), semester.totalWeeks);
      if (next === currentSemesterWeek) return;
      const shift = next > currentSemesterWeek ? "next" : "prev";
      setWeekMotion((prev) => ({ nonce: (prev?.nonce ?? 0) + 1, shift }));
      setCurrentSemesterWeek(next);
    },
    [currentSemesterWeek, semester.totalWeeks, setCurrentSemesterWeek]
  );
  const wrapRef = useRef<HTMLDivElement | null>(null);
  // Workflow UX Motion M3：周切换动画重放改为 animation-name alternation——
  // nonce % 2 在 ux-week-enter-a/b 两个等价 animation 之间切换，浏览器因
  // animation-name 变化自然启动新动画（无 classList remove/add、无 void offsetWidth
  // 强制 reflow、无 imperative style mutation）。方向 --motion-shift-y 直接由 JSX 注入。
  // weekMotion === null（首帧 / 非交互）不附加任何 enter 类 → 初次打开不播周切换动画。

  // ---- App Chrome V2.2：Popover mutual exclusion（Filter / Quick / More 三向互斥） ----
  const openFilterOnly = () => {
    setQuickOpen(false);
    setMoreOpen(false);
    setFilterOpen(true);
  };
  const openQuickOnly = () => {
    setFilterOpen(false);
    setMoreOpen(false);
    setQuickOpen(true);
  };
  const openMoreOnly = () => {
    setFilterOpen(false);
    setQuickOpen(false);
    setMoreOpen(true);
  };
  const toggleFilter = () => (filterOpen ? setFilterOpen(false) : openFilterOnly());
  const toggleQuick = () => (quickOpen ? setQuickOpen(false) : openQuickOnly());
  const toggleMore = () => (moreOpen ? setMoreOpen(false) : openMoreOnly());

  // Filter 选项与 active 态（任一可切换项偏离默认 → trigger active dot）
  const filterOptions: TimelineFilterOption[] = [
    { key: "studyBlocks", label: "学习计划", checked: filters.studyBlocks },
    { key: "ddl", label: "DDL", checked: filters.ddl },
    { key: "exam", label: "考试", checked: filters.exam },
    { key: "activity", label: "活动", checked: filters.activity },
    { key: "group", label: "小组节点", checked: filters.group },
  ];
  const filterActive = filterOptions.some(
    (opt) => opt.checked !== DEFAULT_FILTERS[opt.key as keyof TimelineFilters]
  );

  const weekDays = useMemo(
    () => getWeekDateRange(semester, currentSemesterWeek),
    [semester, currentSemesterWeek]
  );
  const weekDates = useMemo(
    () => weekDays.map((d) => format(d, "yyyy-MM-dd")),
    [weekDays]
  );
  const dayCount = preferences.showWeekends ? 7 : 5;
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const isCurrentWeek = todayStr >= weekDates[0] && todayStr <= weekDates[6];

  // ---- IM5A：StudyBlock Move 直接拖动（Timeline Workspace + pointer:fine + preference）----
  type StudyBlockDragState =
    | { type: "idle" }
    | { type: "pending"; block: StudyBlock; startX: number; startY: number; pointerOffsetMinutes: number; pointerId: number }
    | {
        type: "dragging";
        origin: StudyBlock;
        candidate: StudyBlock | null;
        pointerOffsetMinutes: number;
        valid: boolean;
        /** soft：与课程时间重叠（可 drop，warning 视觉） */
        courseOverlaps: CourseOverlap[];
        /** hard：StudyBlock ↔ StudyBlock 冲突 */
        conflictMessage?: string;
      };
  const [studyDrag, setStudyDrag] = useState<StudyBlockDragState>({ type: "idle" });
  const studyDragRef = useRef<StudyBlockDragState>({ type: "idle" });
  // Motion M5 Drop Settle：成功落位（move / quick-create / undo）后真实 block 播放一次
  // 轻量 ux-settle。仅 TimelineWorkspace local transient（不进 Zustand / 不 persist）；
  // onAnimationEnd（animationName === "ux-settle-in"）清除，JS 不复制 motion duration。
  // rejected drop（write boundary 拒绝 / invalid placement）绝不 settle。
  const [settledStudyBlockId, setSettledStudyBlockId] = useState<string | null>(null);
  // Workflow UX V9：click vs drag suppression——跨过 5px threshold 后置 true，
  // 使拖动释放产生的 click 不打开 Assignment；下一次 pointerdown 重置为 false。
  // 只作用于 pointer 生成的 click（event.detail > 0）：键盘激活（detail=0）
  // 不经 pointer session，不得被 stale suppression 吞掉。
  const studyBlockClickSuppressedRef = useRef(false);
  const [finePointer, setFinePointer] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: fine)");
    setFinePointer(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setFinePointer(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const studyDragEnabled = preferences.enableScheduleDirectManipulation && finePointer;

  // pointer 坐标 → 候选 StudyBlock（elementFromPoint 找 data-timetable-day 列；15min snap + clamp；
  // placement 统一走 analyzeStudyBlockPlacement：课程 overlap = soft，StudyBlock 冲突 = hard）
  const evaluateStudyCandidate = (
    origin: StudyBlock,
    clientX: number,
    clientY: number,
    offset: number
  ): { candidate: StudyBlock; analysis: ReturnType<typeof analyzeStudyBlockPlacement> } | null => {
    const el = document.elementFromPoint(clientX, clientY);
    const dayCol = el?.closest?.("[data-timetable-day]") as HTMLElement | null;
    if (!dayCol) return null;
    const dow = Number(dayCol.dataset.timetableDay);
    const targetDate = weekDates[dow - 1];
    if (!targetDate) return null;
    const rect = dayCol.getBoundingClientRect();
    const pointerMinutes = pointerToMinutes(clientY, rect.top, rect.height);
    const candidate = calculateMovedStudyBlock(origin, targetDate, pointerMinutes, offset);
    const analysis = analyzeStudyBlockPlacement(candidate, {
      schedules: weekSchedules,
      studyBlocks,
      courses,
      currentSemesterWeek,
    });
    return { candidate, analysis };
  };

  // 整个 interaction session（idle→pending→dragging→drop/cancel）共享同一组 listener；
  // 依赖 studyInteractionActive（非 studyDrag.type），pending→dragging 不触发 teardown/重绑。
  const studyInteractionActive = studyDrag.type !== "idle";
  useEffect(() => {
    if (!studyInteractionActive) return;
    // capability 在交互中被关闭（preference / pointer 能力变化）→ 静默取消，不注册 listener
    if (!studyDragEnabled) {
      studyDragRef.current = { type: "idle" };
      document.body.dataset.dragActive = "0";
      setStudyDrag({ type: "idle" });
      return;
    }
    const clearDragActive = () => {
      document.body.dataset.dragActive = "0";
    };
    const toDragging = (
      result: { candidate: StudyBlock; analysis: ReturnType<typeof analyzeStudyBlockPlacement> } | null,
      origin: StudyBlock,
      offset: number
    ) => {
      // pointer 不在有效 day column → candidate=null（outside-grid 不保留旧 candidate，drop 时静默取消）
      studyDragRef.current = result
        ? {
            type: "dragging",
            origin,
            candidate: result.candidate,
            pointerOffsetMinutes: offset,
            valid: !result.analysis.hardConflict,
            courseOverlaps: result.analysis.courseOverlaps,
            conflictMessage: result.analysis.hardConflict
              ? `与学习计划《${result.analysis.hardConflict.title}》重叠`
              : undefined,
          }
        : {
            type: "dragging",
            origin,
            candidate: null,
            pointerOffsetMinutes: offset,
            valid: false,
            courseOverlaps: [],
          };
      setStudyDrag(studyDragRef.current);
    };
    const onPointerMove = (e: PointerEvent) => {
      const current = studyDragRef.current;
      if (current.type === "idle") return;
      if (current.type === "pending") {
        // 5px 阈值后才 engage
        if (Math.abs(e.clientX - current.startX) < 5 && Math.abs(e.clientY - current.startY) < 5) return;
        // Workflow UX V9：跨过阈值 = drag engagement → 吞掉随后的 pointer click（不打开 Assignment）；
        // engagement 时才 setPointerCapture：未跨阈值的轻点保留原生 button focus/click 路径
        studyBlockClickSuppressedRef.current = true;
        document.body.dataset.dragActive = "1";
        try {
          const captureEl = (e.target as Element | null)?.closest?.('[data-testid="timeline-study-block"]');
          (captureEl ?? (e.target as Element | null))?.setPointerCapture?.(current.pointerId);
        } catch {
          // pointerId 已失效（pointercancel 竞态）：window listener 仍跟踪 move，无需 capture
        }
        toDragging(
          evaluateStudyCandidate(current.block, e.clientX, e.clientY, current.pointerOffsetMinutes),
          current.block,
          current.pointerOffsetMinutes
        );
        return;
      }
      toDragging(
        evaluateStudyCandidate(current.origin, e.clientX, e.clientY, current.pointerOffsetMinutes),
        current.origin,
        current.pointerOffsetMinutes
      );
    };
    const onPointerUp = () => {
      const current = studyDragRef.current;
      studyDragRef.current = { type: "idle" };
      clearDragActive();
      if (current.type === "dragging" && current.candidate) {
        const { origin, candidate, valid, conflictMessage, courseOverlaps } = current;
        if (!valid) {
          pushToast({ type: "error", message: conflictMessage ?? "时间冲突，学习计划未调整" });
        } else if (!isSameStudyBlockPosition(origin, candidate)) {
          // Workflow UX V17：write boundary 拒绝（released / parent terminal）→ 不显示成功、不创建 Undo
          const updated = updateStudyBlock(origin.id, {
            date: candidate.date,
            startTime: candidate.startTime,
            endTime: candidate.endTime,
          });
          if (!updated) {
            pushToast({ type: "warning", message: "学习计划状态已变化，未调整时间" });
          } else {
            // Motion M5：成功落位 → 真实 block 轻 settle（rejected 不 settle）
            setSettledStudyBlockId(origin.id);
            pushToast({
              message: `学习计划时间已调整${courseOverlapSuffix(courseOverlaps)}`,
              actionLabel: "撤销",
              onAction: () => {
                // Undo race：move 成功后 parent completed → released，Store 拒绝撤销移动
                const undone = updateStudyBlock(origin.id, {
                  date: origin.date,
                  startTime: origin.startTime,
                  endTime: origin.endTime,
                });
                if (!undone) {
                  pushToast({ type: "warning", message: "学习计划状态已变化，无法撤销时间调整" });
                } else {
                  // Undo 成功同样轻 settle（不做反向飞行动画）
                  setSettledStudyBlockId(origin.id);
                }
              },
            });
          }
        }
      }
      setStudyDrag({ type: "idle" });
    };
    const onPointerCancel = () => {
      studyDragRef.current = { type: "idle" };
      clearDragActive();
      setStudyDrag({ type: "idle" });
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onPointerCancel();
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown);
      clearDragActive();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studyInteractionActive, studyDragEnabled, weekDates, schedules, studyBlocks, currentSemesterWeek, pushToast, updateStudyBlock]);

  // ---- IM5B：Unscheduled Assignment 拖入 Timeline 快速安排（1h StudyBlock）----
  type UnscheduledDragState =
    | { type: "idle" }
    | { type: "pending"; assignment: Assignment; startX: number; startY: number }
    | {
        type: "dragging";
        assignment: Assignment;
        x: number;
        y: number;
        candidate: Omit<StudyBlock, "id"> | null;
        valid: boolean;
        courseOverlaps: CourseOverlap[];
        conflictMessage?: string;
      };
  const [unscheduledDrag, setUnscheduledDrag] = useState<UnscheduledDragState>({ type: "idle" });
  const unscheduledDragRef = useRef<UnscheduledDragState>({ type: "idle" });
  // filter 一致性：用户隐藏「学习计划」时禁用 Quick Drag（避免创建当前不可见的 StudyBlock）；
  // 精确「安排」按钮仍可用（filters 不影响 ArrangeSheet）
  const unscheduledDragEnabled = studyDragEnabled && filters.studyBlocks;

  const evaluateQuickCandidate = (
    assignment: Assignment,
    clientX: number,
    clientY: number
  ): { candidate: Omit<StudyBlock, "id">; analysis: ReturnType<typeof analyzeStudyBlockPlacement> } | null => {
    const el = document.elementFromPoint(clientX, clientY);
    const dayCol = el?.closest?.("[data-timetable-day]") as HTMLElement | null;
    if (!dayCol) return null;
    const dow = Number(dayCol.dataset.timetableDay);
    const targetDate = weekDates[dow - 1];
    if (!targetDate) return null;
    const rect = dayCol.getBoundingClientRect();
    const pointerMinutes = pointerToMinutes(clientY, rect.top, rect.height);
    const candidate = createQuickStudyBlockCandidate({ assignment, date: targetDate, pointerMinutes });
    const analysis = analyzeStudyBlockPlacement(candidate, {
      schedules: weekSchedules,
      studyBlocks,
      courses,
      currentSemesterWeek,
    });
    return { candidate, analysis };
  };

  const unscheduledInteractionActive = unscheduledDrag.type !== "idle";
  useEffect(() => {
    if (!unscheduledInteractionActive) return;
    // capability / filter 在交互中被关闭 → 静默取消，不注册 listener
    if (!unscheduledDragEnabled) {
      unscheduledDragRef.current = { type: "idle" };
      document.body.dataset.dragActive = "0";
      setUnscheduledDrag({ type: "idle" });
      return;
    }
    const clearDragActive = () => {
      document.body.dataset.dragActive = "0";
    };
    const onPointerMove = (e: PointerEvent) => {
      const current = unscheduledDragRef.current;
      if (current.type === "idle") return;
      if (current.type === "pending") {
        // 5px 阈值后才 engage（同时确认 StudyBlock drag 未 active）
        if (Math.abs(e.clientX - current.startX) < 5 && Math.abs(e.clientY - current.startY) < 5) return;
        if (studyDragRef.current.type !== "idle") return;
        document.body.dataset.dragActive = "1";
        const result = evaluateQuickCandidate(current.assignment, e.clientX, e.clientY);
        unscheduledDragRef.current = {
          type: "dragging",
          assignment: current.assignment,
          x: e.clientX,
          y: e.clientY,
          candidate: result?.candidate ?? null,
          valid: result ? !result.analysis.hardConflict : false,
          courseOverlaps: result?.analysis.courseOverlaps ?? [],
          conflictMessage: result?.analysis.hardConflict
            ? `与学习计划《${result.analysis.hardConflict.title}》重叠`
            : undefined,
        };
        setUnscheduledDrag(unscheduledDragRef.current);
        return;
      }
      const result = evaluateQuickCandidate(current.assignment, e.clientX, e.clientY);
      unscheduledDragRef.current = {
        ...current,
        x: e.clientX,
        y: e.clientY,
        candidate: result?.candidate ?? null,
        valid: result ? !result.analysis.hardConflict : false,
        courseOverlaps: result?.analysis.courseOverlaps ?? [],
        conflictMessage: result?.analysis.hardConflict
          ? `与学习计划《${result.analysis.hardConflict.title}》重叠`
          : undefined,
      };
      setUnscheduledDrag(unscheduledDragRef.current);
    };
    const onPointerUp = () => {
      const current = unscheduledDragRef.current;
      unscheduledDragRef.current = { type: "idle" };
      clearDragActive();
      if (current.type === "dragging" && current.candidate) {
        if (!current.valid) {
          pushToast({ type: "error", message: current.conflictMessage ?? "与学习计划时间重叠，未安排" });
        } else {
          // Workflow UX V17：drag session 中任务可能已 terminal → Store reject（null）
          const createdId = addStudyBlock(current.candidate);
          if (!createdId) {
            pushToast({ type: "warning", message: "任务状态已变化，未创建学习计划" });
            return;
          }
          // Motion M5：成功创建 → 新 block 轻 settle（rejected 不 settle）
          setSettledStudyBlockId(createdId);
          pushToast({
            message: `已安排学习时间 · 1 小时${courseOverlapSuffix(current.courseOverlaps)}`,
            actionLabel: "撤销",
            onAction: () => {
              deleteStudyBlock(createdId);
            },
          });
        }
      }
      setUnscheduledDrag({ type: "idle" });
    };
    const onPointerCancel = () => {
      unscheduledDragRef.current = { type: "idle" };
      clearDragActive();
      setUnscheduledDrag({ type: "idle" });
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onPointerCancel();
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown);
      clearDragActive();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unscheduledInteractionActive, unscheduledDragEnabled, weekDates, schedules, studyBlocks, currentSemesterWeek, pushToast, addStudyBlock, deleteStudyBlock]);

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

  // Task 7：当前浏览周的 effective occurrences（cancel 消失 / move 目标位 / extra 出现）
  const weekSchedules = useMemo(
    () =>
      resolveCourseOccurrencesForWeek({
        schedules,
        overrides: scheduleOccurrenceOverrides,
        week: currentSemesterWeek,
        totalWeeks: semester.totalWeeks,
      }),
    [schedules, scheduleOccurrenceOverrides, currentSemesterWeek, semester.totalWeeks]
  );

  // ---- Workflow UX V10：Active Focus Awareness（无 tick 投影）----
  // 本组件只订阅 focusSessions 推导 anchor/status（事件驱动，非每秒 tick）；
  // 倒计时 1s tick 隔离在 TimelineActiveFocusChip 子组件内，
  // TimelineWorkspace 含 TimetableGrid / Drag / Ghost，严禁每秒 rerender。
  const activeFocusSession = useMemo(
    () =>
      focusSessions.find((s) => s.status === "running" || s.status === "paused") ?? null,
    [focusSessions]
  );
  // anchor 只由 session.startedAt + StudyBlock 时间窗推导（纯函数，不写 Store）
  const focusAnchorBlockId = useMemo(
    () => resolveFocusStudyBlockAnchor({ session: activeFocusSession, studyBlocks })?.id ?? null,
    [activeFocusSession, studyBlocks]
  );
  const focusStatus: "running" | "paused" | null =
    activeFocusSession?.status === "running" || activeFocusSession?.status === "paused"
      ? activeFocusSession.status
      : null;

  // ---- StudyBlock 层（Grid 内弱时间块；Course > StudyBlock：重叠时不绘制 Card）----
  const studyLayer = (ctx: {
    dayOfWeek: number;
    dayStartMinutes: number;
    totalMinutes: number;
    timeToMinutes: (t: string) => number;
  }) => {
    if (!filters.studyBlocks) return null;
    const date = weekDates[ctx.dayOfWeek - 1];
    // 只与「当前教学周真正生效」的课程比较（Task 7：effective occurrences 含一次性调课）
    const daySchedules = weekSchedules.filter((s) => s.dayOfWeek === ctx.dayOfWeek);
    const dayBlocks = studyBlocks.filter((b) => b.date === date);
    const dayStart = ctx.dayStartMinutes;
    const dayEnd = ctx.dayStartMinutes + ctx.totalMinutes;
    // Kiro Proposal Ghost：ephemeral 预览（防御性冲突检查 → 标记「计划已过期」而非压课程）
    const ghostBlocks = (planningPreview?.blocks ?? []).filter((g) => g.date === date);
    // Rebalance Ghost Preview（Part 5）：被移动的块（原位置弱化）+ 目标 ghost
    const rebalanceMoveIds = new Set((studyRebalancePreview?.moves ?? []).map((m) => m.blockId));
    const rebalanceTargets = (studyRebalancePreview?.moves ?? []).filter((m) => m.to.date === date);
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
          const isDraggingThis = studyDrag.type === "dragging" && studyDrag.origin.id === b.id;
          const isRebalanced = rebalanceMoveIds.has(b.id);
          // Workflow UX V10：execution anchor = startedAt 命中该 block 时间窗（唯一可信，
          // 同 Assignment 其它 block 不标）；running / paused 各自低侵入视觉
          const isFocusAnchor = b.id === focusAnchorBlockId;
          const focusRunning = isFocusAnchor && focusStatus === "running";
          const focusPaused = isFocusAnchor && focusStatus === "paused";
          // Workflow UX V15：released block——时间 reservation 已释放（不 drag / 不占容量），
          // 仍可查看、打开原任务、手动删除
          const isReleasedBlock = !isStudyBlockPlanningActive(b);
          // Workflow UX V9：linked = assignmentId 存在且 Assignment 真实存在（stale 防御）。
          // linked → 主区域是真实 <button>（原生键盘语义）；standalone → 普通 div，不伪造任务语义。
          const linkedAssignment = b.assignmentId
            ? assignments.find((a) => a.id === b.assignmentId)
            : undefined;
          const openTaskLabel = `打开任务《${b.title}》${
            isReleasedBlock
              ? "，该学习计划已释放"
              : focusRunning
                ? "，该任务正在专注"
                : focusPaused
                  ? "，专注已暂停"
                  : ""
          }`;
          const handleOpenLinkedAssignment = (e: React.MouseEvent<HTMLButtonElement>) => {
            // 只吞掉 pointer 生成的 click（detail > 0）；键盘激活 detail=0 不受 stale suppression 影响
            if (e.detail > 0 && studyBlockClickSuppressedRef.current) {
              studyBlockClickSuppressedRef.current = false;
              return;
            }
            setSelectedAssignmentId(linkedAssignment!.id);
          };
          // V1.1：当前仍有效的课程重叠批准 → 小型 secondary label（非醒目警告）
          const validApprovalCount = findCourseOverlapsForStudyBlock({
            block: b,
      schedules: weekSchedules,
            semester,
          }).filter((o) => isCourseOverlapApproved(b, o)).length;
          const timeHint = `${b.startTime}–${b.endTime}（${formatCompactMinutes(rawE - rawS)}）`;
          const titleText = linkedAssignment
            ? `${b.title} · ${timeHint} · 点击打开任务`
            : `${b.title} · ${timeHint}`;
          // 主区域内容（linked button / standalone div 共用排版）：focus 状态 + title + 课程重叠批准 + duration
          const focusTooltip = focusRunning
            ? `任务《${b.title}》正在专注`
            : `任务《${b.title}》专注已暂停`;
          const blockMainContent = (
            <>
              {isReleasedBlock && showMeta && (
                <span
                  className="shrink-0 text-[9px] font-bold text-sandrift"
                  title="学习计划已释放（任务已结束），不占用未来安排容量"
                >
                  已释放
                </span>
              )}
              {isFocusAnchor && !isReleasedBlock &&
                (focusRunning ? (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#2E7D5B]"
                    title={focusTooltip}
                  />
                ) : (
                  <span className="flex shrink-0 items-center" title={focusTooltip}>
                    <Pause className="h-2 w-2 text-satin-grey" aria-hidden="true" />
                  </span>
                ))}
              {isFocusAnchor && showMeta && (
                <span
                  className={cn(
                    "shrink-0 text-[9px] font-bold",
                    focusRunning ? "text-charcoal" : "text-satin-grey"
                  )}
                  title={focusTooltip}
                >
                  {focusRunning ? "专注中" : "已暂停"}
                </span>
              )}
              <span className="truncate text-[10px] font-semibold text-satin-grey">
                {b.title}
              </span>
              {validApprovalCount > 0 && (
                <span
                  className={cn(
                    "shrink-0 text-[9px] text-sandrift bg-white/70 border border-line rounded px-1 py-px",
                  )}
                  title="已确认与课程时间重叠（课程时间变化后会重新检查）"
                >
                  已确认课程重叠
                </span>
              )}
              {showMeta && (
                <span
                  className="text-[10px] text-sandrift font-medium shrink-0"
                >
                  {formatCompactMinutes(durationMinutes)}
                </span>
              )}
            </>
          );
          return (
            <div
              key={b.id}
              data-testid="timeline-study-block"
              title={titleText}
              onPointerDown={(e) => {
                // Workflow UX V9：新 pointer session 重置 suppression；
                // 不 preventDefault / 不立即 capture——保留 main button 原生 focus/click 激活路径，
                // drag engagement（跨 5px 阈值）后才 capture + 抑制 click。
                studyBlockClickSuppressedRef.current = false;
                if (!studyDragEnabled) return;
                // Workflow UX V15：released block 不进入 drag lifecycle（移动 = 重排已释放计划）
                if (isReleasedBlock) return;
                if (e.button !== 0) return;
                const dayCol = e.currentTarget.closest("[data-timetable-day]") as HTMLElement | null;
                if (!dayCol) return;
                const rect = dayCol.getBoundingClientRect();
                const pointerMinutes = pointerToMinutes(e.clientY, rect.top, rect.height);
                const startM = timeToMinutes(b.startTime) ?? pointerMinutes;
                studyDragRef.current = {
                  type: "pending",
                  block: b,
                  startX: e.clientX,
                  startY: e.clientY,
                  pointerOffsetMinutes: pointerMinutes - startM,
                  pointerId: e.pointerId,
                };
                setStudyDrag(studyDragRef.current);
              }}
              className={cn(
                "absolute left-1 right-1 rounded-lg border border-dashed border-line bg-pastel-mint/20 px-1.5 py-0.5 flex items-center gap-1 overflow-hidden group select-none",
                "transition-[opacity,border-color,background-color] duration-[var(--motion-fast)]",
                 // Workflow UX V15：released 低侵入（弱化 + 低 z，允许与 active block 同屏不遮挡）
                 isReleasedBlock && "z-[1] opacity-55 bg-transparent",
                 !isReleasedBlock && "z-[2]",
                 // Motion M5 Grab 态：source 只是 placeholder（~40%），geometry 冻结（原位置原尺寸）；
                 // 真实拖动对象由 Candidate Ghost 表达，无 scale/rotate/shadow lift
                 isDraggingThis && "opacity-40",
                 // Rebalance Preview：被移动的块弱化 + dashed outline（不改真实数据）
                 isRebalanced && "opacity-35 border-dashed border-[#A48F82]",
                 studyDragEnabled && !isDraggingThis && !isReleasedBlock && "cursor-grab",
                 isDraggingThis && "cursor-grabbing",
                 // Motion M5 Drop Settle：成功落位后一次性轻确认（复用 ux-settle；无 scale/overshoot）
                 settledStudyBlockId === b.id && "ux-settle",
                // Linked hover affordance（克制：边框/底色略增强，无 scale/glow）
                linkedAssignment &&
                  !isDraggingThis &&
                  "hover:border-line-strong hover:bg-pastel-mint/30",
                // Workflow UX V10：execution anchor 低侵入状态（不改变 geometry，无 pulse/glow）
                focusRunning && !isDraggingThis && "border-line-strong bg-pastel-mint/30",
                focusPaused && !isDraggingThis && "bg-alabaster/60"
              )}
              style={{ top: `${topPct}%`, height: `${heightPct}%`, minHeight: touchesEdge ? undefined : 6 }}
              onAnimationEnd={(e) => {
                // Settle State 清理：只认 settle keyframe（子元素动画会冒泡，按 animationName 过滤）；
                // JS 不复制 motion duration（不用 setTimeout）
                if (e.animationName === "ux-settle-in") {
                  setSettledStudyBlockId((id) => (id === b.id ? null : id));
                }
              }}
            >
              {linkedAssignment ? (
                <button
                  type="button"
                  data-testid="study-block-open-task"
                  aria-label={openTaskLabel}
                  onClick={handleOpenLinkedAssignment}
                  className="flex-1 min-w-0 h-full min-h-0 flex items-center gap-1 overflow-hidden text-left cursor-[inherit] rounded-md focus-visible:outline-2 focus-visible:outline-charcoal/40 focus-visible:outline-offset-[-2px]"
                >
                  {blockMainContent}
                </button>
              ) : (
                <div className="flex-1 min-w-0 h-full flex items-center gap-1 overflow-hidden">
                  {blockMainContent}
                </div>
              )}
              {showMeta && (
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteStudyBlock(b.id);
                    pushToast({ message: "已删除学习计划" });
                  }}
                  aria-label={`删除学习计划 ${b.title}`}
                  className="relative z-[2] ml-auto p-0.5 rounded text-sandrift hover:text-danger transition-colors shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          );
        })}

        {/* Motion M5 Target Surface：StudyBlock move 与 Unscheduled quick drag 统一同一
            day-level target（极弱背景 + 1px inset ring）。有效性语义完全由 Candidate Ghost
            承担——Day Column 自身不变绿/黄/红。 */}
        {studyDrag.type === "dragging" && studyDrag.candidate?.date === date && (
          <div
            aria-hidden="true"
            data-testid="timeline-day-target"
            className="absolute inset-0 pointer-events-none bg-alabaster/55 ring-1 ring-inset ring-charcoal/20"
          />
        )}

        {/* IM5A：拖动 Ghost（真实 candidate 几何；三态：clean mint / course overlap warm warning / hard danger；snap 过渡 top） */}
        {studyDrag.type === "dragging" && studyDrag.candidate && studyDrag.candidate.date === date && (
          <div
            data-testid="study-block-ghost"
            className={cn(
              "absolute left-1 right-1 z-[4] rounded-lg border-2 border-dashed px-1.5 py-0.5 flex items-center gap-1 overflow-hidden pointer-events-none",
              "transition-[top,background-color,border-color,opacity] duration-[var(--motion-snap)] ease-[var(--ease-standard)]",
              !studyDrag.valid
                ? "border-danger/60 bg-danger-bg/40"
                : studyDrag.courseOverlaps.length > 0
                  ? "border-stone-beige bg-[#F3EEE7]/70"
                  : "border-pastel-mint bg-pastel-mint/25"
            )}
            style={{
              top: `${(((ctx.timeToMinutes(studyDrag.candidate.startTime) ?? 0) - dayStart) / ctx.totalMinutes) * 100}%`,
              height: `${(((ctx.timeToMinutes(studyDrag.candidate.endTime) ?? 0) - (ctx.timeToMinutes(studyDrag.candidate.startTime) ?? 0)) / ctx.totalMinutes) * 100}%`,
              minHeight: 6,
            }}
          >
            <span className="truncate text-[10px] font-semibold text-satin-grey">
              {studyDrag.candidate.title}
            </span>
            <span className="text-[10px] text-sandrift font-medium shrink-0">
              {studyDrag.candidate.startTime}–{studyDrag.candidate.endTime}
            </span>
            {!studyDrag.valid ? (
              <span className="ml-auto text-[10px] font-bold text-danger shrink-0 truncate max-w-[50%]">
                {studyDrag.conflictMessage ?? "时间冲突"}
              </span>
            ) : studyDrag.courseOverlaps.length > 0 ? (
              <span className="ml-auto text-[10px] font-bold text-[#936E4C] shrink-0 truncate max-w-[50%]">
                与《{studyDrag.courseOverlaps[0].courseName}》重叠
              </span>
            ) : null}
          </div>
        )}

        {/* IM5B：Unscheduled Quick Schedule Ghost + 统一 Target Surface（candidate 几何；1h；
            三态语义在 Ghost 上，day surface 与 StudyBlock move 同一套中性高亮） */}
        {unscheduledDrag.type === "dragging" && unscheduledDrag.candidate?.date === date && (
          <>
            <div
              aria-hidden="true"
              data-testid="timeline-day-target"
              className="absolute inset-0 pointer-events-none bg-alabaster/55 ring-1 ring-inset ring-charcoal/20"
            />
            <div
              data-testid="unscheduled-ghost"
              className={cn(
                "absolute left-1 right-1 z-[4] rounded-lg border-2 border-dashed px-1.5 py-0.5 flex items-center gap-1 overflow-hidden pointer-events-none",
                "transition-[top,background-color,border-color,opacity] duration-[var(--motion-snap)] ease-[var(--ease-standard)]",
                !unscheduledDrag.valid
                  ? "border-danger/60 bg-danger-bg/40"
                  : unscheduledDrag.courseOverlaps.length > 0
                    ? "border-stone-beige bg-[#F3EEE7]/70"
                    : "border-pastel-mint bg-pastel-mint/25"
              )}
              style={{
                top: `${(((ctx.timeToMinutes(unscheduledDrag.candidate.startTime) ?? 0) - dayStart) / ctx.totalMinutes) * 100}%`,
                height: `${(((ctx.timeToMinutes(unscheduledDrag.candidate.endTime) ?? 0) - (ctx.timeToMinutes(unscheduledDrag.candidate.startTime) ?? 0)) / ctx.totalMinutes) * 100}%`,
                minHeight: 6,
              }}
            >
              <span className="truncate text-[10px] font-semibold text-satin-grey">
                {unscheduledDrag.candidate.title}
              </span>
              <span className="text-[10px] text-sandrift font-medium shrink-0">
                {unscheduledDrag.candidate.startTime}–{unscheduledDrag.candidate.endTime}
              </span>
              {!unscheduledDrag.valid ? (
                <span className="ml-auto text-[10px] font-bold text-danger shrink-0 truncate max-w-[50%]">
                  {unscheduledDrag.conflictMessage ?? "时间冲突"}
                </span>
              ) : unscheduledDrag.courseOverlaps.length > 0 ? (
                <span className="ml-auto text-[10px] font-bold text-[#936E4C] shrink-0 truncate max-w-[50%]">
                  与《{unscheduledDrag.courseOverlaps[0].courseName}》重叠
                </span>
              ) : null}
            </div>
          </>
        )}

        {/* Kiro Proposal Ghost（ephemeral；三态：clean「Kiro 建议」/ course overlap warm「与课程重叠」/ StudyBlock hard「计划冲突」） */}
        {ghostBlocks.map((g) => {
          const gs = timeToMinutes(g.startTime);
          const ge = timeToMinutes(g.endTime);
          if (gs === null || ge === null) return null;
          const vs = Math.max(gs, dayStart);
          const ve = Math.min(ge, dayEnd);
          if (ve <= vs) return null;
          const gAnalysis = analyzeStudyBlockPlacement(g, {
      schedules: weekSchedules,
            studyBlocks,
            courses,
            currentSemesterWeek,
          });
          const gHard = gAnalysis.hardConflict;
          const gOverlap = gAnalysis.courseOverlaps.length > 0;
          const gStateLabel = gHard
            ? "计划冲突"
            : gOverlap
              ? "与课程重叠"
              : "Kiro 建议";
          return (
            <div
              key={g.id}
              data-testid="timeline-ghost-block"
              title={`${g.title} · ${gStateLabel}（未保存）`}
              className={cn(
                "absolute left-1 right-1 z-[3] rounded-lg border border-dashed px-1.5 py-0.5 flex items-center gap-1 overflow-hidden pointer-events-none",
                gHard
                  ? "border-danger/50 bg-danger-bg/40"
                  : gOverlap
                    ? "border-stone-beige bg-[#F3EEE7]/70"
                    : "border-line-strong bg-pastel-mint/15"
              )}
              style={{ top: `${((vs - dayStart) / ctx.totalMinutes) * 100}%`, height: `${((ve - vs) / ctx.totalMinutes) * 100}%`, minHeight: 6 }}
            >
              <span className="truncate text-[10px] font-semibold text-satin-grey">{g.title}</span>
              <span
                className={cn(
                  "shrink-0 text-[10px] font-medium",
                  gHard ? "text-danger" : gOverlap ? "text-[#936E4C]" : "text-sandrift"
                )}
              >
                {gStateLabel}
              </span>
            </div>
          );
        })}

        {/* Rebalance Target Ghost（Part 5/6：move 目标位置；ephemeral 三态：
            无重叠 neutral「移动目标」/ 课程重叠 warm「与课程重叠」/ 最新状态已硬冲突 danger「调整建议已过期」） */}
        {rebalanceTargets.map((m) => {
          const gs = timeToMinutes(m.to.startTime);
          const ge = timeToMinutes(m.to.endTime);
          if (gs === null || ge === null) return null;
          const vs = Math.max(gs, dayStart);
          const ve = Math.min(ge, dayEnd);
          if (ve <= vs) return null;
          const tAnalysis = analyzeStudyBlockPlacement(
            { date: m.to.date, startTime: m.to.startTime, endTime: m.to.endTime },
            { schedules: weekSchedules, studyBlocks, courses, currentSemesterWeek }
          );
          const tHard = tAnalysis.hardConflict;
          const tOverlap = tAnalysis.courseOverlaps.length > 0;
          const tLabel = tHard ? "调整建议已过期" : tOverlap ? "与课程重叠" : "移动目标";
          return (
            <div
              key={`rebalance-${m.blockId}`}
              data-testid="timeline-rebalance-ghost"
              title={`${m.title} · ${tLabel}（未保存）`}
              className={cn(
                "absolute left-1 right-1 z-[3] rounded-lg border border-dashed px-1.5 py-0.5 flex items-center gap-1 overflow-hidden pointer-events-none",
                tHard
                  ? "border-danger/50 bg-danger-bg/40"
                  : tOverlap
                    ? "border-stone-beige bg-[#F3EEE7]/70"
                    : "border-line-strong bg-pastel-mint/15"
              )}
              style={{ top: `${((vs - dayStart) / ctx.totalMinutes) * 100}%`, height: `${((ve - vs) / ctx.totalMinutes) * 100}%`, minHeight: 6 }}
            >
              <span className="truncate text-[10px] font-semibold text-satin-grey">{m.title}</span>
              <span
                className={cn(
                  "shrink-0 text-[10px] font-medium",
                  tHard ? "text-danger" : tOverlap ? "text-[#936E4C]" : "text-sandrift"
                )}
              >
                {tLabel}
              </span>
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
        hasConflict={hasConflict}
        boundsRef={wrapRef}
        focusAnchorBlockId={focusAnchorBlockId}
        focusStatus={focusStatus}
      />
    );
  };

  // ---- 安排学习计划 ----
  const submitArrange = (a: Assignment | null, date: string, start: string, end: string) => {
    // Workflow UX V14：commit-time fresh revalidation（最重要的 race guard）——
    // Sheet 打开期间任务可能已被另一路径 submitted / completed / 删除；
    // terminal/missing → 不创建 StudyBlock / Reminder / History event，
    // semantic close stale Sheet + 克制 Toast（不静默降级为 standalone）
    if (a) {
      const freshAssignment = useAppStore
        .getState()
        .assignments.find((x) => x.id === a.id);
      if (!freshAssignment || !isAssignmentPlanningEligible(freshAssignment)) {
        pushToast({ type: "warning", message: "任务状态已变化，未创建学习计划" });
        setArrangeFor(null);
        return;
      }
    }
    const analysis = analyzeStudyBlockPlacement(
      { date, startTime: start, endTime: end },
      { schedules: weekSchedules, studyBlocks, courses, currentSemesterWeek }
    );
    if (analysis.hardConflict) {
      pushToast({
        type: "error",
        message: `与学习计划《${analysis.hardConflict.title}》时间重叠`,
      });
      return;
    }
    // Workflow UX V17：Store 才是最终 authority——V14 fresh 校验之外仍可能 race；
    // addStudyBlock 返回 null = write boundary 拒绝（不成功 Toast、不创建 Undo、semantic close）
    const createdArrangeId = a
      ? addStudyBlock({
          title: a.title,
          date,
          startTime: start,
          endTime: end,
          assignmentId: a.id,
          courseId: a.courseId,
          source: "manual",
        })
      : addStudyBlock({
          title: "学习计划",
          date,
          startTime: start,
          endTime: end,
          source: "manual",
        });
    if (a && createdArrangeId === null) {
      pushToast({ type: "warning", message: "任务状态已变化，未创建学习计划" });
      setArrangeFor(null);
      return;
    }
    // BUG-G1：与拖拽创建同一 settle 语法 —— 表单提交的新块同样播放 ux-settle
    if (createdArrangeId) setSettledStudyBlockId(createdArrangeId);
    pushToast({ message: `已安排学习计划：${a?.title ?? "学习计划"}${courseOverlapSuffix(analysis.courseOverlaps)}` });
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

  // ---- App Chrome V2.2：WorkspaceHeader actions（Active Focus / Ask Kiro / More）+ primaryAction（新建） ----
  // Header Action Contract：L1 状态（quiet chip）与 L2 操作组之间 12px（ml-1 补足 Header gap-2），
  // 组内保持默认 gap；不再用发丝分隔线做分组（间距即分组）。
  const headerActions = (
    <>
      {/* Workflow UX V10：Active Focus Awareness（idle 不渲染；1s tick 在子组件内；
          Header L1 状态层用 quiet 形态，不再是边框 pill 控件感） */}
      <TimelineActiveFocusChip quiet />
      <KiroFlowButton
        icon={KIRO_ICON}
        label="Ask Kiro"
        size="sm"
        className="ml-1 h-8"
        labelClassName="hidden md:inline"
        onClick={() => handoff.openForWeek(currentSemesterWeek)}
      />
      {/* More → DropdownMenu（导入课表 / 全屏 / 时间表设置） */}
      <Popover open={moreOpen} onOpenChange={setMoreOpen} className="mr-1">
        <IconButton
          variant="ghost"
          size="sm"
          onClick={toggleMore}
          aria-label="更多操作"
          aria-expanded={moreOpen}
          title="更多"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </IconButton>
        <DropdownMenuPanel open={moreOpen} placement="bottom-end" aria-label="更多操作">
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
      </Popover>
    </>
  );

  // ---- App Chrome V2.2：新建（primaryAction；菜单沿用原有 handlers，不复制 create menu） ----
  // 形态保持图标方块（确认结论）；与搜索全局入口之间 12px（mr-1 补足 Header gap-2）
  const primaryAction = (
    <>
      <Popover open={quickOpen} onOpenChange={setQuickOpen} className="mr-1">
      <IconButton
        variant="primary"
        size="sm"
        onClick={toggleQuick}
        aria-label="新建"
        aria-expanded={quickOpen}
        title="新建"
      >
          <Plus className="w-3.5 h-3.5" />
      </IconButton>
      <DropdownMenuPanel open={quickOpen} placement="bottom-end" aria-label="新建" className="w-52">
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
    </Popover>
    </>
  );

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* Sticky Chrome：单一 sticky 容器承载 WorkspaceHeader + ViewBar（无 magic offset） */}
      <div className="sticky top-0 z-20 shrink-0">
        <WorkspaceHeader
          title="时间表"
          context={`第 ${currentSemesterWeek} 周 · ${formatWeekDateRange(semester, currentSemesterWeek)}`}
          actions={headerActions}
          primaryAction={primaryAction}
        />
        <TimelineWorkspaceViewBar
          currentSemesterWeek={currentSemesterWeek}
          totalWeeks={semester.totalWeeks}
          isCurrentWeek={isCurrentWeek}
          onPrevWeek={() => goToWeek(currentSemesterWeek - 1)}
          onNextWeek={() => goToWeek(currentSemesterWeek + 1)}
          onToday={() => goToWeek(getSemesterWeekOf(new Date(), semester))}
          filterOptions={filterOptions}
          filterActive={filterActive}
          filterOpen={filterOpen}
          onFilterToggle={toggleFilter}
          onFilterClose={() => setFilterOpen(false)}
          onFilterChange={(key, value) =>
            setFilters((f) => ({ ...f, [key as keyof TimelineFilters]: value }))
          }
        />
      </div>

      {/* body：主卡 flex-1 吸收剩余空间；shelf shrink-0；section spacing 由父容器 gap-4 统一控制 */}
      <div className="workspace-gutter flex flex-1 min-h-0 flex-col gap-4 pt-4 pb-24 md:pt-6 md:pb-6">
      {/* 周内容主体：DOM 稳定（不 key remount）；Workflow UX Motion M3——
          nonce parity 切换 animation-name（a/b 等价 keyframes）自然重放，
          方向 --motion-shift-y 由 JSX 注入；weekMotion=null 不播动画 */}
      <div
        ref={wrapRef}
        data-testid="timeline-workspace"
        className={cn(
          "flex flex-1 min-h-0 flex-col bg-surface border border-line rounded-2xl shadow-subtle overflow-hidden",
          weekMotion &&
            (weekMotion.nonce % 2 === 0 ? "ux-week-enter-a" : "ux-week-enter-b")
        )}
        style={
          weekMotion
            ? ({
                "--motion-shift-y":
                  weekMotion.shift === "prev" ? "-6px" : "6px",
              } as React.CSSProperties)
            : undefined
        }
      >      {/* ---------- 主体：Weekday Header（唯一一份）+ Key Timeline + Course Grid ---------- */}
      <div className="flex-1 min-h-0 flex flex-col overflow-x-auto">
        <div className="min-w-[640px] w-full flex flex-col flex-1 min-h-0 px-3 pt-2.5">
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

      {/* ---------- 安排学习计划（assignment 安排 / 自由创建共用同一个 Dialog lifecycle owner；
          payload snapshot 由 ArrangeSheet 内部持有，exit 期间不发生内容 morph） ---------- */}
      <ArrangeSheet
        open={arrangeFor !== null || freeBlockOpen}
        assignment={arrangeFor}
        weekDates={weekDates}
        onClose={() => { setArrangeFor(null); setFreeBlockOpen(false); }}
        getPlacement={(date, start, end) =>
          analyzeStudyBlockPlacement(
            { date, startTime: start, endTime: end },
            { schedules: weekSchedules, studyBlocks, courses, currentSemesterWeek }
          )
        }
        onSubmit={(assignment, date, start, end) => {
          if (assignment) {
            submitArrange(assignment, date, start, end);
          } else {
            const analysis = analyzeStudyBlockPlacement(
              { date, startTime: start, endTime: end },
              { schedules: weekSchedules, studyBlocks, courses, currentSemesterWeek }
            );
            if (analysis.hardConflict) {
              pushToast({
                type: "error",
                message: `与学习计划《${analysis.hardConflict.title}》时间重叠`,
              });
              return;
            }
            const freeCreatedId = addStudyBlock({ title: "学习计划", date, startTime: start, endTime: end, source: "manual" });
            // BUG-G1：自由创建同样 settle（与拖拽/表单排课同一语法）
            if (freeCreatedId) setSettledStudyBlockId(freeCreatedId);
            pushToast({ message: `已添加学习计划${courseOverlapSuffix(analysis.courseOverlaps)}` });
            setFreeBlockOpen(false);
          }
        }}
      />

      {/* ---------- 考试 / 日程（常驻 lifecycle owner；fresh-open 重置表单） ---------- */}
      <MarkSheet open={markOpen} weekDates={weekDates} onClose={() => setMarkOpen(false)} onSubmit={submitMark} />
    </div>

    {/* ---------- 待安排：独立 Secondary Panel（首屏之后，不挤压时间表） ---------- */}
    <TimelineUnscheduledShelf
      assignments={unscheduled}
      onArrange={(a) => { setArrangeFor(a); setMarkOpen(false); }}
      directManipulationEnabled={unscheduledDragEnabled}
      draggingAssignmentId={
        unscheduledDrag.type === "dragging"
          ? unscheduledDrag.assignment.id
          : null
      }
      onAssignmentPointerDown={(e, a) => {
        if (!unscheduledDragEnabled) return;
        if (e.button !== 0) return;
        if (studyDragRef.current.type !== "idle") return;
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        unscheduledDragRef.current = {
          type: "pending",
          assignment: a,
          startX: e.clientX,
          startY: e.clientY,
        };
        setUnscheduledDrag(unscheduledDragRef.current);
      }}
    />

    {/* IM5B：Floating Drag Preview（fixed 跟随 pointer；初次 engage 轻 opacity；无 left/top 过渡防拖尾） */}
    {unscheduledDrag.type === "dragging" && (
      <div
        data-testid="unscheduled-drag-chip"
        aria-hidden="true"
        className="fixed z-[80] pointer-events-none bg-surface border border-line-strong rounded-xl shadow-card px-2.5 py-1.5 ux-fade"
        style={{ left: unscheduledDrag.x + 12, top: unscheduledDrag.y + 12 }}
      >
        <p className="text-[11px] font-bold text-charcoal truncate max-w-[220px]">
          {unscheduledDrag.assignment.title}
        </p>
        <p className="text-[10px] text-sandrift">快速安排 · 1 小时</p>
      </div>
    )}
    </div>
    </div>
  );
}

/**
 * Course > StudyBlock 的 Task Marker：
 * 课程卡右上角 secondary signal（永远单个 7px dot，数量交给 hover panel）。
 * Hover / Focus / Tap 通过 FloatingTimelineDetail（Portal + collision）显示详情；
 * 点击不导航（stopPropagation 防误开课程 Drawer）。hover 只允许 opacity/ring/color，无 scale。
 */

/** Hover bridge grace（交互宽限时间，非 Motion Contract）：
 *  mouse 离开 marker 与移入 floating panel 之间的 intent 宽限；属于 hover debounce 类
 *  交互计时，不迁移到 lib/motion.ts。 */
const HOVER_BRIDGE_GRACE_MS = 100;

function CourseTaskMarker({
  blocks,
  schedule,
  hasConflict,
  boundsRef,
  focusAnchorBlockId = null,
  focusStatus = null,
}: {
  blocks: StudyBlock[];
  schedule: CourseSchedule;
  hasConflict: boolean;
  boundsRef: React.RefObject<HTMLDivElement | null>;
  /** Workflow UX V10：本组 block 命中 execution anchor 的 id（无则 null） */
  focusAnchorBlockId?: string | null;
  focusStatus?: "running" | "paused" | null;
}) {
  // Workflow UX V9：linked block row → Assignment Drawer（global owner，留在 Timeline 上下文）
  const assignments = useAppStore((s) => s.assignments);
  const setSelectedAssignmentId = useAppStore((s) => s.setSelectedAssignmentId);
  const [open, setOpen] = useState(false);
  const markerRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const count = blocks.length;

  const scheduleClose = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => setOpen(false), HOVER_BRIDGE_GRACE_MS);
  };
  const cancelClose = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  // Workflow UX V10：本组重叠 block 中是否包含 execution anchor（trigger 轻 ring + aria 同步）
  const markerHasFocus =
    focusAnchorBlockId !== null && blocks.some((b) => b.id === focusAnchorBlockId);

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
          aria-label={`${count} 个学习任务与本课程时间重叠${
            markerHasFocus ? "，其中当前专注任务 1 个" : ""
          }`}
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
          className="w-[20px] h-[20px] -m-[1px] flex items-center justify-center rounded-full cursor-pointer outline-none transition-[opacity,box-shadow] duration-[var(--motion-fast)] hover:ring-2 hover:ring-inset hover:ring-[#A87952]/40"
          title="查看重叠的学习任务"
        >
          <span
            className={cn(
              "block w-[7px] h-[7px] rounded-full bg-[#A87952]",
              // Workflow UX V10：包含 anchor → 非常轻的 ring emphasis（不变大、不闪烁）
              markerHasFocus &&
                (focusStatus === "running"
                  ? "ring-2 ring-inset ring-[#2E7D5B]/30"
                  : "ring-2 ring-inset ring-satin-grey/30")
            )}
          />
        </button>
      </div>

      <FloatingTimelineDetail
        anchorRef={markerRef}
        boundsRef={boundsRef}
        open={open}
        kind="marker"
        ariaLabel="重叠的学习任务"
        onRequestClose={() => setOpen(false)}
        // Workflow UX V9：outside 判定交给 FloatingTimelineDetail（anchor + Portal panel 同一 owner）；
        // 旧实现用 markerRef 单边判定，Portal 面板永远在 marker 外 → panel 内 pointerdown 抢先 close
        closeOnOutsidePointerDown
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        <div className="px-2.5 py-2 space-y-1.5">
          <p className="text-[11px] font-bold text-charcoal">
            学习任务{count > 1 ? ` · ${count}` : ""}
          </p>
          <p className="text-[10px] font-semibold text-[#936E4C]">
            与当前课程时间重叠
          </p>
          {blocks.slice(0, 4).map((b) => {
            // Workflow UX V9：linked（assignmentId 有效且 Assignment 存在）→ 行可点击
            // 打开 Assignment Drawer；standalone → 只读 row（不伪造任务语义）。
            const linkedAssignmentId = b.assignmentId
              ? assignments.find((a) => a.id === b.assignmentId)?.id ?? null
              : null;
            // Workflow UX V10：只有 anchor row 显示专注状态（同 Assignment 其它 row 不标）
            const isAnchorRow = b.id === focusAnchorBlockId;
            // Workflow UX V15：released row 标注（anchor 排除 released，二者互斥）
            const isReleasedRow = !isStudyBlockPlanningActive(b);
            const rowInner = (
              <>
                <p className="text-[10px] font-semibold text-charcoal leading-snug">{b.title}</p>
                <p className="text-[10px] text-satin-grey">
                  {b.startTime}–{b.endTime}
                  {linkedAssignmentId ? " · 点击打开" : ""}
                  {isAnchorRow ? (focusStatus === "running" ? " · 专注中" : " · 已暂停") : ""}
                  {isReleasedRow ? " · 已释放" : ""}
                </p>
              </>
            );
            return (
              <div key={b.id} className="space-y-0.5">
                {linkedAssignmentId ? (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false); // semantic close Floating Detail
                      setSelectedAssignmentId(linkedAssignmentId);
                    }}
                    aria-label={`打开任务 ${b.title}`}
                    title={`打开任务 ${b.title}`}
                    className={cn(
                      "w-full text-left rounded-md px-1 -mx-1 py-0.5 cursor-pointer",
                      "hover:bg-alabaster transition-colors duration-[var(--motion-fast)]",
                      "focus-visible:outline-2 focus-visible:outline-charcoal/30"
                    )}
                  >
                    {rowInner}
                  </button>
                ) : (
                  <div className="px-1 -mx-1 py-0.5">{rowInner}</div>
                )}
              </div>
            );
          })}
          {blocks.length > 4 && (
            <p className="text-[10px] font-semibold text-satin-grey">还有 {blocks.length - 4} 项</p>
          )}
        </div>
      </FloatingTimelineDetail>
    </>
  );
}

function getSemesterWeekOf(date: Date, semester: { startDate: string; totalWeeks: number }): number {
  const start = new Date(`${semester.startDate}T00:00:00`);
  const diff = Math.floor((date.getTime() - start.getTime()) / 86400000);
  return Math.floor(diff / 7) + 1;
}

/**
 * 安排学习计划小表单（assignment 可选：来自 Shelf 或自由创建）。
 *
 * Presence Lifecycle（Motion V2.1）：
 * - 组件常驻，`open` 表达 semantic state；Dialog 自己控制 mounted/visible，
 *   semantic close 后仍播完 --motion-exit-base 的 exit（父级不再条件卸载）。
 * - Exit payload snapshot：open=true 时跟随 assignment；关闭后保留最后一次打开的
 *   payload 播 exit——「安排任务 A」的淡出不得闪变成自由学习计划表单。
 *   纯 UI snapshot（组件内 state），不写入 Store、不复制 domain 数据。
 * - Fresh-open session reset：在 false→true 沿重置本地草稿（保持既有
 *   「每次打开为新表单」语义）；不在 close 时 reset，否则 exit 中内容会清空。
 * - semantic close 即释放交互所有权：exit 期间面板 pointer-events-none +
 *   aria-hidden，确认/取消不可再触发。
 */
export function ArrangeSheet({
  open,
  assignment,
  weekDates,
  onClose,
  onSubmit,
  getPlacement,
}: {
  open: boolean;
  assignment: Assignment | null;
  weekDates: string[];
  onClose: () => void;
  onSubmit: (a: Assignment | null, date: string, start: string, end: string) => void;
  getPlacement?: (date: string, start: string, end: string) => ReturnType<typeof analyzeStudyBlockPlacement>;
}) {
  const today = new Date();
  const defaultDate = weekDates.includes(format(today, "yyyy-MM-dd")) ? format(today, "yyyy-MM-dd") : weekDates[0];
  const [date, setDate] = useState(defaultDate);
  const [start, setStart] = useState("19:00");
  const [end, setEnd] = useState("20:00");
  const [title, setTitle] = useState("");

  // ---- Exit payload snapshot（semantic close 后继续渲染最后一次 payload） ----
  const [snapshot, setSnapshot] = useState<Assignment | null>(null);
  useEffect(() => {
    if (open) setSnapshot(assignment);
  }, [open, assignment]);
  const shown = open ? assignment : snapshot;

  // ---- Fresh-open session reset（false→true 沿） ----
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setDate(defaultDate);
      setStart("19:00");
      setEnd("20:00");
      setTitle("");
    }
    prevOpenRef.current = open;
  }, [open, defaultDate]);

  const placement = getPlacement?.(date, start, end);
  const overlapHint = placement?.courseOverlaps[0];
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      overlayId="timeline-arrange-sheet"
      stackZ={50}
      closeOnBackdrop
      aria-label="安排学习计划"
      data-testid="timeline-arrange-sheet"
      aria-hidden={!open || undefined}
      className={cn(
        "max-w-sm p-4 space-y-3 border-line-strong rounded-2xl shadow-card",
        // exit presence 期间释放指针所有权（视觉快照只读）
        !open && "pointer-events-none"
      )}
    >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-charcoal">安排学习计划</h3>
          <IconButton variant="ghost" size="sm" onClick={onClose} disabled={!open} aria-label="关闭">
            <X className="w-4 h-4" />
          </IconButton>
        </div>
        {shown ? (
          <p className="text-[11px] font-semibold text-charcoal">{shown.title}</p>
        ) : (
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="学习计划标题（如：复习计量经济学）"
            aria-label="学习计划标题"
            disabled={!open}
          />
        )}
        {/* 三列布局与 Dialog 几何保持不变；日期 value 仍为 yyyy-MM-dd domain */}
        <div className="grid grid-cols-3 gap-2">
          <Field label="日期">
            <UISelect
              value={date}
              onChange={(v) => setDate(v)}
              ariaLabel="日期"
              options={weekDates.map((d) => ({ value: d, label: d.slice(5).replace("-", "/") }))}
              triggerClassName="w-full h-8 px-1.5 min-w-0 text-[11px]"
              itemClassName="h-8"
            />
          </Field>
          <Field label="开始">
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="开始时间" disabled={!open} className="h-8 px-1.5 text-[11px]" />
          </Field>
          <Field label="结束">
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="结束时间" disabled={!open} className="h-8 px-1.5 text-[11px]" />
          </Field>
        </div>
        {overlapHint && !placement?.hardConflict && (
          <p className="text-[11px] font-semibold text-warning">
            ⚠ 与《{overlapHint.courseName}》{overlapHint.startTime}–{overlapHint.endTime} 重叠
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={!open}>取消</Button>
          <Button
            variant="accent"
            size="sm"
            disabled={!open || (!shown && title.trim().length === 0)}
            onClick={() => onSubmit(shown, date, start, end)}
          >
            确认安排
          </Button>
        </div>
      </Dialog>
  );
}

/** 考试 / 日程小表单（常驻 lifecycle owner）：
 *  - `open` 表达 semantic state，Dialog 自己控制 presence；semantic close 后播完 exit
 *  - Fresh-open session reset：false→true 沿重置本地草稿（保持既有「每次打开为新表单」语义）；
 *    不在 close 时 reset——否则 exit 中用户会看到内容清空 */
export function MarkSheet({
  open,
  weekDates,
  onClose,
  onSubmit,
}: {
  open: boolean;
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

  // ---- Fresh-open session reset（false→true 沿） ----
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setTitle("");
      setType("exam");
      setDate(defaultDate);
      setStart("");
      setEnd("");
    }
    prevOpenRef.current = open;
  }, [open, defaultDate]);

  const canSubmit = title.trim().length > 0;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      overlayId="timeline-mark-sheet"
      stackZ={50}
      closeOnBackdrop
      aria-label="添加考试或日程"
      data-testid="timeline-mark-sheet"
      aria-hidden={!open || undefined}
      className={cn(
        "max-w-sm p-4 space-y-3 border-line-strong rounded-2xl shadow-card",
        // exit presence 期间释放指针所有权
        !open && "pointer-events-none"
      )}
    >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-charcoal">考试 / 日程</h3>
          <IconButton variant="ghost" size="sm" onClick={onClose} disabled={!open} aria-label="关闭">
            <X className="w-4 h-4" />
          </IconButton>
        </div>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="标题（如：英语六级模拟考试）"
          aria-label="标题"
          disabled={!open}
        />
        {/* exclusive selection → SegmentedControl（active plate 语义，不再自绘两套 active bg） */}
        <SegmentedControl
          value={type}
          onChange={(v) => setType(v)}
          ariaLabel="类型"
          className="self-start"
          options={[
            { value: "exam", label: "考试" },
            { value: "activity", label: "活动" },
          ]}
        />
        {/* 三列布局与 Dialog 几何保持不变；日期 value 仍为 yyyy-MM-dd domain */}
        <div className="grid grid-cols-3 gap-2">
          <Field label="日期">
            <UISelect
              value={date}
              onChange={(v) => setDate(v)}
              ariaLabel="日期"
              options={weekDates.map((d) => ({ value: d, label: d.slice(5).replace("-", "/") }))}
              triggerClassName="w-full h-8 px-1.5 min-w-0 text-[11px]"
              itemClassName="h-8"
            />
          </Field>
          <Field label="开始">
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="开始时间（可选）" disabled={!open} className="h-8 px-1.5 text-[11px]" />
          </Field>
          <Field label="结束">
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="结束时间（可选）" disabled={!open} className="h-8 px-1.5 text-[11px]" />
          </Field>
        </div>
        <p className="text-[10px] text-sandrift">不填开始 / 结束时间时显示为「全天」事件。</p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={!open}>取消</Button>
          <Button
            variant="accent"
            size="sm"
            disabled={!canSubmit || !open}
            onClick={() => onSubmit({ title: title.trim(), type, date, startTime: start || undefined, endTime: end || undefined })}
          >
            添加
          </Button>
        </div>
      </Dialog>
  );
}