"use client";

import React, { useEffect } from "react";
import {
  X,
  Clock,
  CheckSquare,
  Square,
  Trash2,
  BookOpen,
  Edit3,
  ChevronRight,
  CalendarClock,
  Tags,
  CalendarDays,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { Priority, AssignmentStatus } from "@/types";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { parseLocalDDL } from "@/lib/ddl";
import { formatEstimatedMinutes } from "@/lib/tasks/taskSemantics";
import { deriveAssignmentHealthWithAvailability, healthViewMeta, healthExplanation } from "@/lib/tasks/taskHealthView";
import { usePresence } from "@/lib/usePresence";
import { useRestoreFocus } from "@/lib/useRestoreFocus";
import { cn } from "@/lib/utils";
import { openAssignmentEditor } from "@/lib/uiEvents";
import { pushOverlay, popOverlay, isTopmostOverlay } from "@/lib/overlayStack";
import { useKiroHandoff } from "@/hooks/useKiroHandoff";
import { KIRO_ICON } from "@/components/layout/navItems";
import { KiroFlowButton } from "@/components/kiro/KiroFlow";

const OVERLAY_ID = "assignment-drawer";

/** Kiro Contextual Quick Prompts（deterministic，非 AI 生成） */
const QUICK_PROMPTS: { label: string; prompt: string }[] = [
  { label: "帮我拆解这个任务", prompt: "帮我拆解这个任务，列出可以并行推进的步骤。" },
  { label: "检查能否按时完成", prompt: "检查这个任务能否按时完成，并说明原因。" },
  { label: "帮我安排学习时间", prompt: "帮我安排这个任务的学习时间。" },
];

export function AssignmentDrawer() {
  const {
    assignments,
    courses,
    schedules,
    calendarMarks,
    semester,
    currentSemesterWeek,
    studyBlocks,
    selectedAssignmentId,
    setSelectedAssignmentId,
    setSelectedCourseId,
    setActiveTab,
    updateAssignmentStatus,
    updateAssignmentProgress,
    updateAssignmentPriority,
    toggleSubtask,
    deleteAssignment,
    restoreAssignment,
  } = useAppStore();
  const pushToast = useToastStore((s) => s.pushToast);
  const handoff = useKiroHandoff();

  const assignment = assignments.find((a) => a.id === selectedAssignmentId);
  const { mounted, visible } = usePresence(!!assignment, 260);
  useRestoreFocus(!!assignment);

  // Overlay Stack：Drawer 层，Esc 只在最上层时关闭
  useEffect(() => {
    if (!mounted) return;
    pushOverlay(OVERLAY_ID, 40);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopmostOverlay(OVERLAY_ID)) setSelectedAssignmentId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      popOverlay(OVERLAY_ID);
      window.removeEventListener("keydown", onKey);
    };
  }, [mounted, setSelectedAssignmentId]);

  if (!mounted || !assignment) return null;

  const handleDelete = () => {
    const removed = deleteAssignment(assignment.id);
    if (removed) {
      pushToast({
        message: "任务已删除",
        actionLabel: "撤销",
        onAction: () => restoreAssignment(removed.assignment, removed.marks),
      });
    }
  };

  // 返回链路：任务 → 课程 Drawer
  const handleOpenCourse = () => {
    if (!course) return;
    setSelectedAssignmentId(null);
    setSelectedCourseId(course.id);
  };

  const handleEdit = () => {
    openAssignmentEditor({ assignmentId: assignment.id });
  };

  // Ask Kiro：固定 Entry Context → 关闭 Drawer → 打开 Sidecar（保持当前 Workspace）
  const handleAskKiro = () => {
    handoff.openForAssignment(assignment.id);
    setSelectedAssignmentId(null);
  };

  const handleQuickPrompt = (prompt: string) => {
    handoff.openForAssignment(assignment.id);
    handoff.handoffPrompt(prompt);
    setSelectedAssignmentId(null);
  };

  const handleViewInTimeline = () => {
    setSelectedAssignmentId(null);
    setActiveTab("timetable");
  };

  const course = courses.find((c) => c.id === assignment.courseId);

  // ---- Task V2 Detail ----
  const parsedDDL = parseLocalDDL(assignment.ddl);
  const formattedDDL = parsedDDL
    ? format(parsedDDL, "yyyy年M月d日 · HH:mm", { locale: zhCN })
    : "未设置截止时间";

  const health = deriveAssignmentHealthWithAvailability(
    assignment,
    studyBlocks,
    { schedules, calendarMarks, semester, currentSemesterWeek },
    new Date()
  );
  const healthMeta = healthViewMeta(health.state);
  const healthHint = healthExplanation(health);

  const blocks = studyBlocks.filter((b) => b.assignmentId === assignment.id);
  const scheduledMinutes = blocks.reduce((sum, b) => {
    const s = b.startTime ? Number(b.startTime.slice(0, 2)) * 60 + Number(b.startTime.slice(3, 5)) : null;
    const e = b.endTime ? Number(b.endTime.slice(0, 2)) * 60 + Number(b.endTime.slice(3, 5)) : null;
    if (s === null || e === null || e <= s) return sum;
    return sum + (e - s);
  }, 0);

  return (
    <div
      className={cn(
        "fixed inset-0 z-40 overflow-hidden bg-black/30 backdrop-blur-sm flex justify-end",
        "ux-overlay",
        visible ? "opacity-100" : "opacity-0"
      )}
    >
      <div
        className={cn(
          "w-full max-w-lg bg-surface h-full shadow-drawer flex flex-col border-l border-line overflow-y-auto pb-[env(safe-area-inset-bottom)]",
          "ux-drawer-panel",
          visible ? "translate-x-0 opacity-100" : "translate-x-8 opacity-0"
        )}
      >
        {/* HEADER：课程 + 标题 + 关闭 */}
        <div className="p-5 border-b border-[#F0EBE1] bg-[#F7F5F5] flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            {course ? (
              <button
                onClick={handleOpenCourse}
                className="text-xs font-semibold text-sandrift flex items-center gap-1 group"
                title="查看课程"
              >
                <BookOpen className="w-3.5 h-3.5 mr-1 text-[#A48F82]" />
                <span className="group-hover:text-charcoal group-hover:underline transition-colors truncate">
                  {course.name}
                </span>
                <ChevronRight className="w-3 h-3 text-[#CDB9AB] transition-transform duration-[var(--motion-fast)] group-hover:translate-x-px group-hover:text-sandrift" />
              </button>
            ) : (
              <span className="text-xs font-semibold text-sandrift flex items-center">
                <BookOpen className="w-3.5 h-3.5 mr-1 text-[#A48F82]" />
                常规任务
              </span>
            )}
            <h2 className="text-lg font-bold text-charcoal leading-snug break-words">
              {assignment.title}
            </h2>
          </div>
          <button
            onClick={() => setSelectedAssignmentId(null)}
            className="p-2 rounded-xl bg-white hover:bg-alabaster text-charcoal border border-line-strong transition-colors shrink-0"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 flex-1">
          {/* STATUS STRIP：状态 + 优先级 + Health */}
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-sandrift uppercase tracking-wider">任务状态</label>
                <select
                  value={assignment.status}
                  onChange={(e) => updateAssignmentStatus(assignment.id, e.target.value as AssignmentStatus)}
                  className="w-full text-xs font-medium bg-[#F7F5F5] border border-line rounded-xl p-2.5 text-charcoal focus:outline-none cursor-pointer"
                >
                  <option value="todo">待完成</option>
                  <option value="doing">进行中</option>
                  <option value="submitted">已提交</option>
                  <option value="completed">已完成</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-sandrift uppercase tracking-wider">优先级</label>
                <select
                  value={assignment.priority}
                  onChange={(e) => updateAssignmentPriority(assignment.id, e.target.value as Priority)}
                  className="w-full text-xs font-medium bg-[#F7F5F5] border border-line rounded-xl p-2.5 text-charcoal focus:outline-none cursor-pointer"
                >
                  <option value="urgent">紧急</option>
                  <option value="high">高</option>
                  <option value="medium">中</option>
                  <option value="low">低</option>
                </select>
              </div>
            </div>

            {/* Deadline Health（muted palette；解释数字全部来自 Health Result） */}
            <div className="flex items-start gap-2.5 p-3 bg-[#F7F5F5] border border-line rounded-xl">
              <span className={cn("mt-0.5 text-[10px] px-2 py-0.5 rounded-full font-bold border shrink-0", healthMeta.className)}>
                {healthMeta.label}
              </span>
              {healthHint && (
                <p className="text-[11px] text-satin-grey leading-snug">{healthHint}</p>
              )}
            </div>
          </div>

          {/* PLAN：截止 / 预计耗时 / 已安排 */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-[#F7F5F5] border border-line rounded-xl">
                <p className="flex items-center gap-1.5 text-[10px] font-bold text-sandrift uppercase tracking-wider">
                  <Clock className="w-3 h-3 text-[#A48F82]" />
                  截止时间
                </p>
                <p className={cn("mt-1 text-xs font-semibold font-mono", parsedDDL ? "text-charcoal" : "text-satin-grey/70")}>
                  {formattedDDL}
                </p>
              </div>
              <div className="p-3 bg-[#F7F5F5] border border-line rounded-xl">
                <p className="flex items-center gap-1.5 text-[10px] font-bold text-sandrift uppercase tracking-wider">
                  <CalendarClock className="w-3 h-3 text-[#A48F82]" />
                  预计耗时
                </p>
                <p className={cn("mt-1 text-xs font-semibold", assignment.estimatedMinutes ? "text-charcoal" : "text-satin-grey/70")}>
                  {assignment.estimatedMinutes ? formatEstimatedMinutes(assignment.estimatedMinutes) : "未估时"}
                </p>
              </div>
            </div>

            {/* StudyBlock Summary */}
            <div className="p-3 bg-[#F7F5F5] border border-line rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-[10px] font-bold text-sandrift uppercase tracking-wider">
                  <CalendarDays className="w-3 h-3 text-[#A48F82]" />
                  学习安排
                </p>
                {scheduledMinutes > 0 && (
                  <span className="text-[11px] font-bold text-charcoal">
                    已安排 {formatEstimatedMinutes(scheduledMinutes)}
                    {assignment.estimatedMinutes ? ` / 预计 ${formatEstimatedMinutes(assignment.estimatedMinutes)}` : ""}
                  </span>
                )}
              </div>

              {blocks.length > 0 ? (
                <>
                  <div className="space-y-1">
                    {blocks.map((b) => (
                      <div key={b.id} className="flex items-center justify-between text-[11px]">
                        <span className="text-satin-grey">{b.date.slice(5).replace("-", "月")}日</span>
                        <span className="font-mono text-charcoal font-semibold">
                          {b.startTime}–{b.endTime}
                        </span>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={handleViewInTimeline}
                    className="text-[11px] font-semibold text-satin-grey hover:text-charcoal transition-colors"
                  >
                    在时间表中查看 →
                  </button>
                </>
              ) : (
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <span className="text-[11px] text-satin-grey/70">尚未安排学习时间</span>
                  <button
                    onClick={handleViewInTimeline}
                    className="text-[11px] font-semibold text-satin-grey hover:text-charcoal transition-colors"
                  >
                    在时间表中安排
                  </button>
                  <span className="text-sandrift">·</span>
                  <button
                    onClick={() => handleQuickPrompt(QUICK_PROMPTS[2].prompt)}
                    className="text-[11px] font-semibold text-satin-grey hover:text-charcoal transition-colors"
                  >
                    Ask Kiro
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* EXECUTION：Progress + Subtasks */}
          <div className="space-y-4">
            <div className="space-y-2 bg-[#F7F5F5] border border-line p-3.5 rounded-xl">
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-sandrift uppercase tracking-wider">完成进度</span>
                <span className="font-bold text-charcoal">{assignment.progress}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={assignment.progress}
                onChange={(e) => updateAssignmentProgress(assignment.id, parseInt(e.target.value))}
                className="w-full h-2 bg-line-strong rounded-lg appearance-none cursor-pointer accent-charcoal"
              />
            </div>

            {assignment.subtasks && assignment.subtasks.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-[10px] font-bold text-sandrift uppercase tracking-wider">
                  子任务清单 ({assignment.subtasks.filter((st) => st.completed).length} / {assignment.subtasks.length})
                </h4>
                <div className="space-y-1.5">
                  {assignment.subtasks.map((st) => (
                    <div
                      key={st.id}
                      onClick={() => toggleSubtask(assignment.id, st.id)}
                      className="flex items-center space-x-2.5 p-2.5 bg-[#F7F5F5] hover:bg-alabaster/60 border border-line rounded-xl text-xs cursor-pointer transition-colors"
                    >
                      {st.completed ? (
                        <CheckSquare className="w-4 h-4 text-success shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-[#A48F82] shrink-0" />
                      )}
                      <span className={cn("flex-1 text-charcoal", st.completed ? "line-through text-sandrift" : "font-medium")}>
                        {st.title}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* CONTENT：Description + Tags */}
          <div className="space-y-3">
            {assignment.description && (
              <div className="space-y-1.5">
                <h4 className="text-[10px] font-bold text-sandrift uppercase tracking-wider">任务说明</h4>
                <p className="text-xs text-charcoal bg-alabaster/40 border border-line-strong rounded-xl p-3.5 leading-relaxed whitespace-pre-wrap">
                  {assignment.description}
                </p>
              </div>
            )}
            {assignment.tags.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="flex items-center gap-1.5 text-[10px] font-bold text-sandrift uppercase tracking-wider">
                  <Tags className="w-3 h-3 text-[#A48F82]" />
                  标签
                </h4>
                <div className="flex flex-wrap gap-1">
                  {assignment.tags.map((t) => (
                    <span key={t} className="text-[10px] font-semibold text-satin-grey bg-[#F7F5F5] border border-line px-1.5 py-0.5 rounded">
                      #{t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer：Quick Prompts + Actions */}
        <div className="p-4 border-t border-[#F0EBE1] bg-[#F7F5F5] space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {QUICK_PROMPTS.map((q) => (
              <button
                key={q.label}
                onClick={() => handleQuickPrompt(q.prompt)}
                className="text-[10px] font-semibold text-satin-grey bg-white border border-line rounded-lg px-2 py-1 hover:text-charcoal hover:border-line-strong transition-colors"
              >
                {q.label}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-1">
              <button
                onClick={handleDelete}
                className="flex items-center space-x-1.5 text-xs text-danger hover:bg-danger-bg px-3 py-2 rounded-xl transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                <span>删除任务</span>
              </button>
              <KiroFlowButton
                icon={KIRO_ICON}
                label="Ask Kiro"
                size="sm"
                className="h-8"
                onClick={handleAskKiro}
              />
              <button
                onClick={handleEdit}
                className="flex items-center space-x-1.5 text-xs text-satin-grey hover:bg-alba px-3 py-2 rounded-xl transition-colors"
                title="编辑任务"
              >
                <Edit3 className="w-4 h-4" />
                <span>编辑</span>
              </button>
            </div>
            <button
              onClick={() => setSelectedAssignmentId(null)}
              className="px-4 py-2 bg-charcoal text-white text-xs font-medium rounded-xl hover:bg-black transition-colors"
            >
              完成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
