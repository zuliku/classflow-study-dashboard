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
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { Priority, AssignmentStatus } from "@/types";
import { getDDLStatusText } from "@/lib/utils";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { parseLocalDDL } from "@/lib/ddl";
import { usePresence } from "@/lib/usePresence";
import { useRestoreFocus } from "@/lib/useRestoreFocus";
import { cn } from "@/lib/utils";
import { openAssignmentEditor } from "@/lib/uiEvents";
import { pushOverlay, popOverlay, isTopmostOverlay } from "@/lib/overlayStack";
import { useKiroHandoff } from "@/hooks/useKiroHandoff";
import { KIRO_ICON } from "@/components/layout/navItems";

const OVERLAY_ID = "assignment-drawer";

export function AssignmentDrawer() {
  const {
    assignments,
    courses,
    selectedAssignmentId,
    setSelectedAssignmentId,
    setSelectedCourseId,
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

  const course = courses.find((c) => c.id === assignment.courseId);
  const { text: ddlText, isUrgent } = getDDLStatusText(assignment.ddl);

  let formattedDDL = "";
  const parsedDDL = parseLocalDDL(assignment.ddl);
  if (parsedDDL) {
    formattedDDL = format(parsedDDL, "yyyy年MM月dd日 HH:mm", {
      locale: zhCN,
    });
  } else {
    formattedDDL = assignment.ddl;
  }

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
        {/* Header */}
        <div className="p-6 border-b border-[#F0EBE1] bg-[#F7F5F5] flex items-center justify-between">
          <div className="space-y-1">
            {course ? (
              <button
                onClick={handleOpenCourse}
                className="text-xs font-semibold text-sandrift flex items-center gap-1 group"
                title="查看课程"
              >
                <BookOpen className="w-3.5 h-3.5 mr-1 text-[#A48F82]" />
                <span className="group-hover:text-charcoal group-hover:underline transition-colors">
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
            <h2 className="text-lg font-bold text-charcoal leading-snug">
              {assignment.title}
            </h2>
          </div>
          <button
            onClick={() => setSelectedAssignmentId(null)}
            className="p-2 rounded-xl bg-white hover:bg-alabaster text-charcoal border border-line-strong transition-colors"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 space-y-6 flex-1">
          {/* Status & DDL Banner */}
          <div className="p-4 bg-alabaster/60 border border-line-strong rounded-2xl flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Clock className="w-4 h-4 text-[#A48F82]" />
              <div>
                <p className="text-[10px] text-sandrift">截止时间</p>
                <p className="text-xs font-semibold text-charcoal font-mono">
                  {formattedDDL}
                </p>
              </div>
            </div>
            <span
              className={`text-xs font-bold px-3 py-1 rounded-xl border ${
                isUrgent
                  ? "bg-danger-bg text-danger border-danger-border"
                  : "bg-white text-charcoal border-line-strong"
              }`}
            >
              {ddlText}
            </span>
          </div>

          {/* Status & Priority Selectors */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-sandrift uppercase tracking-wider">
                任务状态
              </label>
              <select
                value={assignment.status}
                onChange={(e) =>
                  updateAssignmentStatus(
                    assignment.id,
                    e.target.value as AssignmentStatus
                  )
                }
                className="w-full text-xs font-medium bg-[#F7F5F5] border border-line rounded-xl p-2.5 text-charcoal focus:outline-none cursor-pointer"
              >
                <option value="todo">待完成 (To Do)</option>
                <option value="doing">进行中 (In Progress)</option>
                <option value="submitted">已提交 (Submitted)</option>
                <option value="completed">已完成 (Completed)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-sandrift uppercase tracking-wider">
                优先级等级
              </label>
              <select
                value={assignment.priority}
                onChange={(e) =>
                  updateAssignmentPriority(
                    assignment.id,
                    e.target.value as Priority
                  )
                }
                className="w-full text-xs font-medium bg-[#F7F5F5] border border-line rounded-xl p-2.5 text-charcoal focus:outline-none cursor-pointer"
              >
                <option value="urgent">紧急 (Urgent)</option>
                <option value="high">高优先 (High)</option>
                <option value="medium">中优先 (Medium)</option>
                <option value="low">低优先 (Low)</option>
              </select>
            </div>
          </div>

          {/* Progress Slider */}
          <div className="space-y-2 bg-[#F7F5F5] border border-line p-4 rounded-2xl">
            <div className="flex justify-between items-center text-xs">
              <span className="font-bold text-sandrift uppercase tracking-wider">
                完成进度
              </span>
              <span className="font-bold text-charcoal">
                {assignment.progress}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={assignment.progress}
              onChange={(e) =>
                updateAssignmentProgress(
                  assignment.id,
                  parseInt(e.target.value)
                )
              }
              className="w-full h-2 bg-line-strong rounded-lg appearance-none cursor-pointer accent-charcoal"
            />
          </div>

          {/* Assignment Description */}
          {assignment.description && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-bold text-sandrift uppercase tracking-wider">
                任务说明
              </h4>
              <p className="text-xs text-charcoal bg-alabaster/40 border border-line-strong rounded-xl p-3.5 leading-relaxed whitespace-pre-wrap">
                {assignment.description}
              </p>
            </div>
          )}

          {/* Subtasks Checklist */}
          {assignment.subtasks && assignment.subtasks.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-sandrift uppercase tracking-wider">
                子任务清单 ({assignment.subtasks.filter((st) => st.completed).length} / {assignment.subtasks.length})
              </h4>
              <div className="space-y-2">
                {assignment.subtasks.map((st) => (
                  <div
                    key={st.id}
                    onClick={() => toggleSubtask(assignment.id, st.id)}
                    className="flex items-center space-x-2.5 p-3 bg-[#F7F5F5] hover:bg-alabaster/60 border border-line rounded-xl text-xs cursor-pointer transition-colors"
                  >
                    {st.completed ? (
                      <CheckSquare className="w-4 h-4 text-success shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-[#A48F82] shrink-0" />
                    )}
                    <span
                      className={`flex-1 text-charcoal ${
                        st.completed ? "line-through text-sandrift" : "font-medium"
                      }`}
                    >
                      {st.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-[#F0EBE1] bg-[#F7F5F5] flex items-center justify-between">
          <div className="flex items-center space-x-1">
            <button
              onClick={handleDelete}
              className="flex items-center space-x-1.5 text-xs text-danger hover:bg-danger-bg px-3 py-2 rounded-xl transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              <span>删除任务</span>
            </button>
          <button
            onClick={handleAskKiro}
            className="flex items-center space-x-1.5 text-xs font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint px-3 py-2 rounded-xl transition-colors"
            title="Ask Kiro"
          >
            <KIRO_ICON className="w-4 h-4" />
            <span>Ask Kiro</span>
          </button>
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
            完成并关闭
          </button>
        </div>
      </div>
    </div>
  );
}
