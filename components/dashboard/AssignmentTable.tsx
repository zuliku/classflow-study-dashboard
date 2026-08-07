"use client";

import React, { useState } from "react";
import {
  ChevronRight,
  Plus,
  Filter,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Edit2,
  Trash2,
  BookOpen,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { TimeSliceFilter } from "@/types";
import { getPriorityMeta } from "@/lib/utils";
import { isToday, differenceInDays } from "date-fns";
import { parseLocalDDL, getLocalDDLDate } from "@/lib/ddl";

export function AssignmentTable() {
  const {
    assignments,
    courses,
    setSelectedAssignmentId,
    updateAssignmentStatus,
    deleteAssignment,
    setActiveTab,
  } = useAppStore();

  const [courseFilter, setCourseFilter] = useState<string>("all");
  const [timeSlice, setTimeSlice] = useState<TimeSliceFilter>("all");

  const today = new Date();

  // Filter assignments dynamically
  const filteredAssignments = assignments.filter((item) => {
    // 1. Course Filter
    if (courseFilter !== "all" && item.courseId !== courseFilter) {
      return false;
    }

    // 2. Time Slice & Status Filter (DDL 按本地时间语义)
    const ddlDate = parseLocalDDL(item.ddl);
    if (!ddlDate) return false;
    const diff = differenceInDays(ddlDate, today);

    switch (timeSlice) {
      case "overdue":
        return item.status !== "completed" && diff < 0 && !isToday(ddlDate);
      case "today":
        return isToday(ddlDate);
      case "3days":
        return item.status !== "completed" && diff >= 0 && diff <= 3;
      case "7days":
        return item.status !== "completed" && diff >= 0 && diff <= 7;
      case "completed":
        return item.status === "completed";
      default:
        return true;
    }
  });

  const handleAddAssignmentClick = () => {
    window.dispatchEvent(new CustomEvent("open-assignment-modal"));
  };

  const handleEditClick = (e: React.MouseEvent, assignmentId: string) => {
    e.stopPropagation();
    window.dispatchEvent(
      new CustomEvent("open-assignment-modal", { detail: { assignmentId } })
    );
  };

  // Overdue count
  const overdueCount = assignments.filter((a) => {
    if (a.status === "completed") return false;
    const ddlDate = parseLocalDDL(a.ddl);
    if (!ddlDate) return false;
    return differenceInDays(ddlDate, today) < 0 && !isToday(ddlDate);
  }).length;

  return (
    <div className="bg-white border border-[#E7E3DD] rounded-2xl p-4 shadow-subtle flex flex-col justify-between h-full space-y-3">
      {/* Header & Controls */}
      <div className="space-y-3 border-b border-[#F0EBE1] pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <h3 className="text-sm font-bold text-charcoal">
              任务清单
            </h3>
            <span className="text-[10px] font-semibold text-[#8C827A] bg-[#F7F5F5] px-1.5 py-0.5 rounded border border-[#E7E3DD]">
              {filteredAssignments.length} 项任务
            </span>
            {overdueCount > 0 && (
              <span className="text-[10px] font-bold text-[#D94F4F] bg-[#FDF0F0] px-2 py-0.5 rounded-full border border-[#F8D7D7] flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {overdueCount} 项已逾期
              </span>
            )}
          </div>

          <button
            onClick={handleAddAssignmentClick}
            className="flex items-center space-x-1 px-3 py-1.5 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-xl transition-colors shadow-subtle shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>新增任务</span>
          </button>
        </div>

        {/* Filters Row: Course Filter Dropdown + Time Slice Pills */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          {/* Course Selector Dropdown */}
          <div className="flex items-center space-x-1.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl px-2.5 py-1">
            <BookOpen className="w-3.5 h-3.5 text-[#A48F82]" />
            <select
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value)}
              className="bg-transparent text-charcoal text-xs font-semibold focus:outline-none cursor-pointer"
            >
              <option value="all">全部课程 ({assignments.length})</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Clean Time Slice Pills (Emojis removed as requested) */}
          <div className="flex flex-wrap items-center gap-1 bg-[#F0EBE1] p-0.5 rounded-xl border border-[#E0D7C6] text-[11px] font-medium">
            {[
              { id: "all", label: "全部" },
              { id: "overdue", label: "已逾期" },
              { id: "today", label: "今日截止" },
              { id: "3days", label: "3天内截止" },
              { id: "7days", label: "7天内截止" },
              { id: "completed", label: "已完成归档" },
            ].map((slice) => {
              const isActive = timeSlice === slice.id;
              return (
                <button
                  key={slice.id}
                  onClick={() => setTimeSlice(slice.id as TimeSliceFilter)}
                  className={`px-2.5 py-0.5 rounded-lg transition-all ${
                    isActive
                      ? "bg-white text-charcoal font-bold shadow-subtle"
                      : "text-[#676268] hover:text-charcoal"
                  }`}
                >
                  {slice.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Task List */}
      <div className="divide-y divide-[#F5F2EE] mt-1 flex-1 overflow-y-auto max-h-[380px] space-y-1">
        {filteredAssignments.length === 0 ? (
          <div className="py-10 text-center text-xs text-[#8C827A] space-y-1">
            <CheckCircle2 className="w-8 h-8 mx-auto text-[#4A7C59]" />
            <p>该筛选条件下暂无任务</p>
          </div>
        ) : (
          filteredAssignments.map((task) => {
            const course = courses.find((c) => c.id === task.courseId);
            const priorityMeta = getPriorityMeta(task.priority);
            const formattedDate = getLocalDDLDate(task.ddl);
            const isCompleted = task.status === "completed";

            const ddlDate = parseLocalDDL(task.ddl);
            const isOverdueTask =
              !!ddlDate &&
              !isCompleted &&
              differenceInDays(ddlDate, today) < 0 &&
              !isToday(ddlDate);

            return (
              <div
                key={task.id}
                onClick={() => setSelectedAssignmentId(task.id)}
                className={`p-3 rounded-xl transition-all duration-150 cursor-pointer flex items-center justify-between group ${
                  isOverdueTask
                    ? "bg-[#FDF0F0] border border-[#F8D7D7]"
                    : "hover:bg-[#F7F5F5] bg-white border border-[#F5F2EE]"
                }`}
              >
                {/* Left: Checkbox & Info */}
                <div className="flex items-center space-x-3 min-w-0 flex-1">
                  <input
                    type="checkbox"
                    checked={isCompleted}
                    onChange={(e) => {
                      e.stopPropagation();
                      updateAssignmentStatus(
                        task.id,
                        e.target.checked ? "completed" : "doing"
                      );
                    }}
                    className="w-4 h-4 rounded text-charcoal border-[#CDB9AB] focus:ring-0 cursor-pointer shrink-0"
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center space-x-2">
                      <h4
                        className={`text-xs font-bold truncate ${
                          isCompleted
                            ? "line-through text-[#8C827A]"
                            : "text-charcoal group-hover:text-black"
                        }`}
                      >
                        {task.title}
                      </h4>
                      <span
                        className={`text-[9px] px-1.5 py-0.2 rounded font-bold shrink-0 border ${priorityMeta.bg} ${priorityMeta.text} ${priorityMeta.border}`}
                      >
                        {priorityMeta.label}
                      </span>
                      {isOverdueTask && (
                        <span className="text-[9px] bg-[#D94F4F] text-white px-1.5 py-0.2 rounded font-extrabold shrink-0">
                          已逾期
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-2 text-[10px] text-[#8C827A] mt-1">
                      <span className="truncate font-semibold">{course?.name || "通用"}</span>
                      <span>·</span>
                      <span>截止: {formattedDate}</span>
                      {task.subtasks && task.subtasks.length > 0 && (
                        <>
                          <span>·</span>
                          <span>
                            子任务: {task.subtasks.filter((st) => st.completed).length} / {task.subtasks.length}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Progress & Action Buttons */}
                <div className="flex items-center space-x-2 shrink-0 ml-2">
                  <div className="w-16 hidden sm:block">
                    <div className="flex justify-between text-[9px] text-[#8C827A] mb-0.5">
                      <span>进度</span>
                      <span className="font-bold text-charcoal">
                        {task.progress}%
                      </span>
                    </div>
                    <div className="w-full bg-[#F0EBE1] rounded-full h-1 overflow-hidden">
                      <div
                        className="bg-[#4A7C59] h-1 rounded-full transition-all duration-300"
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                  </div>

                  <button
                    onClick={(e) => handleEditClick(e, task.id)}
                    className="p-1 rounded-lg text-[#8C827A] hover:bg-[#E0D7C6] hover:text-charcoal transition-colors"
                    title="编辑作业"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`确定要删除作业《${task.title}》吗？`)) {
                        deleteAssignment(task.id);
                      }
                    }}
                    className="p-1 rounded-lg text-[#D94F4F] hover:bg-[#FDF0F0] transition-colors"
                    title="删除作业"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>

                  <ChevronRight className="w-3.5 h-3.5 text-[#8C827A] group-hover:text-charcoal transition-colors" />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer */}
      <div className="pt-2 border-t border-[#F0EBE1] flex justify-between items-center text-xs">
        <span className="text-[11px] text-[#8C827A]">
          点击任务查看详情与子任务
        </span>
        <button
          onClick={() => setActiveTab("assignments")}
          className="font-bold text-charcoal hover:underline"
        >
          查看全部
        </button>
      </div>
    </div>
  );
}
