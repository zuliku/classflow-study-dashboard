"use client";

import React from "react";
import { ChevronRight, Plus, CheckCircle2, Circle, Clock } from "lucide-react";
import { useAppStore, TaskFilter } from "@/store/useAppStore";
import { getPriorityMeta, getStatusMeta } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { zhCN } from "date-fns/locale";

export function AssignmentTable() {
  const {
    assignments,
    courses,
    taskFilter,
    setTaskFilter,
    setSelectedAssignmentId,
    updateAssignmentStatus,
    setActiveTab,
  } = useAppStore();

  // Filter items based on active tab
  const filteredAssignments = assignments.filter((item) => {
    if (taskFilter === "doing") return item.status === "doing";
    if (taskFilter === "todo") return item.status === "todo";
    if (taskFilter === "completed") return item.status === "completed";
    return true; // 'all'
  });

  return (
    <div className="bg-white border border-[#E7E3DD] rounded-2xl p-5 shadow-subtle flex flex-col justify-between">
      {/* Header & Filter Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#F0EBE1]">
        <h3 className="text-base font-bold text-charcoal">
          我的作业与任务
        </h3>

        <div className="flex items-center space-x-3">
          {/* Segmented Filter Tabs */}
          <div className="flex bg-[#F0EBE1] border border-[#E0D7C6] p-1 rounded-xl">
            {(
              [
                { id: "all", label: "全部" },
                { id: "doing", label: "进行中" },
                { id: "todo", label: "待完成" },
                { id: "completed", label: "已完成" },
              ] as { id: TaskFilter; label: string }[]
            ).map((tab) => {
              const isActive = taskFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setTaskFilter(tab.id)}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                    isActive
                      ? "bg-white text-charcoal shadow-subtle font-semibold"
                      : "text-[#676268] hover:text-charcoal"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => setActiveTab("assignments")}
            className="text-xs text-[#8C827A] hover:text-charcoal transition-colors flex items-center shrink-0"
          >
            查看全部任务 <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
          </button>
        </div>
      </div>

      {/* Table Content */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-[#F0EBE1] text-[#8C827A] font-medium">
              <th className="py-2.5 px-3 font-medium">课程</th>
              <th className="py-2.5 px-3 font-medium">任务</th>
              <th className="py-2.5 px-3 font-medium">截止时间</th>
              <th className="py-2.5 px-3 font-medium">优先级</th>
              <th className="py-2.5 px-3 font-medium">状态</th>
              <th className="py-2.5 px-3 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F5F2EE]">
            {filteredAssignments.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-[#8C827A]">
                  暂无匹配的作业任务
                </td>
              </tr>
            ) : (
              filteredAssignments.slice(0, 5).map((item) => {
                const course = courses.find((c) => c.id === item.courseId);
                const priorityMeta = getPriorityMeta(item.priority);
                const statusMeta = getStatusMeta(item.status);

                let formattedDDL = "";
                try {
                  formattedDDL = format(parseISO(item.ddl), "yyyy-MM-dd HH:mm", {
                    locale: zhCN,
                  });
                } catch {
                  formattedDDL = item.ddl;
                }

                return (
                  <tr
                    key={item.id}
                    className="hover:bg-[#F7F5F5] transition-colors cursor-pointer group"
                    onClick={() => setSelectedAssignmentId(item.id)}
                  >
                    {/* Course */}
                    <td className="py-3 px-3 font-semibold text-charcoal truncate max-w-[130px]">
                      {course?.name || "常规任务"}
                    </td>

                    {/* Title */}
                    <td className="py-3 px-3 text-charcoal truncate max-w-[200px]">
                      <span className="font-medium group-hover:underline">
                        {item.title}
                      </span>
                    </td>

                    {/* Deadline */}
                    <td className="py-3 px-3 text-[#676268] font-mono text-[11px] whitespace-nowrap">
                      {formattedDDL}
                    </td>

                    {/* Priority */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold border ${priorityMeta.bg} ${priorityMeta.text} ${priorityMeta.border}`}
                      >
                        {priorityMeta.label}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${statusMeta.bg} ${statusMeta.text}`}
                      >
                        {statusMeta.label}
                      </span>
                    </td>

                    {/* Quick Toggle Completion Action */}
                    <td
                      className="py-3 px-3 text-right whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() =>
                          updateAssignmentStatus(
                            item.id,
                            item.status === "completed" ? "todo" : "completed"
                          )
                        }
                        className="p-1 rounded-lg hover:bg-[#E3E6E0] transition-colors text-[#8C827A] hover:text-charcoal"
                        title={
                          item.status === "completed" ? "标记未完成" : "标记已完成"
                        }
                      >
                        {item.status === "completed" ? (
                          <CheckCircle2 className="w-4 h-4 text-[#065F46]" />
                        ) : (
                          <Circle className="w-4 h-4" />
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
