"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Clock, GripVertical, Plus, X } from "lucide-react";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import type { TaskProjectionItem } from "@/lib/tasks/taskProjections";
import type { PlanBacklogGroup, PlanBacklogGroupId } from "@/lib/plan/planTypes";
import { formatEstimatedMinutes } from "@/lib/tasks/taskSemantics";
import { cn } from "@/lib/utils";
import type { Course } from "@/types";

const GROUP_TONE: Record<PlanBacklogGroupId, string> = {
  overdue: "bg-danger",
  dueThisWeek: "bg-warning",
  needsScheduling: "bg-sandrift",
};

export function PlanBacklog({
  groups,
  courseById,
  now,
  draggingId,
  onSelect,
  onArrange,
  onDragStart,
  onDragEnd,
  onClose,
  onAddTask,
  className,
}: {
  groups: PlanBacklogGroup[];
  courseById: Map<string, Course>;
  now: Date;
  draggingId: string | null;
  onSelect: (item: TaskProjectionItem) => void;
  onArrange: (item: TaskProjectionItem) => void;
  onDragStart: (item: TaskProjectionItem) => void;
  onDragEnd: () => void;
  onClose?: () => void;
  onAddTask: () => void;
  className?: string;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const total = useMemo(() => groups.reduce((sum, group) => sum + group.items.length, 0), [groups]);

  return (
    <aside
      aria-label="待安排任务"
      data-testid="plan-backlog"
      className={cn("flex h-full min-h-0 w-full flex-col bg-surface", className)}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold tracking-tight text-charcoal">待安排</h2>
          <p className="mt-0.5 text-[11px] text-sandrift">{total} 项任务</p>
        </div>
        <IconButton variant="ghost" size="sm" aria-label="新建任务" onClick={onAddTask}>
          <Plus className="h-3.5 w-3.5" />
        </IconButton>
        {onClose && (
          <IconButton variant="ghost" size="sm" aria-label="关闭待安排" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </IconButton>
        )}
      </div>

      {total === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center">
          <Clock className="h-5 w-5 text-sandrift" />
          <p className="text-sm font-semibold text-charcoal">没有待安排任务</p>
          <p className="text-xs text-satin-grey">任务排满后会从这里消失。</p>
          <Button variant="secondary" className="mt-2" size="sm" onClick={onAddTask}>
            新建任务
          </Button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pb-4" data-testid="plan-backlog-scroll">
          {groups.map((group) => {
            const open = collapsed[group.id] !== true;
            if (group.items.length === 0) return null;
            return (
              <section key={group.id} aria-labelledby={`plan-backlog-${group.id}`}>
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((current) => ({ ...current, [group.id]: !current[group.id] }))
                  }
                  aria-expanded={open}
                  aria-controls={`plan-backlog-body-${group.id}`}
                  className="sticky top-0 z-10 flex w-full items-center gap-2 border-b border-line-soft bg-surface px-4 py-2 text-left transition-colors hover:bg-alabaster/50"
                >
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 text-sandrift transition-transform duration-[var(--motion-fast)]",
                      !open && "-rotate-90"
                    )}
                  />
                  <span className={cn("h-1.5 w-1.5 rounded-full", GROUP_TONE[group.id])} />
                  <span
                    id={`plan-backlog-${group.id}`}
                    className="text-[11px] font-bold text-charcoal"
                  >
                    {group.title}
                  </span>
                  <span className="text-[11px] tabular-nums text-sandrift">
                    {group.items.length}
                  </span>
                </button>
                <DisclosureRegion open={open} id={`plan-backlog-body-${group.id}`}>
                  <div className="divide-y divide-line-soft">
                    {group.items.map((item) => (
                      <PlanBacklogRow
                        key={item.task.id}
                        item={item}
                        course={courseById.get(item.task.courseId)}
                        now={now}
                        dragging={draggingId === item.task.id}
                        onSelect={() => onSelect(item)}
                        onArrange={() => onArrange(item)}
                        onDragStart={() => onDragStart(item)}
                        onDragEnd={onDragEnd}
                      />
                    ))}
                  </div>
                </DisclosureRegion>
              </section>
            );
          })}
        </div>
      )}
    </aside>
  );
}

function PlanBacklogRow({
  item,
  course,
  now,
  dragging,
  onSelect,
  onArrange,
  onDragStart,
  onDragEnd,
}: {
  item: TaskProjectionItem;
  course?: Course;
  now: Date;
  dragging: boolean;
  onSelect: () => void;
  onArrange: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const { task, meta } = item;
  const deadlineLabel = describeDeadline(meta, now);
  const remainingLabel =
    meta.remainingMinutes === null
      ? "未估时"
      : meta.remainingMinutes > 0
        ? `剩余 ${formatEstimatedMinutes(meta.remainingMinutes) ?? "0 分钟"}`
        : "已排满";

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      data-testid="plan-backlog-row"
      data-assignment-id={task.id}
      aria-label={`安排《${task.title}》`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("text/plain", task.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "group flex min-h-16 cursor-grab items-center gap-2 px-3 py-2 transition-[background-color,opacity] duration-[var(--motion-fast)] hover:bg-alabaster/50 active:cursor-grabbing",
        dragging && "opacity-40"
      )}
    >
      <GripVertical className="h-3.5 w-3.5 shrink-0 text-sandrift/60" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          {meta.overdue && <AlertTriangle className="h-3 w-3 shrink-0 text-danger" />}
          <span className="truncate text-[13px] font-semibold text-charcoal">{task.title}</span>
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-sandrift">
          {course && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: course.bgHex }}
              />
              <span className="truncate">{course.name}</span>
            </span>
          )}
          <span className={cn("shrink-0", meta.overdue && "font-semibold text-danger")}>
            {deadlineLabel}
          </span>
          <span className="shrink-0">{remainingLabel}</span>
        </span>
      </span>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onArrange();
        }}
        aria-label={`安排《${task.title}》`}
        className="ux-press shrink-0 rounded-lg border border-line bg-surface px-2 py-1 text-[10px] font-bold text-satin-grey opacity-100 transition-[opacity,background-color,color] duration-[var(--motion-fast)] hover:bg-alabaster hover:text-charcoal md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
      >
        安排
      </button>
    </div>
  );
}

function describeDeadline(
  meta: TaskProjectionItem["meta"],
  now: Date
): string {
  if (meta.overdue) return "已逾期";
  if (!meta.deadline) return "未设截止";
  const deadline = meta.deadline;
  const time = `${String(deadline.getHours()).padStart(2, "0")}:${String(
    deadline.getMinutes()
  ).padStart(2, "0")}`;
  if (meta.deadlineToday) return `今天 ${time}`;
  const sameYear = deadline.getFullYear() === now.getFullYear();
  return sameYear
    ? `${deadline.getMonth() + 1}月${deadline.getDate()}日`
    : `${deadline.getFullYear()}/${deadline.getMonth() + 1}/${deadline.getDate()}`;
}
