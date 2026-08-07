"use client";

import React, { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { TaskFilter } from "@/types";
import { getPriorityMeta } from "@/lib/utils";

export function AssignmentTable() {
  const {
    assignments,
    courses,
    setSelectedAssignmentId,
    updateAssignmentStatus,
    setActiveTab,
  } = useAppStore();

  const [filter, setFilter] = useState<TaskFilter>("all");

  const filteredAssignments = assignments.filter((item) => {
    if (filter === "all") return true;
    return item.status === filter;
  });

  return (
    <div className="bg-white border border-[#E7E3DD] rounded-2xl p-4 shadow-subtle flex flex-col justify-between h-full">
      {/* Table Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-[#F0EBE1] gap-2">
        <div className="flex items-center space-x-2">
          <h3 className="text-sm font-bold text-charcoal">
            作业清单与状态
          </h3>
          <span className="text-[10px] font-semibold text-[#8C827A] bg-[#F7F5F5] px-1.5 py-0.5 rounded border border-[#E7E3DD]">
            {filteredAssignments.length} 项
          </span>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center space-x-1 bg-[#F0EBE1] p-0.5 rounded-xl border border-[#E0D7C6] text-[11px] font-medium self-start sm:self-auto">
          {(["all", "doing", "todo", "completed"] as TaskFilter[]).map((f) => {
            const labels: Record<TaskFilter, string> = {
              all: "全部",
              doing: "进行中",
              todo: "待完成",
              completed: "已完成",
            };
            const isActive = filter === f;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-0.5 rounded-lg transition-all ${
                  isActive
                    ? "bg-white text-charcoal font-bold shadow-subtle"
                    : "text-[#676268] hover:text-charcoal"
                }`}
              >
                {labels[f]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table List */}
      <div className="divide-y divide-[#F5F2EE] mt-1 flex-1 overflow-y-auto max-h-[360px]">
        {filteredAssignments.length === 0 ? (
          <div className="py-8 text-center text-xs text-[#8C827A]">
            暂无相关作业任务
          </div>
        ) : (
          filteredAssignments.map((task) => {
            const course = courses.find((c) => c.id === task.courseId);
            const priorityMeta = getPriorityMeta(task.priority);
            const formattedDate = task.ddl.split("T")[0];

            return (
              <div
                key={task.id}
                onClick={() => setSelectedAssignmentId(task.id)}
                className="py-2.5 px-1 hover:bg-[#F7F5F5] rounded-xl transition-colors duration-150 cursor-pointer flex items-center justify-between group"
              >
                {/* Left: Task Title & Course info */}
                <div className="flex items-center space-x-3 min-w-0 flex-1">
                  {/* Status Checkbox */}
                  <input
                    type="checkbox"
                    checked={task.status === "completed"}
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
                          task.status === "completed"
                            ? "line-through text-[#8C827A]"
                            : "text-charcoal group-hover:text-black"
                        }`}
                      >
                        {task.title}
                      </h4>
                      {/* Priority Tag */}
                      <span
                        className={`text-[9px] px-1.5 py-0.2 rounded font-bold shrink-0 border ${priorityMeta.bg} ${priorityMeta.text} ${priorityMeta.border}`}
                      >
                        {priorityMeta.label}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2 text-[10px] text-[#8C827A] mt-0.5">
                      <span className="truncate">{course?.name || "通用"}</span>
                      <span>·</span>
                      <span>DDL: {formattedDate}</span>
                    </div>
                  </div>
                </div>

                {/* Right: Progress bar & Chevron */}
                <div className="flex items-center space-x-3 shrink-0 ml-2">
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

                  <ChevronRight className="w-3.5 h-3.5 text-[#8C827A] group-hover:text-charcoal transition-colors" />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Link */}
      <div className="pt-2 border-t border-[#F0EBE1] flex justify-end">
        <button
          onClick={() => setActiveTab("assignments")}
          className="text-[11px] font-bold text-charcoal hover:underline flex items-center"
        >
          在“作业 DDL”查看全部列表 ↗
        </button>
      </div>
    </div>
  );
}
