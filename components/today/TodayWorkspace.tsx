"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Clock,
  Plus,
  Send,
  Sun,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import { Button } from "@/components/ui/Button";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { ExitCollapse } from "@/components/ui/ExitCollapse";
import { TodayTimeline } from "@/components/today/TodayTimeline";
import { TaskTerminalPreviewDialog } from "@/components/task/TaskTerminalPreviewDialog";
import { KiroLogoIcon } from "@/components/kiro/KiroLogo";
import { KiroFlowButton } from "@/components/kiro/KiroFlow";
import { KIRO_ICON } from "@/components/layout/navItems";
import { useKiroSessionActions } from "@/components/kiro/KiroSessionProvider";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { openAssignmentEditor } from "@/lib/uiEvents";
import { useExitPresenceList } from "@/lib/useExitPresenceList";
import { getWeekDateRange } from "@/lib/semester";
import { resolveCourseOccurrencesForWeek } from "@/lib/scheduleOccurrences";
import {
  buildTodayProjection,
  buildDeadlineFeed,
  type TaskProjectionItem,
} from "@/lib/tasks/taskProjections";
import {
  indexActiveStudyBlocksByAssignment,
  schedulingState,
  studyBlockMinutes,
} from "@/lib/tasks/taskPlanning";
import {
  getTaskDeadlineInstant,
  isActiveTask,
  isWaitingTask,
  localDateKey,
} from "@/lib/tasks/taskLifecycle";
import { formatEstimatedMinutes } from "@/lib/tasks/taskSemantics";
import type { Assignment, FocusSession } from "@/types";
import type { TaskTransitionPreview } from "@/lib/tasks/taskTransitions";
import { cn } from "@/lib/utils";

const KIRO_TODAY_PROMPT =
  "帮我安排今天：看课程、截止和可用时间，给出 1–3 件事的时间安排。先预览，不要写入。";

type GroupTone = "danger" | "warning" | "mint" | "neutral";

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

export function TodayWorkspace() {
  const [now, setNow] = useState(() => new Date());
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    overdue: true,
    dueToday: true,
    doToday: true,
    scheduledToday: true,
  });
  const [pending, setPending] = useState<{
    task: Assignment;
    preview: TaskTransitionPreview;
  } | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const {
    assignments,
    studyBlocks,
    courses,
    schedules,
    scheduleOccurrenceOverrides,
    semester,
    currentSemesterWeek,
    focusSessions,
    preferences,
    setSelectedAssignmentId,
    setSelectedCourseId,
    setActiveTab,
  } = useAppStore(
    useShallow((s) => ({
      assignments: s.assignments,
      studyBlocks: s.studyBlocks,
      courses: s.courses,
      schedules: s.schedules,
      scheduleOccurrenceOverrides: s.scheduleOccurrenceOverrides,
      semester: s.semester,
      currentSemesterWeek: s.currentSemesterWeek,
      focusSessions: s.focusSessions,
      preferences: s.preferences,
      setSelectedAssignmentId: s.setSelectedAssignmentId,
      setSelectedCourseId: s.setSelectedCourseId,
      setActiveTab: s.setActiveTab,
    }))
  );

  const { previewTaskTransition, transitionTask, undoTaskTransition } = useAppStore(
    useShallow((s) => ({
      previewTaskTransition: s.previewTaskTransition,
      transitionTask: s.transitionTask,
      undoTaskTransition: s.undoTaskTransition,
    }))
  );
  const pushToast = useToastStore((s) => s.pushToast);
  const { handoffPrompt } = useKiroSessionActions();

  const today = localDateKey(now);
  const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
  const courseById = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);
  const blocksById = useMemo(() => indexActiveStudyBlocksByAssignment(studyBlocks), [studyBlocks]);

  const projection = useMemo(
    () => buildTodayProjection(assignments, studyBlocks, now),
    [assignments, studyBlocks, now]
  );
  const deadlineFeed = useMemo(
    () => buildDeadlineFeed(assignments, now, preferences.ddlWarningDays),
    [assignments, now, preferences.ddlWarningDays]
  );
  const weekOccurrences = useMemo(
    () =>
      resolveCourseOccurrencesForWeek({
        schedules,
        overrides: scheduleOccurrenceOverrides,
        week: currentSemesterWeek,
        totalWeeks: semester.totalWeeks,
      }),
    [schedules, scheduleOccurrenceOverrides, currentSemesterWeek, semester.totalWeeks]
  );
  const dayOccurrences = useMemo(
    () => weekOccurrences.filter((occurrence) => occurrence.dayOfWeek === dayOfWeek),
    [weekOccurrences, dayOfWeek]
  );
  const activeFocus = focusSessions.find(
    (session) => session.status === "running" || session.status === "paused"
  );
  const waiting = assignments.filter(isWaitingTask);
  const unscheduledCount = assignments.filter(
    (assignment) =>
      isActiveTask(assignment) &&
      schedulingState(assignment, blocksById) !== "full"
  ).length;

  const nowNext = useMemo(
    () => buildNowNext(now, dayOccurrences, courseById, activeFocus, deadlineFeed.items[0]?.task, assignments),
    [now, dayOccurrences, courseById, activeFocus, deadlineFeed.items, assignments]
  );

  const groups = useMemo(
    () =>
      [
        { id: "overdue", title: "逾期", tone: "danger" as GroupTone, items: projection.groups.overdue },
        { id: "dueToday", title: "今天截止", tone: "warning" as GroupTone, items: projection.groups.dueToday },
        { id: "doToday", title: "今天做", tone: "mint" as GroupTone, items: projection.groups.doToday },
        {
          id: "scheduledToday",
          title: "今天有安排",
          tone: "neutral" as GroupTone,
          items: projection.groups.scheduledToday,
        },
      ].filter((group) => group.items.length > 0),
    [projection]
  );
  // 最后一项目完成时组会从 groups 消失：保留整组 snapshot 播放折叠，
  // 避免 singleton 组直接硬切；多项目组由 TodayTaskGroup 内部逐行退出。
  const retainedGroups = useExitPresenceList({
    items: groups,
    getId: (group) => group.id,
    resetKey: "today-groups",
  });

  const weekDates = useMemo(() => getWeekDateRange(semester, currentSemesterWeek), [semester, currentSemesterWeek]);
  const weekPlannedMinutes = useMemo(
    () =>
      studyBlocks.reduce(
        (sum, block) =>
          block.planningState !== "released" &&
          weekDates.some((date) => localDateKey(date) === block.date)
            ? sum + studyBlockMinutes(block)
            : sum,
        0
      ),
    [studyBlocks, weekDates]
  );

  const firstTask = groups[0]?.items[0]?.task;
  const brief = buildLocalBrief(projection, deadlineFeed.items[0]?.task, firstTask);

  const executeTransition = (task: Assignment, preview: TaskTransitionPreview) => {
    const result = transitionTask(task.id, preview.toStatus, {
      transitionId: preview.transitionId,
      source: "ui",
    });
    setPending(null);
    if (!result.ok) {
      pushToast({
        type: "error",
        message:
          result.blocker === "focus-running"
            ? "当前任务正在专注中，请先结束专注"
            : result.blocker === "already-completed"
              ? "任务已经处于该状态"
              : "这个任务暂时无法更新，请刷新后重试",
      });
      return;
    }
    const isSubmit = preview.toStatus === "submitted";
    pushToast({
      message: isSubmit ? "已提交，等待反馈" : "已完成",
      actionLabel: "撤销",
      actionAriaLabel: `撤销${isSubmit ? "提交" : "完成"}《${task.title}》`,
      duration: 10_000,
      onAction: () => {
        const undo = undoTaskTransition(task.id, preview.transitionId);
        pushToast({
          type: undo.ok ? "success" : "warning",
          message: undo.ok ? "已撤销" : "撤销未完全成功，请打开任务检查",
        });
      },
    });
  };

  const handleTerminal = (task: Assignment) => {
    const to = task.submissionRequired ? "submitted" : "completed";
    const preview = previewTaskTransition(task.id, to);
    if (!preview) {
      pushToast({ type: "error", message: "找不到这个任务" });
      return;
    }
    const hasEffects =
      preview.sideEffects.releaseStudyBlocks.count > 0 ||
      preview.sideEffects.cancelReminders.count > 0 ||
      preview.sideEffects.recurrence.willGenerate ||
      preview.sideEffects.incompleteSubtasks.count > 0;
    if (hasEffects || preview.blockers.length > 0) {
      setPending({ task, preview });
      return;
    }
    executeTransition(task, preview);
  };

  const scrollToGroup = (id: string) => {
    document.getElementById(`today-group-${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  return (
    <div className="flex flex-1 flex-col" data-testid="today-workspace">
      <WorkspaceHeader
        title="今天"
        context={`${now.getMonth() + 1}月${now.getDate()}日 · 周${
          "日一二三四五六"[now.getDay()]
        } · 第 ${currentSemesterWeek} 周`}
        actions={
          <KiroFlowButton
            icon={KIRO_ICON}
            label="Ask Kiro"
            size="sm"
            className="hidden h-8 sm:block"
            labelClassName="hidden md:inline"
            onClick={() => handoffPrompt(KIRO_TODAY_PROMPT)}
          />
        }
        primaryAction={
          <Button variant="primary" onClick={() => openAssignmentEditor({})}>
            <Plus className="h-3.5 w-3.5" />
            新建任务
          </Button>
        }
        sticky
        innerClassName="mx-auto w-full max-w-[1528px]"
      />

      <div
        className="workspace-gutter flex-1 pb-24 pt-4 md:pb-6 md:pt-6"
        data-testid="today-content"
      >
        <div className="mx-auto grid w-full max-w-[1480px] grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-4" data-testid="today-main">
            <div className="ux-staged-s0">
              <NowNextCard
                nowNext={nowNext}
                courseById={courseById}
                assignments={assignments}
                onOpenCourse={(id) => setSelectedCourseId(id)}
                onOpenAssignment={(id) => setSelectedAssignmentId(id)}
                onOpenTasks={() => setActiveTab("assignments")}
              />
            </div>

            <section
              className="dashboard-card ux-staged-s0 p-4 xl:hidden"
              data-testid="today-kiro-brief-mobile"
            >
              <div className="flex items-center gap-2">
                <KiroLogoIcon className="h-4 w-4" />
                <h2 className="text-sm font-semibold tracking-tight text-charcoal">Kiro 简报</h2>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-satin-grey">{brief}</p>
              <KiroFlowButton
                icon={KIRO_ICON}
                label="让 Kiro 规划今天"
                size="sm"
                className="mt-3 h-8"
                onClick={() => handoffPrompt(KIRO_TODAY_PROMPT)}
              />
            </section>

            <div className="ux-staged-s1">
              <AttentionStrip
                overdue={projection.groups.overdue.length}
                dueToday={projection.groups.dueToday.length}
                unscheduled={unscheduledCount}
                waiting={waiting.length}
                onOverdue={() => scrollToGroup("overdue")}
                onDueToday={() => scrollToGroup("dueToday")}
                onUnscheduled={() => setActiveTab("timetable")}
                onWaiting={() => setActiveTab("assignments")}
              />
            </div>

            <section
              aria-labelledby="today-tasks-title"
              className="dashboard-card ux-staged-s2 overflow-hidden"
            >
              <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
                <div>
                  <h2
                    id="today-tasks-title"
                    className="text-sm font-semibold tracking-tight text-charcoal"
                  >
                    今天要做
                  </h2>
                  {projection.taskCount > 0 && (
                    <p className="mt-0.5 text-[11px] text-sandrift">
                      {`${projection.taskCount} 项任务${
                        projection.plannedMinutes > 0
                          ? ` · 已安排 ${formatEstimatedMinutes(projection.plannedMinutes)}`
                          : ""
                      }`}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab("assignments")}
                  className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-satin-grey transition-colors hover:text-charcoal"
                >
                  全部任务
                  <ArrowUpRight className="h-3 w-3" />
                </button>
              </div>

              {retainedGroups.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-6 text-center">
                  <Sun className="h-5 w-5 text-sandrift" />
                  <p className="text-sm font-semibold text-charcoal">今天没有任务</p>
                  <p className="text-xs text-satin-grey">从任务页挑选一项，或添加新任务。</p>
                  <Button variant="secondary" className="mt-1" onClick={() => setActiveTab("assignments")}>
                    打开任务页
                  </Button>
                </div>
              ) : (
                <div className="divide-y divide-line-soft">
                  {retainedGroups.map(({ item: group, exiting }) => (
                    <ExitCollapse key={group.id} exiting={exiting}>
                      <TodayTaskGroup
                        group={group}
                        open={expanded[group.id] !== false}
                        courseById={courseById}
                        onToggle={() =>
                          setExpanded((current) => ({ ...current, [group.id]: !current[group.id] }))
                        }
                        onOpenTask={(id) => setSelectedAssignmentId(id)}
                        onTerminal={handleTerminal}
                        onViewAll={() => setActiveTab("assignments")}
                      />
                    </ExitCollapse>
                  ))}
                </div>
              )}
            </section>

            <TodayTimeline now={now} />
          </div>

          <aside
            className="min-w-0 space-y-4 xl:sticky xl:top-[89px] xl:self-start"
            data-testid="today-rail"
          >
            <section className="dashboard-card ux-staged-s1 hidden p-4 xl:block">
              <div className="flex items-center gap-2">
                <KiroLogoIcon className="h-4 w-4" />
                <h2 className="text-sm font-semibold tracking-tight text-charcoal">Kiro 简报</h2>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-satin-grey">{brief}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <KiroFlowButton
                  icon={KIRO_ICON}
                  label="让 Kiro 规划今天"
                  size="sm"
                  className="h-8"
                  onClick={() => handoffPrompt(KIRO_TODAY_PROMPT)}
                />
                <button
                  type="button"
                  onClick={() => setActiveTab("kiro")}
                  className="text-[11px] font-semibold text-sandrift transition-colors hover:text-charcoal"
                >
                  打开 Kiro
                </button>
              </div>
            </section>

            <section className="dashboard-card ux-staged-s1 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold tracking-tight text-charcoal">学习安排</h2>
                <span className="text-[11px] tabular-nums text-sandrift">
                  {projection.taskCount} 项任务
                </span>
              </div>
              <div className="mt-3 space-y-2.5">
                <MetricBar
                  label="今日安排"
                  value={formatEstimatedMinutes(projection.plannedMinutes) ?? "0 分钟"}
                  ratio={Math.min(1, projection.plannedMinutes / (6 * 60))}
                />
                <MetricBar
                  label="本周安排"
                  value={formatEstimatedMinutes(weekPlannedMinutes) ?? "0 分钟"}
                  ratio={Math.min(1, weekPlannedMinutes / (20 * 60))}
                  tone="neutral"
                />
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-line-soft pt-2 text-[11px] text-sandrift">
                <span>待安排 {unscheduledCount}</span>
                <button
                  type="button"
                  onClick={() => setActiveTab("timetable")}
                  className="inline-flex items-center gap-0.5 font-semibold hover:text-charcoal"
                >
                  打开时间表 <ArrowUpRight className="h-3 w-3" />
                </button>
              </div>
            </section>

            <section className="dashboard-card ux-staged-s2 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold tracking-tight text-charcoal">等待反馈</h2>
                <span className="text-[11px] tabular-nums text-sandrift">{waiting.length}</span>
              </div>
              {waiting.length === 0 ? (
                <p className="mt-2 text-[11px] text-satin-grey">暂无</p>
              ) : (
                <div className="mt-2 space-y-1">
                  {waiting.slice(0, 2).map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => setSelectedAssignmentId(task.id)}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-alabaster/60"
                    >
                      <Send className="h-3 w-3 shrink-0 text-sandrift" />
                      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-charcoal">
                        {task.title}
                      </span>
                      <span className="shrink-0 text-[10px] text-sandrift">已提交</span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="dashboard-card ux-staged-s3 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold tracking-tight text-charcoal">本周一览</h2>
                <span className="text-[11px] text-sandrift">第 {currentSemesterWeek} 周</span>
              </div>
              <WeekGlance
                dates={weekDates}
                occurrences={weekOccurrences}
                studyBlocks={studyBlocks}
                assignments={assignments}
                today={today}
                onSelect={() => setActiveTab("timetable")}
              />
            </section>
          </aside>
        </div>
      </div>

      {pending && (
        <TaskTerminalPreviewDialog
          preview={pending.preview}
          taskTitle={pending.task.title}
          onCancel={() => setPending(null)}
          onConfirm={() => executeTransition(pending.task, pending.preview)}
        />
      )}
    </div>
  );
}

function NowNextCard({
  nowNext,
  courseById,
  assignments,
  onOpenCourse,
  onOpenAssignment,
  onOpenTasks,
}: {
  nowNext: NowNext;
  courseById: Map<string, { id: string; name: string; bgHex?: string; textHex?: string }>;
  assignments: Assignment[];
  onOpenCourse: (id: string) => void;
  onOpenAssignment: (id: string) => void;
  onOpenTasks: () => void;
}) {
  if (nowNext.kind === "empty") {
    return (
      <section className="dashboard-card p-4 md:p-5" data-testid="today-now-next">
        <p className="text-[11px] font-semibold text-sandrift">今天</p>
        <h2 className="mt-1 text-[17px] font-semibold text-charcoal">今天暂无课程或截止</h2>
        <Button variant="secondary" className="mt-3" onClick={onOpenTasks}>
          查看任务
        </Button>
      </section>
    );
  }

  const course = nowNext.courseId ? courseById.get(nowNext.courseId) : undefined;
  return (
    <section
      className="dashboard-card relative overflow-hidden p-4 md:p-5"
      data-testid="today-now-next"
      style={course ? { borderLeftColor: course.bgHex, borderLeftWidth: 3 } : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-sandrift">{nowNext.eyebrow}</p>
          <h2 className="mt-1 truncate text-[17px] font-semibold text-charcoal md:text-[18px]">
            {nowNext.title}
          </h2>
          <p className="mt-1 truncate text-xs text-satin-grey">{nowNext.meta}</p>
        </div>
        {nowNext.kind === "focus" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-pastel-mint px-2 py-1 text-[10px] font-bold text-charcoal">
            <Clock className="h-3 w-3" /> 专注中
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {nowNext.kind === "focus" && nowNext.assignmentId && (
          <Button variant="primary" onClick={() => onOpenAssignment(nowNext.assignmentId!)}>
            查看任务
          </Button>
        )}
        {nowNext.kind === "course" && nowNext.courseId && (
          <Button variant="primary" onClick={() => onOpenCourse(nowNext.courseId!)}>
            查看课程
          </Button>
        )}
        {nowNext.kind === "deadline" && nowNext.assignmentId && (
          <Button variant="primary" onClick={() => onOpenAssignment(nowNext.assignmentId!)}>
            打开任务
          </Button>
        )}
      </div>
    </section>
  );
}

function AttentionStrip({
  overdue,
  dueToday,
  unscheduled,
  waiting,
  onOverdue,
  onDueToday,
  onUnscheduled,
  onWaiting,
}: {
  overdue: number;
  dueToday: number;
  unscheduled: number;
  waiting: number;
  onOverdue: () => void;
  onDueToday: () => void;
  onUnscheduled: () => void;
  onWaiting: () => void;
}) {
  const chips = [
    { id: "overdue", label: "逾期", count: overdue, tone: "danger", onClick: onOverdue },
    { id: "dueToday", label: "今天截止", count: dueToday, tone: "warning", onClick: onDueToday },
    { id: "unscheduled", label: "待安排", count: unscheduled, tone: "neutral", onClick: onUnscheduled },
    { id: "waiting", label: "等待反馈", count: waiting, tone: "mint", onClick: onWaiting },
  ].filter((chip) => chip.count > 0);

  if (chips.length === 0) {
    return (
      <div className="flex items-center gap-1.5 rounded-xl border border-line-soft bg-surface/60 px-3 py-2 text-[11px] text-satin-grey">
        <CheckCircle2 className="h-3.5 w-3.5 text-success" />
        暂无需要关注的事项
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="需要关注">
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={chip.onClick}
          className={cn(
            "ux-press inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors",
            chip.tone === "danger" && "border-danger-border bg-danger-bg text-danger hover:bg-danger-border/60",
            chip.tone === "warning" && "border-warning-border bg-warning-bg text-warning hover:bg-warning-border/60",
            chip.tone === "mint" && "border-success-border bg-success-bg text-success hover:bg-success-border/60",
            chip.tone === "neutral" && "border-line bg-surface text-satin-grey hover:bg-alabaster"
          )}
        >
          <span className="tabular-nums">{chip.count}</span>
          {chip.label}
        </button>
      ))}
    </div>
  );
}

type TodayGroup = {
  id: string;
  title: string;
  tone: GroupTone;
  items: TaskProjectionItem[];
};

function TodayTaskGroup({
  group,
  open,
  courseById,
  onToggle,
  onOpenTask,
  onTerminal,
  onViewAll,
}: {
  group: TodayGroup;
  open: boolean;
  courseById: Map<string, { name: string }>;
  onToggle: () => void;
  onOpenTask: (id: string) => void;
  onTerminal: (task: Assignment) => void;
  onViewAll: () => void;
}) {
  // 完成任务后保留一行 snapshot 播放折叠退出，避免列表硬跳。
  const retained = useExitPresenceList({
    items: group.items,
    getId: (item) => item.task.id,
    resetKey: group.id,
  });

  return (
    <div id={`today-group-${group.id}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`today-group-body-${group.id}`}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-alabaster/40"
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-sandrift transition-transform duration-[var(--motion-fast)]",
            !open && "-rotate-90"
          )}
        />
        <span className={cn("h-1.5 w-1.5 rounded-full", toneDot(group.tone))} />
        <span className="text-[11px] font-bold text-charcoal">{group.title}</span>
        <span className="text-[11px] tabular-nums text-sandrift">{group.items.length}</span>
      </button>
      <DisclosureRegion open={open} id={`today-group-body-${group.id}`} innerClassName="pb-1">
        {retained.slice(0, 8).map(({ item, exiting }) => (
          <ExitCollapse key={item.task.id} exiting={exiting}>
            <TodayTaskRow
              item={item}
              courseName={courseById.get(item.task.courseId)?.name}
              onOpen={() => onOpenTask(item.task.id)}
              onTerminal={() => onTerminal(item.task)}
            />
          </ExitCollapse>
        ))}
        {group.items.length > 8 && (
          <button
            type="button"
            onClick={onViewAll}
            className="w-full px-4 py-2 text-left text-[11px] font-semibold text-satin-grey hover:bg-alabaster/40 hover:text-charcoal"
          >
            查看全部任务
          </button>
        )}
      </DisclosureRegion>
    </div>
  );
}

function TodayTaskRow({
  item,
  courseName,
  onOpen,
  onTerminal,
}: {
  item: TaskProjectionItem;
  courseName?: string;
  onOpen: () => void;
  onTerminal: () => void;
}) {
  const { task, meta } = item;
  const deadline = meta.deadline;
  const deadlineLabel = meta.overdue
    ? "已逾期"
    : meta.deadlineToday && deadline
      ? `今天 ${String(deadline.getHours()).padStart(2, "0")}:${String(deadline.getMinutes()).padStart(2, "0")}`
      : deadline
        ? `${deadline.getMonth() + 1}/${deadline.getDate()}`
        : "未设截止";
  const remaining = meta.remainingMinutes;

  return (
    <div className="group flex min-h-14 items-center gap-2.5 px-4 py-2 transition-colors hover:bg-alabaster/40">
      <button
        type="button"
        aria-label={task.submissionRequired ? `提交《${task.title}》` : `完成《${task.title}》`}
        onClick={onTerminal}
        className={cn(
          "ux-press flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
          meta.overdue
            ? "border-danger-border text-danger hover:bg-danger-bg"
            : "border-line-strong text-sandrift hover:border-charcoal hover:text-charcoal"
        )}
      >
        {task.submissionRequired ? <Send className="h-2.5 w-2.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
      </button>

      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-charcoal/30"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-charcoal">{task.title}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[11px] text-sandrift">
            {courseName && (
              <span className="inline-flex min-w-0 items-center gap-1 truncate">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sandrift/60" />
                <span className="truncate">{courseName}</span>
              </span>
            )}
            <span className="shrink-0">{deadlineLabel}</span>
            {remaining !== null && remaining > 0 && (
              <span className="shrink-0 text-warning">剩余 {formatEstimatedMinutes(remaining)}</span>
            )}
            {meta.schedulingState === "unscheduled" && <span className="shrink-0">未安排</span>}
          </span>
        </span>

        {meta.overdue && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" />}
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-sandrift opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100" />
      </button>
    </div>
  );
}

function WeekGlance({
  dates,
  occurrences,
  studyBlocks,
  assignments,
  today,
  onSelect,
}: {
  dates: Date[];
  occurrences: ReturnType<typeof resolveCourseOccurrencesForWeek>;
  studyBlocks: ReturnType<typeof useAppStore.getState>["studyBlocks"];
  assignments: Assignment[];
  today: string;
  onSelect: () => void;
}) {
  const rows = dates.map((date, index) => {
    const key = localDateKey(date);
    const day = index + 1;
    const blockMinutes = studyBlocks.reduce(
      (sum, block) =>
        block.planningState !== "released" && block.date === key ? sum + studyBlockMinutes(block) : sum,
      0
    );
    const courseMinutes = occurrences
      .filter((occurrence) => occurrence.dayOfWeek === day)
      .reduce((sum, occurrence) => {
        const start = occurrence.startTime.split(":").map(Number);
        const end = occurrence.endTime.split(":").map(Number);
        return sum + Math.max(0, end[0] * 60 + end[1] - (start[0] * 60 + start[1]));
      }, 0);
    const taskCount = assignments.filter((assignment) => {
      if (!isActiveTask(assignment)) return false;
      const deadline = getTaskDeadlineInstant(assignment);
      return deadline !== null && localDateKey(deadline) === key;
    }).length;
    return { key, day, load: blockMinutes + courseMinutes, taskCount, isToday: key === today };
  });
  const maxLoad = Math.max(60, ...rows.map((row) => row.load));

  return (
    <div className="mt-3 grid grid-cols-7 gap-1">
      {rows.map((row) => (
        <button
          key={row.key}
          type="button"
          onClick={onSelect}
          aria-label={`${row.key} · 已安排 ${formatEstimatedMinutes(row.load) ?? "0 分钟"} · ${row.taskCount} 个截止`}
          className={cn(
            "flex min-w-0 flex-col items-center gap-1 rounded-lg px-1 py-1.5 transition-colors hover:bg-alabaster",
            row.isToday && "bg-pastel-mint/60"
          )}
        >
          <span className="text-[10px] font-bold text-satin-grey">{WEEKDAY_LABELS[row.day - 1]}</span>
          <span className="text-[10px] tabular-nums text-charcoal/80">{row.key.slice(8)}</span>
          <span className="flex h-7 w-full items-end justify-center">
            <span
              className={cn("w-2 rounded-full", row.isToday ? "bg-charcoal" : "bg-sandrift/65")}
              style={{ height: row.load > 0 ? `${Math.max(3, (row.load / maxLoad) * 24)}px` : 0 }}
            />
          </span>
          {row.taskCount > 0 && <span className="text-[10px] tabular-nums text-sandrift">{row.taskCount}</span>}
        </button>
      ))}
    </div>
  );
}

function MetricBar({
  label,
  value,
  ratio,
  tone = "mint",
}: {
  label: string;
  value: string;
  ratio: number;
  tone?: "mint" | "neutral";
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-satin-grey">{label}</span>
        <span className="font-semibold tabular-nums text-charcoal">{value}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line-soft">
        <div
          className={cn("h-full rounded-full", tone === "mint" ? "bg-success/70" : "bg-sandrift/65")}
          style={{ width: ratio > 0 ? `${Math.max(2, ratio * 100)}%` : 0 }}
        />
      </div>
    </div>
  );
}

type NowNext =
  | { kind: "empty" }
  | {
      kind: "focus";
      eyebrow: string;
      title: string;
      meta: string;
      assignmentId?: string;
      courseId?: string;
    }
  | {
      kind: "course";
      eyebrow: string;
      title: string;
      meta: string;
      courseId: string;
      assignmentId?: string;
    }
  | {
      kind: "deadline";
      eyebrow: string;
      title: string;
      meta: string;
      assignmentId: string;
      courseId?: string;
    };

function buildNowNext(
  now: Date,
  dayOccurrences: ReturnType<typeof resolveCourseOccurrencesForWeek>,
  courseById: Map<string, { name: string }>,
  activeFocus: FocusSession | undefined,
  nextDeadline: Assignment | undefined,
  assignments: Assignment[]
): NowNext {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const current = [...dayOccurrences]
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .find((occurrence) => {
      const start = occurrence.startTime.split(":").map(Number);
      const end = occurrence.endTime.split(":").map(Number);
      return nowMinutes >= start[0] * 60 + start[1] && nowMinutes < end[0] * 60 + end[1];
    });
  const next = [...dayOccurrences]
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
    .find((occurrence) => {
      const start = occurrence.startTime.split(":").map(Number);
      return start[0] * 60 + start[1] > nowMinutes;
    });

  if (activeFocus) {
    const assignment = assignments.find((item) => item.id === activeFocus.assignmentId);
    const elapsedMs =
      activeFocus.accumulatedActiveMs +
      (activeFocus.status === "running" && activeFocus.activeStartedAt
        ? Math.max(0, now.getTime() - activeFocus.activeStartedAt)
        : 0);
    const focusedMinutes = Math.max(1, Math.round(elapsedMs / 60_000));
    return {
      kind: "focus",
      eyebrow: activeFocus.status === "paused" ? "专注 · 已暂停" : "正在进行",
      title: assignment?.title ?? "正在专注",
      meta: `已专注 ${focusedMinutes} 分钟`,
      assignmentId: activeFocus.assignmentId,
    };
  }

  if (current) {
    const course = courseById.get(current.courseId);
    const sourceLabel =
      current.source === "moved" ? " · 临时调课" : current.source === "extra" ? " · 补课" : "";
    return {
      kind: "course",
      eyebrow: `现在 · ${current.startTime}–${current.endTime}`,
      title: course?.name ?? "课程",
      meta: `${current.location || "地点未设置"}${sourceLabel}`,
      courseId: current.courseId,
    };
  }

  if (next) {
    const course = courseById.get(next.courseId);
    const start = next.startTime.split(":").map(Number);
    const minutes = start[0] * 60 + start[1] - nowMinutes;
    return {
      kind: "course",
      eyebrow: `下一节 · ${next.startTime}`,
      title: course?.name ?? "课程",
      meta: `${minutes > 0 ? `${minutes} 分钟后` : "即将开始"} · ${next.location || "地点未设置"}`,
      courseId: next.courseId,
    };
  }

  if (nextDeadline) {
    const deadline = getTaskDeadlineInstant(nextDeadline);
    const overdue = deadline !== null && deadline.getTime() < now.getTime();
    const todayDeadline = deadline !== null && localDateKey(deadline) === localDateKey(now);
    const timeLabel =
      deadline === null
        ? "未设截止"
        : todayDeadline
          ? `今天 ${String(deadline.getHours()).padStart(2, "0")}:${String(deadline.getMinutes()).padStart(2, "0")}`
          : `${deadline.getMonth() + 1}月${deadline.getDate()}日`;
    return {
      kind: "deadline",
      eyebrow: overdue ? "逾期最久" : "下一个截止",
      title: nextDeadline.title,
      meta: `${timeLabel} · ${courseById.get(nextDeadline.courseId)?.name ?? "未关联课程"}`,
      assignmentId: nextDeadline.id,
    };
  }

  return { kind: "empty" };
}

function buildLocalBrief(
  projection: ReturnType<typeof buildTodayProjection>,
  nextDeadline: Assignment | undefined,
  firstTask: Assignment | undefined
): string {
  if (projection.groups.overdue.length > 0) {
    return firstTask
      ? `有 ${projection.groups.overdue.length} 个任务已逾期，最近的是「${firstTask.title}」。`
      : `有 ${projection.groups.overdue.length} 个任务已逾期。`;
  }
  if (projection.taskCount > 0) {
    return `今天 ${projection.taskCount} 个任务${nextDeadline ? `，最近截止「${nextDeadline.title}」` : ""}。`;
  }
  if (nextDeadline) {
    return `今天没有任务，最近截止「${nextDeadline.title}」。`;
  }
  return "今天没有任务和截止。";
}

function toneDot(tone: GroupTone): string {
  switch (tone) {
    case "danger":
      return "bg-danger";
    case "warning":
      return "bg-warning";
    case "mint":
      return "bg-success";
    default:
      return "bg-sandrift";
  }
}
