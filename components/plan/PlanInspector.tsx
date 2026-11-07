"use client";

import React, { useMemo } from "react";
import { AlertTriangle, CalendarDays, Clock, MousePointer2, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { useAppStore } from "@/store/useAppStore";
import { formatEstimatedMinutes } from "@/lib/tasks/taskSemantics";
import { getTaskDeadlineInstant } from "@/lib/tasks/taskLifecycle";
import {
  indexActiveStudyBlocksByAssignment,
  plannedActiveMinutes,
  remainingMinutes,
} from "@/lib/tasks/taskPlanning";
import { planTimeToMinutes } from "@/lib/plan/canvasLayout";
import type { PlanSelection } from "@/lib/plan/planTypes";
import { cn } from "@/lib/utils";

export function PlanInspector({
  selection,
  now,
  onClose,
  onOpenAssignment,
  onOpenCourse,
  onOpenMark,
  onArrange,
  className,
}: {
  selection: PlanSelection | null;
  now: Date;
  onClose: () => void;
  onOpenAssignment: (id: string) => void;
  onOpenCourse: (id: string) => void;
  onOpenMark: (id: string) => void;
  onArrange: (assignmentId: string) => void;
  className?: string;
}) {
  const { assignments, studyBlocks, courses, calendarMarks } = useAppStore(
    useShallow((s) => ({
      assignments: s.assignments,
      studyBlocks: s.studyBlocks,
      courses: s.courses,
      calendarMarks: s.calendarMarks,
    }))
  );

  const courseById = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);
  const blocksById = useMemo(() => indexActiveStudyBlocksByAssignment(studyBlocks), [studyBlocks]);

  if (!selection) {
    return (
      <aside
        aria-label="详情"
        className={cn("flex h-full min-h-0 flex-col bg-surface", className)}
        data-testid="plan-inspector"
      >
        <InspectorHeader label="详情" />
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-line-soft bg-background text-sandrift">
            <MousePointer2 className="h-4 w-4" />
          </span>
          <p className="text-sm font-semibold text-charcoal">选择一个任务或时间块</p>
          <p className="text-xs text-satin-grey">详情和操作会显示在这里。</p>
        </div>
      </aside>
    );
  }

  if (selection.kind === "assignment") {
    const task = assignments.find((item) => item.id === selection.assignmentId);
    if (!task) return <EmptyInspector onClose={onClose} text="任务已不存在" className={className} />;
    const course = courseById.get(task.courseId);
    const deadline = getTaskDeadlineInstant(task);
    const remaining = remainingMinutes(task, blocksById);
    const planned = plannedActiveMinutes(task.id, blocksById);
    const overdue = deadline ? deadline.getTime() < now.getTime() : false;
    return (
      <aside
        aria-label="任务详情"
        className={cn("flex h-full min-h-0 flex-col bg-surface", className)}
        data-testid="plan-inspector"
      >
        <InspectorHeader label="任务" onClose={onClose} />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <h2 className="text-[16px] font-semibold leading-snug text-charcoal">{task.title}</h2>
          <p className="mt-1 text-[11px] text-sandrift">
            {course?.name ?? "未关联课程"}
            {deadline ? ` · 截止 ${formatDeadline(deadline, now)}` : " · 未设截止"}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {overdue && (
              <span className="inline-flex items-center gap-1 rounded-full border border-danger-border bg-danger-bg px-2 py-0.5 text-[10px] font-bold text-danger">
                <AlertTriangle className="h-3 w-3" /> 已逾期
              </span>
            )}
            <span className="rounded-full border border-line bg-background px-2 py-0.5 text-[10px] font-semibold text-satin-grey">
              剩余 {remaining === null ? "未知" : formatEstimatedMinutes(remaining) ?? "0 分钟"}
            </span>
            <span className="rounded-full border border-line bg-background px-2 py-0.5 text-[10px] font-semibold text-satin-grey">
              已安排 {formatEstimatedMinutes(planned) ?? "0 分钟"}
            </span>
          </div>
          <div className="mt-4 space-y-1.5">
            <Button
              variant="primary"
              size="sm"
              className="w-full"
              onClick={() => onOpenAssignment(task.id)}
            >
              打开任务
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              onClick={() => onArrange(task.id)}
            >
              安排学习块
            </Button>
          </div>
        </div>
      </aside>
    );
  }

  if (selection.kind === "block") {
    const block = studyBlocks.find((item) => item.id === selection.blockId);
    if (!block) return <EmptyInspector onClose={onClose} text="学习块已不存在" className={className} />;
    const task = block.assignmentId
      ? assignments.find((item) => item.id === block.assignmentId)
      : undefined;
    const course = block.courseId ? courseById.get(block.courseId) : undefined;
    return (
      <aside
        aria-label="学习块详情"
        className={cn("flex h-full min-h-0 flex-col bg-surface", className)}
        data-testid="plan-inspector"
      >
        <InspectorHeader label="学习块" onClose={onClose} />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <h2 className="text-[16px] font-semibold leading-snug text-charcoal">{block.title}</h2>
          <p className="mt-1 text-[11px] text-sandrift">
            {block.date} · {block.startTime}–{block.endTime}
            {course ? ` · ${course.name}` : ""}
          </p>
          <div className="mt-3 inline-flex items-center gap-1 rounded-full border border-success-border bg-success-bg px-2 py-0.5 text-[10px] font-bold text-success">
            <Clock className="h-3 w-3" /> 已安排
          </div>
          <div className="mt-4 space-y-1.5">
            {task && (
              <>
                <div className="rounded-lg border border-line-soft bg-surface-soft px-3 py-2">
                  <p className="text-[10px] text-sandrift">关联任务</p>
                  <p className="mt-0.5 truncate text-[12px] font-semibold text-charcoal">
                    {task.title}
                  </p>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full"
                  onClick={() => onOpenAssignment(task.id)}
                >
                  打开任务
                </Button>
              </>
            )}
            {!task && (
              <p className="text-[11px] text-satin-grey">这是一段独立学习时间。</p>
            )}
          </div>
        </div>
      </aside>
    );
  }

  if (selection.kind === "course") {
    const course = courseById.get(selection.courseId);
    if (!course) return <EmptyInspector onClose={onClose} text="课程已不存在" className={className} />;
    const start = planTimeToMinutes(selection.startTime);
    const end = planTimeToMinutes(selection.endTime);
    return (
      <aside
        aria-label="课程详情"
        className={cn("flex h-full min-h-0 flex-col bg-surface", className)}
        data-testid="plan-inspector"
      >
        <InspectorHeader label="课程" onClose={onClose} />
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <h2 className="text-[16px] font-semibold leading-snug text-charcoal">{course.name}</h2>
          <p className="mt-1 text-[11px] text-sandrift">
            {selection.date} · {selection.startTime}–{selection.endTime}
            {selection.location ? ` · ${selection.location}` : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="rounded-full border border-line bg-background px-2 py-0.5 text-[10px] font-semibold text-satin-grey">
              {course.teacher || "教师未设置"}
            </span>
            {start !== null && end !== null && end > start && (
              <span className="rounded-full border border-line bg-background px-2 py-0.5 text-[10px] font-semibold text-satin-grey">
                {end - start} 分钟
              </span>
            )}
          </div>
          <Button
            variant="primary"
            size="sm"
            className="mt-4 w-full"
            onClick={() => onOpenCourse(course.id)}
          >
            打开课程
          </Button>
        </div>
      </aside>
    );
  }

  const mark = calendarMarks.find((item) => item.id === selection.markId);
  if (!mark) return <EmptyInspector onClose={onClose} text="日程已不存在" className={className} />;
  return (
    <aside
      aria-label="日程详情"
      className={cn("flex h-full min-h-0 flex-col bg-surface", className)}
      data-testid="plan-inspector"
    >
      <InspectorHeader label={mark.type === "exam" ? "考试" : "活动"} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <h2 className="text-[16px] font-semibold leading-snug text-charcoal">{mark.title}</h2>
        <p className="mt-1 text-[11px] text-sandrift">
          {mark.date}
          {mark.startTime && mark.endTime ? ` · ${mark.startTime}–${mark.endTime}` : " · 全天"}
        </p>
        <div className="mt-3 inline-flex items-center gap-1 rounded-full border border-warning-border bg-warning-bg px-2 py-0.5 text-[10px] font-bold text-warning">
          <CalendarDays className="h-3 w-3" /> {mark.type === "exam" ? "考试" : "活动"}
        </div>
        <Button
          variant="primary"
          size="sm"
          className="mt-4 w-full"
          onClick={() => onOpenMark(mark.id)}
        >
          打开日程
        </Button>
      </div>
    </aside>
  );
}

function InspectorHeader({ label, onClose }: { label: string; onClose?: () => void }) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-2.5">
      <span className="text-[11px] font-bold uppercase tracking-wider text-sandrift">{label}</span>
      {onClose && (
        <IconButton variant="ghost" size="sm" aria-label="关闭详情" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </IconButton>
      )}
    </div>
  );
}

function EmptyInspector({
  onClose,
  text,
  className,
}: {
  onClose: () => void;
  text: string;
  className?: string;
}) {
  return (
    <aside
      aria-label="详情"
      className={cn("flex h-full min-h-0 flex-col bg-surface", className)}
      data-testid="plan-inspector"
    >
      <InspectorHeader label="详情" onClose={onClose} />
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <p className="text-sm text-satin-grey">{text}</p>
      </div>
    </aside>
  );
}

function formatDeadline(date: Date, now: Date): string {
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(
    2,
    "0"
  )}`;
  if (date.toDateString() === now.toDateString()) return `今天 ${time}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}
