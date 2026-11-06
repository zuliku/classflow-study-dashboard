"use client";

import React from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, Clock, Info, Repeat2 } from "lucide-react";
import { Assignment, AssignmentStatus, Priority } from "@/types";
import { UISelect } from "@/components/ui/Select";
import { cn } from "@/lib/utils";
import {
  DeadlineView,
  ReminderSummary,
  StudyScheduleSummary,
  formatReminderSummaryText,
  formatScheduleSummaryText,
} from "@/lib/tasks/assignmentDetailView";

const STATUS_LABELS: Record<AssignmentStatus, string> = {
  todo: "待完成",
  doing: "进行中",
  submitted: "等待反馈",
  completed: "已完成",
};

const STATUS_CLASSES: Record<AssignmentStatus, string> = {
  todo: "border-line bg-white text-satin-grey",
  doing: "border-line bg-pastel-mint text-charcoal",
  submitted: "border-warning-border bg-warning-bg text-warning",
  completed: "border-success-border bg-success-bg text-success",
};

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: "urgent", label: "紧急" },
  { value: "high", label: "高" },
  { value: "medium", label: "中" },
  { value: "low", label: "低" },
];

const PRIORITY_DOT: Record<Priority, string> = {
  urgent: "#9B5B57",
  high: "#A87952",
  medium: "#A48F82",
  low: "#627566",
};

/**
 * Assignment Detail Hero（Task/DDL Detail Panel 首屏核心）：
 * Deadline / Remaining 是最强视觉层级；Status / Priority 为 compact controls；
 * Health 降为轻量 contextual signal；Schedule / Reminder 为一行摘要。
 */
export function AssignmentDetailHero({
  assignment,
  deadline,
  scheduleSummary,
  reminderSummary,
  healthLabel,
  healthClassName,
  healthHint,
  recurrenceLabel,
  onPriorityChange,
}: {
  assignment: Assignment;
  deadline: DeadlineView;
  scheduleSummary: StudyScheduleSummary;
  reminderSummary: ReminderSummary;
  healthLabel: string;
  healthClassName: string;
  healthHint: string | null;
  /** 重复规则中文标签（如 每周）；无 recurrence → undefined */
  recurrenceLabel?: string;
  onPriorityChange: (priority: Priority) => void;
}) {
  return (
    <div className="rounded-2xl border border-line bg-[#F7F5F5] p-4">
      {/* Deadline + compact status/priority */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-sandrift">
            <Clock className="h-3 w-3 text-[#A48F82]" />
            截止时间
          </p>
          <p
            className={cn(
              "text-[17px] font-bold leading-snug",
              deadline.hasDdl ? "text-charcoal" : "text-satin-grey/70"
            )}
          >
            {deadline.primary}
          </p>
          {deadline.hasDdl && deadline.relative && (
            <p
              className={cn(
                "text-[12px] font-semibold",
                deadline.overdue ? "text-danger" : "text-satin-grey"
              )}
            >
              {deadline.overdue && <AlertTriangle className="mr-1 inline h-3 w-3" />}
              {deadline.relative}
              {recurrenceLabel && (
                <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-semibold text-sandrift">
                  <Repeat2 className="h-3 w-3" />
                  {recurrenceLabel}
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span
            className={cn(
              "inline-flex h-7 items-center rounded-lg border px-2 text-[11px] font-bold",
              STATUS_CLASSES[assignment.status]
            )}
          >
            {STATUS_LABELS[assignment.status]}
          </span>
          <UISelect<Priority>
            value={assignment.priority}
            onChange={onPriorityChange}
            ariaLabel="优先级"
            options={PRIORITY_OPTIONS}
            triggerClassName="h-7 bg-white border-line-strong text-[11px] font-semibold rounded-lg"
          />
        </div>
      </div>

      {/* Health contextual signal（轻量一行，不再独立卡片） */}
      {healthHint && (
        <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-satin-grey">
          <Info className="h-3 w-3 shrink-0 text-[#A48F82]" />
          <span
            className={cn(
              "shrink-0 rounded-full border px-1.5 py-px text-[10px] font-bold",
              healthClassName
            )}
          >
            {healthLabel}
          </span>
          <span className="min-w-0 leading-snug">{healthHint}</span>
        </div>
      )}

      {/* Schedule / Reminder 摘要（首屏上下文，不进 disclosure） */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-soft pt-2.5 text-[11px] font-semibold text-satin-grey">
        <span className="flex items-center gap-1">
          <CalendarDays className="h-3 w-3 text-[#A48F82]" />
          {formatScheduleSummaryText(scheduleSummary, assignment.estimatedMinutes)}
        </span>
        <span className="flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-[#A48F82]" />
          {formatReminderSummaryText(reminderSummary)}
        </span>
      </div>
    </div>
  );
}
