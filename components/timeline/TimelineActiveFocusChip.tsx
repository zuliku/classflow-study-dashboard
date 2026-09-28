"use client";

import React, { useRef } from "react";
import { Pause, Timer } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useFocusClock } from "@/hooks/useFocusClock";
import { usePresence } from "@/lib/usePresence";
import { MOTION_EXIT_MS } from "@/lib/motion";
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
 * - quiet（Header L1 状态层）：去边框 pill，收敛为“圆点 + 文字”安静状态，
 *   不再长得像操作控件；presence/退出快照逻辑与默认形态一致
 */
export function TimelineActiveFocusChip({ quiet = false }: { quiet?: boolean }) {
  const active =
    useAppStore(
      (s) => s.focusSessions.find((f) => f.status === "running" || f.status === "paused") ?? null
    );
  const assignments = useAppStore((s) => s.assignments);
  const courses = useAppStore((s) => s.courses);
  const setSelectedAssignmentId = useAppStore((s) => s.setSelectedAssignmentId);
  const setSelectedCourseId = useAppStore((s) => s.setSelectedCourseId);

  const { remainingText } = useFocusClock(active);
  // 进退场 presence（fast 档）：出现/消失做 opacity + 轻 scale，不再挤压 Header 布局；
  // 退出 110ms 内保留最后一次快照内容（仅视觉淡出，不读新 store）。
  const { mounted, visible } = usePresence(!!active, MOTION_EXIT_MS.fast);
  const snapshotRef = useRef<{
    running: boolean;
    remainingText: string;
    targetLabel: string;
    interactive: boolean;
    openTarget: () => void;
  } | null>(null);

  const linkedAssignment = active?.assignmentId
    ? assignments.find((a) => a.id === active.assignmentId)
    : undefined;
  // label 优先级：有效 Assignment.title → title snapshot → 有效 Course.name → course snapshot → 未关联
  const linkedCourse = active?.courseId ? courses.find((c) => c.id === active.courseId) : undefined;
  const interactive = Boolean(linkedAssignment || linkedCourse);
  const openTarget = () => {
    if (linkedAssignment) {
      setSelectedAssignmentId(linkedAssignment.id); // global owner：留在 Timeline 上下文
      return;
    }
    if (linkedCourse) setSelectedCourseId(linkedCourse.id);
    // 都不存在：只读 chip，不导航
  };

  if (active) {
    snapshotRef.current = {
      running: active.status === "running",
      remainingText,
      targetLabel:
        linkedAssignment?.title ??
        active.assignmentTitleSnapshot ??
        linkedCourse?.name ??
        active.courseNameSnapshot ??
        "未关联专注",
      interactive,
      openTarget,
    };
  }
  const shown = active
    ? {
        running: active.status === "running",
        remainingText,
        targetLabel: snapshotRef.current?.targetLabel ?? "未关联专注",
        interactive,
        openTarget,
      }
    : snapshotRef.current
      ? { ...snapshotRef.current, interactive: false }
      : null;
  if (!mounted || !shown) return null;
  const { running, targetLabel, interactive: shownInteractive, openTarget: shownOpen } = shown;

  return (
    <button
      type="button"
      data-testid="timeline-active-focus-chip"
      onClick={shownInteractive ? shownOpen : undefined}
      disabled={!shownInteractive}
      aria-label={`当前专注：${targetLabel}${running ? `，剩余 ${shown.remainingText}` : "（已暂停）"}`}
      title={`当前专注 · ${targetLabel}`}
      className={cn(
        // h-8 与 Header 右区其他按钮同高同基线；标题收紧，避免最宽元素挤压
        "flex h-8 items-center gap-1.5 text-left",
        quiet
          // L1 状态层：无边框 pill（max 180px 截断），只做状态表达
          ? "max-w-[180px] px-1"
          : "max-w-[220px] rounded-full border px-2.5",
        // 进退场：opacity + 轻 scale（fast 进入 / exit 加速离场）
        "transition-[color,background-color,border-color,opacity,transform] duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
        visible
          ? "opacity-100 scale-100"
          : "opacity-0 scale-95 pointer-events-none !duration-[var(--motion-exit-fast)] !ease-[var(--ease-exit)]",
        !quiet &&
          (running
            ? "border-pastel-mint bg-pastel-mint/25 hover:bg-pastel-mint/40"
            : "border-line bg-alabaster/70 hover:bg-alabaster")
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
        {shown.remainingText} · {running ? "专注中" : "已暂停"}
      </span>
      <span className="min-w-0 max-w-[88px] truncate text-[11px] font-semibold text-satin-grey">
        {targetLabel}
      </span>
    </button>
  );
}
