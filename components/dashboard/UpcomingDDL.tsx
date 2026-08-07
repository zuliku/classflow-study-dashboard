"use client";

import React from "react";
import { ChevronRight } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { getPriorityMeta } from "@/lib/utils";

const DDL_REFERENCE_DATA = [
  {
    id: "a1",
    monthDay: "5月 21",
    weekday: "周三",
    title: "计量经济学作业",
    subtitle: "计量经济学 · 作业",
    priority: "urgent" as const,
    countdown: "2天后截止",
  },
  {
    id: "a2",
    monthDay: "5月 22",
    weekday: "周四",
    title: "市场营销案例汇报",
    subtitle: "市场营销学 · 小组作业",
    priority: "high" as const,
    countdown: "3天后截止",
  },
  {
    id: "a3",
    monthDay: "5月 23",
    weekday: "周五",
    title: "英语演讲PPT",
    subtitle: "大学英语 · 个人作业",
    priority: "medium" as const,
    countdown: "4天后截止",
  },
  {
    id: "a4",
    monthDay: "5月 24",
    weekday: "周六",
    title: "数据库实验报告",
    subtitle: "数据库系统 · 实验报告",
    priority: "low" as const,
    countdown: "5天后截止",
  },
];

export function UpcomingDDL() {
  const { setSelectedAssignmentId, setActiveTab } = useAppStore();

  return (
    <div className="bg-white border border-[#E7E3DD] rounded-2xl p-4 shadow-subtle flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[#F0EBE1]">
        <h3 className="text-sm font-bold text-charcoal">临近 DDL</h3>
        <button
          onClick={() => setActiveTab("assignments")}
          className="text-xs text-[#8C827A] hover:text-charcoal transition-colors flex items-center"
        >
          查看全部 <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
        </button>
      </div>

      {/* List Items */}
      <div className="mt-2.5 space-y-2">
        {DDL_REFERENCE_DATA.map((item) => {
          const priorityMeta = getPriorityMeta(item.priority);

          return (
            <div
              key={item.id}
              onClick={() => setSelectedAssignmentId(item.id)}
              className="group p-2.5 bg-white hover:bg-[#F7F5F5] border border-[#E7E3DD] hover:border-[#D5CBC0] rounded-xl transition-all duration-200 cursor-pointer flex items-center justify-between shadow-subtle"
            >
              {/* Left Date Block + Info */}
              <div className="flex items-center space-x-3 min-w-0">
                <div className="flex flex-col items-center justify-center w-11 h-11 bg-[#F7F5F5] border border-[#E0D7C6] rounded-lg shrink-0">
                  <span className="text-[9px] text-[#8C827A] font-medium leading-none">
                    {item.monthDay}
                  </span>
                  <span className="text-xs font-bold text-charcoal leading-none mt-1">
                    {item.weekday}
                  </span>
                </div>

                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-charcoal truncate group-hover:text-black">
                    {item.title}
                  </h4>
                  <div className="flex items-center space-x-2 mt-1">
                    <span className="text-[10px] text-[#8C827A] truncate">
                      {item.subtitle}
                    </span>
                    <span
                      className={`text-[9px] px-1.5 py-0.2 rounded border font-semibold ${priorityMeta.bg} ${priorityMeta.text} ${priorityMeta.border}`}
                    >
                      {priorityMeta.label}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Countdown Tag */}
              <div className="shrink-0 text-right pl-2">
                <span className="text-[10px] font-medium text-[#8C827A]">
                  {item.countdown}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
