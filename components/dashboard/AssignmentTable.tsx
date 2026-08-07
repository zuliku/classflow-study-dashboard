"use client";

import React from "react";
import { ChevronRight } from "lucide-react";
import { useAppStore, TaskFilter } from "@/store/useAppStore";
import { getPriorityMeta } from "@/lib/utils";

const TABLE_ITEMS = [
  {
    id: "a1",
    course: "计量经济学",
    task: "计量经济学作业（第3章）",
    ddl: "2025-05-21 23:59",
    priority: "urgent" as const,
    status: "doing",
    statusText: "进行中",
  },
  {
    id: "a2",
    course: "市场营销学",
    task: "市场营销案例分析汇报",
    ddl: "2025-05-22 23:59",
    priority: "high" as const,
    status: "doing",
    statusText: "进行中",
  },
  {
    id: "a3",
    course: "大学英语",
    task: "英语演讲PPT (Unit 6)",
    ddl: "2025-05-23 18:00",
    priority: "medium" as const,
    status: "todo",
    statusText: "待完成",
  },
  {
    id: "a4",
    course: "数据库系统",
    task: "实验报告（实验四）",
    ddl: "2025-05-24 23:59",
    priority: "low" as const,
    status: "todo",
    statusText: "待完成",
  },
  {
    id: "a5",
    course: "微观经济学",
    task: "课后习题（第5章）",
    ddl: "2025-05-26 23:59",
    priority: "medium" as const,
    status: "todo",
    statusText: "待完成",
  },
];

export function AssignmentTable() {
  const { taskFilter, setTaskFilter, setSelectedAssignmentId, setActiveTab } =
    useAppStore();

  const filteredItems = TABLE_ITEMS.filter((item) => {
    if (taskFilter === "doing") return item.status === "doing";
    if (taskFilter === "todo") return item.status === "todo";
    if (taskFilter === "completed") return item.status === "completed";
    return true;
  });

  return (
    <div className="bg-white border border-[#E7E3DD] rounded-2xl p-4 shadow-subtle flex flex-col justify-between h-full">
      {/* Header & Filter Tabs matching image 2 */}
      <div className="flex items-center justify-between pb-2 border-b border-[#F0EBE1]">
        <h3 className="text-sm font-bold text-charcoal shrink-0">
          我的作业与任务
        </h3>

        <div className="flex items-center space-x-3">
          {/* Segmented Filter Tabs */}
          <div className="flex bg-[#F0EBE1] border border-[#E0D7C6] p-0.5 rounded-lg text-xs">
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
                  className={`px-2.5 py-0.5 text-[11px] font-medium rounded-md transition-all ${
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
            className="text-[11px] text-[#8C827A] hover:text-charcoal transition-colors flex items-center shrink-0"
          >
            查看全部任务 <ChevronRight className="w-3 h-3 ml-0.5" />
          </button>
        </div>
      </div>

      {/* Table Body matching image 2 columns and tags */}
      <div className="mt-1.5 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-[#F0EBE1] text-[#8C827A] font-medium text-[11px]">
              <th className="py-2 px-2 font-medium">课程</th>
              <th className="py-2 px-2 font-medium">任务</th>
              <th className="py-2 px-2 font-medium">截止时间</th>
              <th className="py-2 px-2 font-medium">优先级</th>
              <th className="py-2 px-2 font-medium">状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F5F2EE]">
            {filteredItems.map((item) => {
              const priorityMeta = getPriorityMeta(item.priority);
              const isDoing = item.status === "doing";

              return (
                <tr
                  key={item.id}
                  className="hover:bg-[#F7F5F5] transition-colors cursor-pointer group"
                  onClick={() => setSelectedAssignmentId(item.id)}
                >
                  <td className="py-2 px-2 font-semibold text-charcoal truncate text-[11px] max-w-[110px]">
                    {item.course}
                  </td>
                  <td className="py-2 px-2 text-charcoal text-[11px] truncate max-w-[180px]">
                    <span className="group-hover:underline">{item.task}</span>
                  </td>
                  <td className="py-2 px-2 text-[#676268] font-mono text-[10px] whitespace-nowrap">
                    {item.ddl}
                  </td>
                  <td className="py-2 px-2 whitespace-nowrap">
                    <span
                      className={`inline-block px-1.5 py-0.2 rounded text-[9px] font-semibold border ${priorityMeta.bg} ${priorityMeta.text} ${priorityMeta.border}`}
                    >
                      {priorityMeta.label}
                    </span>
                  </td>
                  <td className="py-2 px-2 whitespace-nowrap">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${
                        isDoing
                          ? "bg-[#E3E6E0] text-[#3A5A40]"
                          : "bg-[#F0EBE1] text-[#8C7A6B]"
                      }`}
                    >
                      {item.statusText}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
