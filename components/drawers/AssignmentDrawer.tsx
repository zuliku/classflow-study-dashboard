"use client";

import React from "react";
import {
  X,
  Clock,
  CheckSquare,
  Square,
  Trash2,
  Calendar,
  AlertTriangle,
  BookOpen,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { Priority, AssignmentStatus } from "@/types";
import { getPriorityMeta, getStatusMeta, getDDLStatusText } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { zhCN } from "date-fns/locale";

export function AssignmentDrawer() {
  const {
    assignments,
    courses,
    selectedAssignmentId,
    setSelectedAssignmentId,
    updateAssignmentStatus,
    updateAssignmentProgress,
    updateAssignmentPriority,
    toggleSubtask,
    deleteAssignment,
  } = useAppStore();

  if (!selectedAssignmentId) return null;

  const assignment = assignments.find((a) => a.id === selectedAssignmentId);
  if (!assignment) return null;

  const course = courses.find((c) => c.id === assignment.courseId);
  const priorityMeta = getPriorityMeta(assignment.priority);
  const statusMeta = getStatusMeta(assignment.status);
  const { text: ddlText, isUrgent } = getDDLStatusText(assignment.ddl);

  let formattedDDL = "";
  try {
    formattedDDL = format(parseISO(assignment.ddl), "yyyy年MM月dd日 HH:mm", {
      locale: zhCN,
    });
  } catch {
    formattedDDL = assignment.ddl;
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/30 backdrop-blur-sm flex justify-end transition-opacity animate-in fade-in">
      <div className="w-full max-w-lg bg-white h-full shadow-drawer flex flex-col border-l border-[#E7E3DD] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-[#F0EBE1] bg-[#F7F5F5] flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-[#8C827A] flex items-center">
              <BookOpen className="w-3.5 h-3.5 mr-1 text-[#A48F82]" />
              {course?.name || "常规任务"}
            </span>
            <h2 className="text-lg font-bold text-charcoal leading-snug">
              {assignment.title}
            </h2>
          </div>
          <button
            onClick={() => setSelectedAssignmentId(null)}
            className="p-2 rounded-xl bg-white hover:bg-[#F0EBE1] text-charcoal border border-[#E0D7C6] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 space-y-6 flex-1">
          {/* Status & DDL Banner */}
          <div className="p-4 bg-[#F0EBE1]/60 border border-[#E0D7C6] rounded-2xl flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Clock className="w-4 h-4 text-[#A48F82]" />
              <div>
                <p className="text-[10px] text-[#8C827A]">截止时间</p>
                <p className="text-xs font-semibold text-charcoal font-mono">
                  {formattedDDL}
                </p>
              </div>
            </div>
            <span
              className={`text-xs font-bold px-3 py-1 rounded-xl border ${
                isUrgent
                  ? "bg-[#FDF0F0] text-[#D94F4F] border-[#F8D7D7]"
                  : "bg-white text-charcoal border-[#E0D7C6]"
              }`}
            >
              {ddlText}
            </span>
          </div>

          {/* Status & Priority Selectors */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#8C827A] uppercase tracking-wider">
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
                className="w-full text-xs font-medium bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl p-2.5 text-charcoal focus:outline-none cursor-pointer"
              >
                <option value="todo">待完成 (To Do)</option>
                <option value="doing">进行中 (In Progress)</option>
                <option value="submitted">已提交 (Submitted)</option>
                <option value="completed">已完成 (Completed)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#8C827A] uppercase tracking-wider">
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
                className="w-full text-xs font-medium bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl p-2.5 text-charcoal focus:outline-none cursor-pointer"
              >
                <option value="urgent">🔴 紧急 (Urgent)</option>
                <option value="high">🟠 高优先 (High)</option>
                <option value="medium">🟡 中优先 (Medium)</option>
                <option value="low">🟢 低优先 (Low)</option>
              </select>
            </div>
          </div>

          {/* Progress Slider */}
          <div className="space-y-2 bg-[#F7F5F5] border border-[#E7E3DD] p-4 rounded-2xl">
            <div className="flex justify-between items-center text-xs">
              <span className="font-bold text-[#8C827A] uppercase tracking-wider">
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
              className="w-full h-2 bg-[#E0D7C6] rounded-lg appearance-none cursor-pointer accent-[#313032]"
            />
          </div>

          {/* Assignment Description */}
          {assignment.description && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-bold text-[#8C827A] uppercase tracking-wider">
                作业要求与说明
              </h4>
              <p className="text-xs text-charcoal bg-[#F0EBE1]/40 border border-[#E0D7C6] rounded-xl p-3.5 leading-relaxed whitespace-pre-wrap">
                {assignment.description}
              </p>
            </div>
          )}

          {/* Subtasks Checklist */}
          {assignment.subtasks && assignment.subtasks.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-[#8C827A] uppercase tracking-wider">
                子任务清单 ({assignment.subtasks.filter((st) => st.completed).length} / {assignment.subtasks.length})
              </h4>
              <div className="space-y-2">
                {assignment.subtasks.map((st) => (
                  <div
                    key={st.id}
                    onClick={() => toggleSubtask(assignment.id, st.id)}
                    className="flex items-center space-x-2.5 p-3 bg-[#F7F5F5] hover:bg-[#F0EBE1]/60 border border-[#E7E3DD] rounded-xl text-xs cursor-pointer transition-colors"
                  >
                    {st.completed ? (
                      <CheckSquare className="w-4 h-4 text-[#065F46] shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-[#A48F82] shrink-0" />
                    )}
                    <span
                      className={`flex-1 text-charcoal ${
                        st.completed ? "line-through text-[#8C827A]" : "font-medium"
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
          <button
            onClick={() => deleteAssignment(assignment.id)}
            className="flex items-center space-x-1.5 text-xs text-[#D94F4F] hover:bg-[#FDF0F0] px-3 py-2 rounded-xl transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            <span>删除作业</span>
          </button>
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
