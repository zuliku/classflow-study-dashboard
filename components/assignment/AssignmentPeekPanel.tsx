"use client";

import React from "react";
import { X, BookOpen, CheckCircle2, Clock, Flag, ListChecks, CalendarClock, Tags } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { usePresence } from "@/lib/usePresence";
import { getPriorityMeta } from "@/lib/utils";
import { getLocalDDLDate, getLocalDDLTime, parseLocalDDL } from "@/lib/ddl";
import { formatEstimatedMinutes } from "@/lib/tasks/taskSemantics";
import { deriveAssignmentHealthWithAvailability, healthViewMeta, healthExplanation } from "@/lib/tasks/taskHealthView";
import { cn } from "@/lib/utils";

/**
 * Assignment Peek（Task V2）：桌面 Quick Look 风格的紧凑侧预览。
 * 「看，而不是编辑」——完整编辑仍在 Drawer（Enter）。
 * 包含：submitted 状态 / 未设 DDL / 预计耗时 / 已计划 StudyBlock / Tags / Deadline Health。
 */
export function AssignmentPeekPanel() {
  const {
    assignmentPeekId,
    setAssignmentPeekId,
    assignments,
    courses,
    studyBlocks,
    schedules,
    calendarMarks,
    semester,
    currentSemesterWeek,
  } = useAppStore();
  const assignment = assignments.find((a) => a.id === assignmentPeekId) ?? null;

  const { mounted, visible } = usePresence(!!assignment, 200);

  if (!mounted || !assignment) return null;

  const course = courses.find((c) => c.id === assignment.courseId);
  const priorityMeta = getPriorityMeta(assignment.priority);
  const completedSubtasks = assignment.subtasks?.filter((st) => st.completed).length ?? 0;
  const hasDdl = parseLocalDDL(assignment.ddl) !== null;

  // Deadline Health（轻量摘要；数字来自 Health Result）
  const health = deriveAssignmentHealthWithAvailability(
    assignment,
    studyBlocks,
    { schedules, calendarMarks, semester, currentSemesterWeek },
    new Date()
  );
  const healthMeta = healthViewMeta(health.state);
  const healthHint = healthExplanation(health);

  const statusLabel =
    assignment.status === "completed"
      ? "已完成"
      : assignment.status === "submitted"
      ? "已提交"
      : assignment.status === "doing"
      ? "进行中"
      : "待完成";

  const statusTone =
    assignment.status === "completed" || assignment.status === "submitted"
      ? "text-success"
      : assignment.status === "doing"
      ? "text-[#A87952]"
      : "text-satin-grey";

  const scheduleBlocks = studyBlocks.filter((b) => b.assignmentId === assignment.id);

  return (
    <aside
      data-testid="assignment-peek"
      className={cn(
        "fixed right-0 top-24 bottom-24 w-80 z-30 bg-surface border-l border-line shadow-drawer rounded-l-2xl flex flex-col overflow-hidden ux-drawer-panel",
        visible ? "translate-x-0 opacity-100" : "translate-x-8 opacity-0"
      )}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-line-strong bg-[#F7F5F5] flex items-center justify-between shrink-0">
        <div className="min-w-0">
          <p className="text-[10px] font-bold text-sandrift uppercase tracking-wider">
            快速预览
          </p>
          <h3 className="text-sm font-bold text-charcoal truncate">{assignment.title}</h3>
        </div>
        <button
          onClick={() => setAssignmentPeekId(null)}
          className="p-1.5 rounded-lg text-sandrift hover:bg-alabaster transition-colors shrink-0"
          aria-label="关闭预览"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-xs">
        {/* 课程 / 状态 / 优先级 / DDL / 预计耗时 */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-satin-grey">
            <BookOpen className="w-3.5 h-3.5 text-[#A48F82] shrink-0" />
            <span className="truncate font-semibold text-charcoal">
              {course?.name || "通用"}
            </span>
          </div>
          <div className="flex items-center gap-2 text-satin-grey">
            <CheckCircle2 className={cn("w-3.5 h-3.5 shrink-0", statusTone)} />
            <span className={cn("font-semibold", statusTone)}>{statusLabel}</span>
          </div>
          <div className="flex items-center gap-2 text-satin-grey">
            <Flag className="w-3.5 h-3.5 text-[#A48F82] shrink-0" />
            <span
              className={cn(
                "text-[10px] px-1.5 py-0.5 rounded font-bold border",
                priorityMeta.bg,
                priorityMeta.text,
                priorityMeta.border
              )}
            >
              {priorityMeta.label}
            </span>
          </div>
          <div className="flex items-center gap-2 text-satin-grey">
            <Clock className="w-3.5 h-3.5 text-[#A48F82] shrink-0" />
            <span className={hasDdl ? "" : "text-satin-grey/70"}>
              截止 {hasDdl ? `${getLocalDDLDate(assignment.ddl)} ${getLocalDDLTime(assignment.ddl)}` : "未设置"}
            </span>
          </div>
          {assignment.estimatedMinutes && (
            <div className="flex items-center gap-2 text-satin-grey">
              <CalendarClock className="w-3.5 h-3.5 text-[#A48F82] shrink-0" />
              <span>预计 {formatEstimatedMinutes(assignment.estimatedMinutes)}</span>
            </div>
          )}
        </div>

        {/* Deadline Health（轻量摘要） */}
        <div className="pt-2 border-t border-line-soft">
          <div className="flex items-start gap-2">
            <span className={cn("mt-0.5 text-[9px] px-1.5 py-0.5 rounded-full font-bold border shrink-0", healthMeta.className)}>
              {healthMeta.label}
            </span>
            {healthHint && (
              <p className="text-[10px] text-satin-grey leading-snug">{healthHint}</p>
            )}
          </div>
        </div>

        {/* 已计划 StudyBlock（Timeline V1 集成） */}
        {scheduleBlocks.length > 0 && (
          <div className="pt-2 border-t border-line-soft">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-charcoal mb-1.5">
              <CalendarClock className="w-3.5 h-3.5 text-[#A48F82]" />
              已计划 {scheduleBlocks.length} 段
            </p>
            <div className="space-y-1">
              {scheduleBlocks.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between text-[11px] text-satin-grey bg-[#F7F5F5] border border-line rounded-lg px-2 py-1"
                >
                  <span className="font-semibold text-charcoal">
                    {b.date.slice(5).replace("-", " / ")}
                  </span>
                  <span className="font-mono">
                    {b.startTime.slice(0, 5)}–{b.endTime.slice(0, 5)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 进度 */}
        <div className="pt-2 border-t border-line-soft">
          <div className="flex justify-between text-[10px] text-sandrift mb-1">
            <span>进度</span>
            <span className="font-bold text-charcoal">{assignment.progress}%</span>
          </div>
          <div className="w-full bg-alabaster rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-success h-1.5 rounded-full transition-[width] duration-[var(--motion-data)] ease-[var(--ease-emphasized)]"
              style={{ width: `${assignment.progress}%` }}
            />
          </div>
        </div>

        {/* 描述 */}
        {assignment.description && (
          <div className="pt-2 border-t border-line-soft">
            <p className="text-[11px] text-satin-grey leading-relaxed whitespace-pre-wrap line-clamp-4">
              {assignment.description}
            </p>
          </div>
        )}

        {/* Tags */}
        {assignment.tags.length > 0 && (
          <div className="pt-2 border-t border-line-soft">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-charcoal mb-1.5">
              <Tags className="w-3.5 h-3.5 text-[#A48F82]" />
              标签
            </p>
            <div className="flex flex-wrap gap-1">
              {assignment.tags.map((t) => (
                <span
                  key={t}
                  className="text-[10px] font-semibold text-satin-grey bg-[#F7F5F5] border border-line px-1.5 py-0.5 rounded"
                >
                  #{t}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 子任务摘要 */}
        {assignment.subtasks && assignment.subtasks.length > 0 && (
          <div className="pt-2 border-t border-line-soft">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-charcoal mb-1.5">
              <ListChecks className="w-3.5 h-3.5 text-[#A48F82]" />
              子任务 {completedSubtasks} / {assignment.subtasks.length}
            </p>
            <div className="space-y-1">
              {assignment.subtasks.slice(0, 5).map((st) => (
                <div key={st.id} className="flex items-center gap-1.5 text-[11px]">
                  <CheckCircle2
                    className={cn(
                      "w-3 h-3 shrink-0",
                      st.completed ? "text-success" : "text-sandrift"
                    )}
                  />
                  <span
                    className={cn(
                      "truncate",
                      st.completed ? "line-through text-sandrift" : "text-satin-grey"
                    )}
                  >
                    {st.title}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="px-4 py-2 border-t border-line-soft text-[10px] text-sandrift shrink-0">
        Enter 打开完整编辑 · Esc 关闭
      </p>
    </aside>
  );
}
