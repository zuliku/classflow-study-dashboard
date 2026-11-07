"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { KiroFlowButton } from "@/components/kiro/KiroFlow";
import { KIRO_ICON } from "@/components/layout/navItems";
import { useKiroSessionActions } from "@/components/kiro/KiroSessionProvider";
import { PlanViewBar } from "@/components/plan/PlanViewBar";
import { PlanBacklog } from "@/components/plan/PlanBacklog";
import { PlanCanvas } from "@/components/plan/PlanCanvas";
import { planSelectionKey } from "@/lib/plan/selectionKey";
import { PlanAgenda } from "@/components/plan/PlanAgenda";
import { PlanInspector } from "@/components/plan/PlanInspector";
import { PlanArrangeDialog } from "@/components/plan/PlanArrangeDialog";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import {
  buildPlanBacklogProjection,
  type TaskProjectionItem,
} from "@/lib/tasks/taskProjections";
import {
  getTaskDeadlineInstant,
  isActiveTask,
  localDateKey,
} from "@/lib/tasks/taskLifecycle";
import {
  indexActiveStudyBlocksByAssignment,
  isActiveStudyBlock,
  remainingMinutes,
} from "@/lib/tasks/taskPlanning";
import { formatEstimatedMinutes } from "@/lib/tasks/taskSemantics";
import { getWeekDateRange, formatWeekDateRange } from "@/lib/semester";
import { resolveCourseOccurrencesForWeek } from "@/lib/scheduleOccurrences";
import {
  analyzeStudyBlockPlacement,
  courseOverlapSuffix,
} from "@/lib/timeline/studyBlockPlacement";
import { openAssignmentEditor } from "@/lib/uiEvents";
import {
  planDurationMinutes,
  planTimeToMinutes,
  minutesToPlanTime,
} from "@/lib/plan/canvasLayout";
import type {
  PlanBacklogGroup,
  PlanCanvasItem,
  PlanDay,
  PlanSelection,
} from "@/lib/plan/planTypes";
import type { Assignment, CalendarMark, Course } from "@/types";
import { cn } from "@/lib/utils";

const KIRO_PLAN_PROMPT =
  "帮我安排这一周：先看待安排任务、课程和已有学习块，给出优先顺序和时间安排。先预览，不要写入。";

export function PlanWorkspace() {
  const {
    assignments,
    studyBlocks,
    courses,
    schedules,
    scheduleOccurrenceOverrides,
    calendarMarks,
    semester,
    currentSemesterWeek,
    addStudyBlock,
    updateStudyBlock,
    setSelectedAssignmentId,
    setSelectedCourseId,
    setSelectedCalendarMarkId,
  } = useAppStore(
    useShallow((s) => ({
      assignments: s.assignments,
      studyBlocks: s.studyBlocks,
      courses: s.courses,
      schedules: s.schedules,
      scheduleOccurrenceOverrides: s.scheduleOccurrenceOverrides,
      calendarMarks: s.calendarMarks,
      semester: s.semester,
      currentSemesterWeek: s.currentSemesterWeek,
      addStudyBlock: s.addStudyBlock,
      updateStudyBlock: s.updateStudyBlock,
      setSelectedAssignmentId: s.setSelectedAssignmentId,
      setSelectedCourseId: s.setSelectedCourseId,
      setSelectedCalendarMarkId: s.setSelectedCalendarMarkId,
    }))
  );
  const pushToast = useToastStore((s) => s.pushToast);
  const { handoffPrompt } = useKiroSessionActions();

  const [selectedWeek, setSelectedWeek] = useState(currentSemesterWeek);
  const [now, setNow] = useState(() => new Date());
  const [collapsed, setCollapsed] = useState(false);
  const [backlogSheetOpen, setBacklogSheetOpen] = useState(false);
  const [selection, setSelection] = useState<PlanSelection | null>(null);
  const [draggingTask, setDraggingTask] = useState<Assignment | null>(null);
  const [arrangeFor, setArrangeFor] = useState<Assignment | null>(null);
  const [freeBlockOpen, setFreeBlockOpen] = useState(false);
  const compact = useMediaQuery("(max-width: 1279px)");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!compact) setBacklogSheetOpen(false);
  }, [compact]);

  const weekDates = useMemo(() => getWeekDateRange(semester, selectedWeek), [semester, selectedWeek]);
  const weekDateKeys = useMemo(() => weekDates.map(localDateKey), [weekDates]);
  const courseById = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);
  const blocksById = useMemo(() => indexActiveStudyBlocksByAssignment(studyBlocks), [studyBlocks]);

  const occurrences = useMemo(
    () =>
      resolveCourseOccurrencesForWeek({
        schedules,
        overrides: scheduleOccurrenceOverrides,
        week: selectedWeek,
        totalWeeks: semester.totalWeeks,
      }),
    [schedules, scheduleOccurrenceOverrides, selectedWeek, semester.totalWeeks]
  );

  const weekSchedules = useMemo(
    () =>
      occurrences.map((occurrence) => ({
        id: occurrence.id,
        courseId: occurrence.courseId,
        dayOfWeek: occurrence.dayOfWeek,
        startTime: occurrence.startTime,
        endTime: occurrence.endTime,
      })),
    [occurrences]
  );

  const backlog = useMemo(
    () => buildPlanBacklogProjection(assignments, studyBlocks, weekDateKeys, now),
    [assignments, studyBlocks, weekDateKeys, now]
  );

  const backlogGroups = useMemo<PlanBacklogGroup[]>(
    () => [
      { id: "overdue", title: "逾期", items: backlog.buckets.overdue },
      { id: "dueThisWeek", title: "本周到期", items: backlog.buckets.dueThisWeek },
      { id: "needsScheduling", title: "需要安排", items: backlog.buckets.needsScheduling },
    ],
    [backlog]
  );
  const backlogCount = backlogGroups.reduce((sum, group) => sum + group.items.length, 0);

  const days = useMemo(
    () =>
      buildPlanDays({
        weekDates,
        weekDateKeys,
        assignments,
        studyBlocks,
        occurrences,
        calendarMarks,
        courseById,
        now,
      }),
    [weekDates, weekDateKeys, assignments, studyBlocks, occurrences, calendarMarks, courseById, now]
  );

  const selectionKey = planSelectionKey(selection);
  const isCurrentWeek = selectedWeek === currentSemesterWeek;
  const backlogOpen = compact ? backlogSheetOpen : !collapsed;

  const goToWeek = (week: number) => {
    setSelectedWeek(Math.min(Math.max(week, 1), semester.totalWeeks));
    setSelection(null);
  };

  const openArrange = (assignment: Assignment) => {
    if (!isActiveTask(assignment)) {
      pushToast({ type: "error", message: "已完成的任务不能再安排" });
      return;
    }
    setBacklogSheetOpen(false);
    setArrangeFor(assignment);
    setFreeBlockOpen(false);
  };

  const handleSelect = (next: PlanSelection) => {
    setSelection(next);
    setBacklogSheetOpen(false);
  };

  const handleDropTask = (date: string, minutes: number) => {
    const task = draggingTask;
    setDraggingTask(null);
    if (!task) return;
    const remaining = remainingMinutes(task, blocksById);
    const rawDuration = remaining === null ? 60 : remaining;
    const duration = Math.min(120, Math.max(30, Math.round(rawDuration / 15) * 15));
    const start = Math.min(
      Math.max(Math.round(minutes / 15) * 15, 8 * 60),
      22 * 60 - duration
    );
    const startTime = minutesToPlanTime(start);
    const endTime = minutesToPlanTime(start + duration);
    scheduleTask(task, date, startTime, endTime);
  };

  const handleMoveBlock = (blockId: string, date: string, minutes: number) => {
    const block = studyBlocks.find((item) => item.id === blockId);
    if (!block) return;
    const duration = Math.max(30, planDurationMinutes(block.startTime, block.endTime));
    const start = Math.min(
      Math.max(Math.round(minutes / 15) * 15, 8 * 60),
      22 * 60 - duration
    );
    const startTime = minutesToPlanTime(start);
    const endTime = minutesToPlanTime(start + duration);
    const analysis = analyzeStudyBlockPlacement(
      { id: block.id, date, startTime, endTime },
      { schedules: weekSchedules, studyBlocks, courses, currentSemesterWeek: selectedWeek }
    );
    if (analysis.hardConflict) {
      pushToast({
        type: "error",
        message: `与《${analysis.hardConflict.title}》时间冲突`,
      });
      return;
    }
    const ok = updateStudyBlock(block.id, { date, startTime, endTime });
    if (!ok) {
      pushToast({ type: "error", message: "学习块移动失败" });
      return;
    }
    setSelection({ kind: "block", blockId: block.id });
    pushToast({ message: `已移到 ${startTime}${courseOverlapSuffix(analysis.courseOverlaps)}` });
  };

  const scheduleTask = (
    task: Assignment,
    date: string,
    startTime: string,
    endTime: string
  ) => {
    if (!isActiveTask(task)) {
      pushToast({ type: "error", message: "已完成的任务不能再安排" });
      return;
    }
    if (planDurationMinutes(startTime, endTime) <= 0) {
      pushToast({ type: "error", message: "结束时间需要晚于开始时间" });
      return;
    }
    const analysis = analyzeStudyBlockPlacement(
      { date, startTime, endTime },
      { schedules: weekSchedules, studyBlocks, courses, currentSemesterWeek: selectedWeek }
    );
    if (analysis.hardConflict) {
      pushToast({
        type: "error",
        message: `与《${analysis.hardConflict.title}》时间冲突`,
      });
      return;
    }
    const id = addStudyBlock({
      title: task.title,
      date,
      startTime,
      endTime,
      assignmentId: task.id,
      courseId: task.courseId,
      source: "manual",
    });
    if (!id) {
      pushToast({ type: "error", message: "这个任务暂时无法安排" });
      return;
    }
    setSelection({ kind: "block", blockId: id });
    pushToast({
      message: `已安排 ${formatEstimatedMinutes(planDurationMinutes(startTime, endTime)) ?? ""}${courseOverlapSuffix(
        analysis.courseOverlaps
      )}`,
    });
  };

  const handleArrangeSubmit = (input: {
    title: string;
    date: string;
    startTime: string;
    endTime: string;
  }) => {
    const { title, date, startTime, endTime } = input;
    if (planDurationMinutes(startTime, endTime) <= 0) {
      pushToast({ type: "error", message: "结束时间需要晚于开始时间" });
      return;
    }
    if (arrangeFor) {
      scheduleTask(arrangeFor, date, startTime, endTime);
    } else {
      const analysis = analyzeStudyBlockPlacement(
        { date, startTime, endTime },
        { schedules: weekSchedules, studyBlocks, courses, currentSemesterWeek: selectedWeek }
      );
      if (analysis.hardConflict) {
        pushToast({
          type: "error",
          message: `与《${analysis.hardConflict.title}》时间冲突`,
        });
        return;
      }
      const id = addStudyBlock({
        title: title || "学习计划",
        date,
        startTime,
        endTime,
        source: "manual",
      });
      if (!id) {
        pushToast({ type: "error", message: "学习块添加失败" });
        return;
      }
      setSelection({ kind: "block", blockId: id });
      pushToast({
        message: `已添加学习块${courseOverlapSuffix(analysis.courseOverlaps)}`,
      });
    }
    setArrangeFor(null);
    setFreeBlockOpen(false);
  };

  const openAssignmentArrange = (assignmentId: string) => {
    const task = assignments.find((item) => item.id === assignmentId);
    if (task) openArrange(task);
  };

  const handleBacklogToggle = () => {
    if (compact) setBacklogSheetOpen((open) => !open);
    else setCollapsed((value) => !value);
  };

  const backlogProps = {
    groups: backlogGroups,
    courseById,
    now,
    draggingId: draggingTask?.id ?? null,
    onSelect: (item: TaskProjectionItem) =>
      handleSelect({ kind: "assignment", assignmentId: item.task.id }),
    onArrange: (item: TaskProjectionItem) => openArrange(item.task),
    onDragStart: (item: TaskProjectionItem) => setDraggingTask(item.task),
    onDragEnd: () => setDraggingTask(null),
    onAddTask: () => {
      setBacklogSheetOpen(false);
      openAssignmentEditor({});
    },
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="plan-workspace">
      <WorkspaceHeader
        title="时间表"
        context={`第 ${selectedWeek} 周 · ${formatWeekDateRange(semester, selectedWeek)}`}
        actions={
          <KiroFlowButton
            icon={KIRO_ICON}
            label="Ask Kiro"
            size="sm"
            className="hidden h-8 sm:block"
            labelClassName="hidden md:inline"
            onClick={() => handoffPrompt(KIRO_PLAN_PROMPT)}
          />
        }
        primaryAction={
          <Button variant="primary" onClick={() => openAssignmentEditor({})}>
            <Plus className="h-3.5 w-3.5" />
            新建任务
          </Button>
        }
      />

      <PlanViewBar
        selectedWeek={selectedWeek}
        totalWeeks={semester.totalWeeks}
        rangeLabel={formatWeekDateRange(semester, selectedWeek)}
        isCurrentWeek={isCurrentWeek}
        backlogCount={backlogCount}
        backlogOpen={backlogOpen}
        onPrevWeek={() => goToWeek(selectedWeek - 1)}
        onNextWeek={() => goToWeek(selectedWeek + 1)}
        onToday={() => goToWeek(currentSemesterWeek)}
        onToggleBacklog={handleBacklogToggle}
        onAddBlock={() => {
          setArrangeFor(null);
          setFreeBlockOpen(true);
        }}
      />

      <div className="workspace-gutter flex min-h-0 flex-1 pb-24 pt-4 md:pb-5 md:pt-5">
        <div
          className="relative flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-line bg-surface shadow-subtle"
          data-testid="plan-surface"
        >
          {!compact && !collapsed && (
            <div className="hidden w-[260px] shrink-0 border-r border-line xl:flex min-[1440px]:w-[280px] min-[1880px]:w-[300px]">
              <PlanBacklog
                {...backlogProps}
                onClose={() => setCollapsed(true)}
                className="min-h-0"
              />
            </div>
          )}

          <div className="hidden min-h-0 min-w-0 flex-1 lg:flex">
            <PlanCanvas
              days={days}
              now={now}
              selectionKey={selectionKey}
              onSelect={handleSelect}
              onDropTask={handleDropTask}
              onMoveBlock={handleMoveBlock}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col lg:hidden">
            <PlanAgenda
              days={days}
              selectionKey={selectionKey}
              onSelect={handleSelect}
            />
          </div>

          {selection && (
            <button
              type="button"
              aria-label="关闭详情面板"
              onClick={() => setSelection(null)}
              className="ux-fade absolute inset-0 z-20 bg-charcoal/5 min-[1880px]:hidden"
            />
          )}

          <PlanInspector
            key={selectionKey ?? "empty"}
            selection={selection}
            now={now}
            onClose={() => setSelection(null)}
            onOpenAssignment={(id) => setSelectedAssignmentId(id)}
            onOpenCourse={(id) => setSelectedCourseId(id)}
            onOpenMark={(id) => setSelectedCalendarMarkId(id)}
            onArrange={openAssignmentArrange}
            className={cn(
              "ux-detail-in absolute inset-y-0 right-0 z-30 w-[360px] max-w-[90vw] border-l border-line shadow-card",
              "min-[1880px]:static min-[1880px]:w-[340px] min-[1880px]:max-w-none min-[1880px]:shrink-0 min-[1880px]:shadow-none",
              selection ? "flex" : "hidden min-[1880px]:flex"
            )}
          />
        </div>
      </div>

      <PlanArrangeDialog
        open={arrangeFor !== null || freeBlockOpen}
        assignment={arrangeFor}
        weekDates={weekDateKeys}
        onClose={() => {
          setArrangeFor(null);
          setFreeBlockOpen(false);
        }}
        getPlacement={(date, start, end) =>
          analyzeStudyBlockPlacement(
            { date, startTime: start, endTime: end },
            {
              schedules: weekSchedules,
              studyBlocks,
              courses,
              currentSemesterWeek: selectedWeek,
            }
          )
        }
        onSubmit={handleArrangeSubmit}
      />

      <Drawer
        open={backlogSheetOpen}
        onOpenChange={setBacklogSheetOpen}
        overlayId="plan-backlog-sheet"
        presentation="edge"
        aria-label="待安排"
        overlayClassName="max-md:!items-end max-md:!justify-center md:justify-start"
        className="md:!w-[320px] md:border-r md:border-l-0 max-md:!h-[72dvh] max-md:rounded-t-2xl max-md:border-t max-md:border-l-0"
      >
        <PlanBacklog
          {...backlogProps}
          onClose={() => setBacklogSheetOpen(false)}
          className="min-h-0"
        />
      </Drawer>
    </div>
  );
}

function buildPlanDays({
  weekDates,
  weekDateKeys,
  assignments,
  studyBlocks,
  occurrences,
  calendarMarks,
  courseById,
  now,
}: {
  weekDates: Date[];
  weekDateKeys: string[];
  assignments: Assignment[];
  studyBlocks: ReturnType<typeof useAppStore.getState>["studyBlocks"];
  occurrences: ReturnType<typeof resolveCourseOccurrencesForWeek>;
  calendarMarks: CalendarMark[];
  courseById: Map<string, Course>;
  now: Date;
}): PlanDay[] {
  const today = localDateKey(now);
  const weekSet = new Set(weekDateKeys);
  const days: PlanDay[] = weekDates.map((date, index) => ({
    date: weekDateKeys[index],
    dateObj: date,
    dayOfWeek: index + 1,
    isToday: weekDateKeys[index] === today,
    items: [],
    allDay: [],
  }));
  const dayByDate = new Map(days.map((day) => [day.date, day]));

  for (const assignment of assignments) {
    if (!isActiveTask(assignment)) continue;
    const deadline = getTaskDeadlineInstant(assignment);
    if (!deadline) continue;
    const date = localDateKey(deadline);
    const day = dayByDate.get(date);
    if (!day) continue;
    const start = deadline.getHours() * 60 + deadline.getMinutes();
    const end = Math.min(24 * 60, start + 15);
    day.items.push({
      id: `ddl-${assignment.id}`,
      kind: "ddl",
      title: assignment.title,
      subtitle: "截止",
      date,
      start,
      end,
      assignmentId: assignment.id,
      courseId: assignment.courseId,
    });
  }

  for (const occurrence of occurrences) {
    const date = weekDateKeys[occurrence.dayOfWeek - 1];
    const day = date ? dayByDate.get(date) : undefined;
    if (!day) continue;
    const start = planTimeToMinutes(occurrence.startTime);
    const end = planTimeToMinutes(occurrence.endTime);
    if (start === null || end === null || end <= start) continue;
    const course = courseById.get(occurrence.courseId);
    day.items.push({
      id: `course-${occurrence.id}`,
      kind: "course",
      title: course?.name ?? "课程",
      subtitle: occurrence.location,
      date,
      start,
      end,
      courseId: occurrence.courseId,
      color: course?.bgHex,
      textColor: course?.textHex,
      location: occurrence.location,
    });
  }

  for (const block of studyBlocks) {
    if (!isActiveStudyBlock(block) || !weekSet.has(block.date)) continue;
    const day = dayByDate.get(block.date);
    if (!day) continue;
    const start = planTimeToMinutes(block.startTime);
    const end = planTimeToMinutes(block.endTime);
    if (start === null || end === null || end <= start) continue;
    day.items.push({
      id: `block-${block.id}`,
      kind: "study",
      title: block.title,
      subtitle: "学习块",
      date: block.date,
      start,
      end,
      assignmentId: block.assignmentId,
      blockId: block.id,
      courseId: block.courseId,
    });
  }

  for (const mark of calendarMarks) {
    if (!weekSet.has(mark.date)) continue;
    if (mark.type !== "exam" && mark.type !== "activity") continue;
    const day = dayByDate.get(mark.date);
    if (!day) continue;
    const start = mark.startTime ? planTimeToMinutes(mark.startTime) : null;
    const end = mark.endTime ? planTimeToMinutes(mark.endTime) : null;
    if (start !== null && end !== null && end > start) {
      day.items.push({
        id: `mark-${mark.id}`,
        kind: mark.type,
        title: mark.title,
        subtitle: mark.type === "exam" ? "考试" : "活动",
        date: mark.date,
        start,
        end,
        markId: mark.id,
      });
    } else {
      day.allDay.push({
        id: `mark-${mark.id}`,
        kind: mark.type,
        title: mark.title,
        date: mark.date,
        markId: mark.id,
      });
    }
  }

  for (const day of days) {
    day.items.sort((a, b) => a.start - b.start || a.end - b.end);
  }
  return days;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", update);
      return () => mql.removeEventListener("change", update);
    }
    mql.addListener(update);
    return () => mql.removeListener(update);
  }, [query]);

  return matches;
}
