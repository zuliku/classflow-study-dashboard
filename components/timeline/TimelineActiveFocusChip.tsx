"use client";

import React from "react";
import { Pause, Timer } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useFocusClock } from "@/hooks/useFocusClock";
import { cn } from "@/lib/utils";

/**
 * Workflow UX V10：Timeline Header 的 Active Focus Awareness Chip。
 * - 只在存在 running / paused 会话时渲染；idle return null（不占 Header 空间）
 * - 1s tick 隔离：useFocusClock 只在本组件内调用——TimelineWorkspace 含 TimetableGrid /
 *   StudyBlock / Drag / Ghost，绝不能每秒 rerender（hook 契约见 useFocusClock）
 * - 只做 Awareness + Open Entity：不提供 开始/暂停/继续/结束（控制入口在 Assignment Drawer
 *   的 AssignmentFocusControl，避免复制 Focus Controller）
 * - 点击路由：有效 assignmentId → Global Assignment Drawer（activeTab 保持 timetable）；
 *   任务已删但课程有效 → Course Drawer；都不存在 → 只读状态
 */
export function TimelineActiveFocusChip() {
  const active =
    useAppStore(
      (s) => s.focusSessions.find((f) => f.status === "running" || f.status === "paused") ?? null
    );
  const assignments = useAppStore((s) => s.assignments);
  const courses = useAppStore((s) => s.courses);
  const setSelectedAssignmentId = useAppStore((s) => s.setSelectedAssignmentId);
  const setSelectedCourseId = useAppStore((s) => s.setSelectedCourseId);

  const { remainingText } = useFocusClock(active);

  if (!active) return null;

  const running = active.status === "running";
  const linkedAssignment = active.assignmentId
    ? assignments.find((a) => a.id === active.assignmentId)
    : undefined;
  // label 优先级：有效 Assignment.title → title snapshot → 有效 Course.name → course snapshot → 未关联
  const linkedCourse = active.courseId ? courses.find((c) => c.id === active.courseId) : undefined;
  const targetLabel =
    linkedAssignment?.title ??
    active.assignmentTitleSnapshot ??
    linkedCourse?.name ??
    active.courseNameSnapshot ??
    "未关联专注";

  const openTarget = () => {
    if (linkedAssignment) {
      setSelectedAssignmentId(linkedAssignment.id); // global owner：留在 Timeline 上下文
      return;
    }
    if (linkedCourse) setSelectedCourseId(linkedCourse.id);
    // 都不存在：只读 chip，不导航
  };
  const interactive = Boolean(linkedAssignment || linkedCourse);

  return (
    <button
      type="button"
      data-testid="timeline-active-focus-chip"
      onClick={interactive ? openTarget : undefined}
      disabled={!interactive}
      aria-label={`当前专注：${targetLabel}${running ? `，剩余 ${remainingText}` : "（已暂停）"}`}
      title={`当前专注 · ${targetLabel}`}
      className={cn(
        // h-8 与 Header 右区其他按钮同高同基线；标题收紧，避免最宽元素挤压
        "flex h-8 max-w-[220px] items-center gap-1.5 rounded-full border px-2.5 text-left",
        "transition-colors duration-[var(--motion-fast)]",
        running
          ? "border-pastel-mint bg-pastel-mint/25 hover:bg-pastel-mint/40"
          : "border-line bg-alabaster/70 hover:bg-alabaster"
      )}
    >
      {running ? (
        <Timer className="h-3 w-3 shrink-0 text-[#2E7D5B]" />
      ) : (
        <Pause className="h-3 w-3 shrink-0 text-satin-grey" />
      )}
      <span
        className={cn(
          "shrink-0 text-[11px] font-bold tabular-nums",
          running ? "text-charcoal" : "text-satin-grey"
        )}
      >
        {remainingText} · {running ? "专注中" : "已暂停"}
      </span>
      <span className="min-w-0 max-w-[88px] truncate text-[11px] font-semibold text-satin-grey">
        {targetLabel}
      </span>
    </button>
  );
}
