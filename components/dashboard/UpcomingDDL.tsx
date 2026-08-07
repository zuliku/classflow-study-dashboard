"use client";

import React from "react";
import { Clock, ChevronRight, AlertCircle } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { getDDLStatusText, getPriorityMeta } from "@/lib/utils";
import { parseISO, format } from "date-fns";
import { zhCN } from "date-fns/locale";

export function UpcomingDDL() {
  const { assignments, courses, setSelectedAssignmentId, setActiveTab } =
    useAppStore();

  // Filter out completed assignments and sort by DDL chronological order
  const pendingAssignments = [...assignments]
    .filter((a) => a.status !== "completed")
    .sort(
      (a, b) => new Date(a.ddl).getTime() - new Date(b.ddl).getTime()
    );

  const displayList = pendingAssignments.slice(0, 5);

  return (
    <div className="bg-white border border-[#E7E3DD] rounded-2xl p-5 shadow-subtle flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between pb-3.5 border-b border-[#F0EBE1]">
        <div className="flex items-center space-x-2">
          <Clock className="w-4 h-4 text-[#D94F4F]" />
          <h3 className="text-base font-bold text-charcoal">临近 DDL</h3>
          <span className="text-xs bg-[#FDF0F0] text-[#D94F4F] font-semibold px-2 py-0.5 rounded-full border border-[#F8D7D7]">
            {pendingAssignments.length} 项待处理
          </span>
        </div>
        <button
          onClick={() => setActiveTab("assignments")}
          className="text-xs text-[#8C827A] hover:text-charcoal transition-colors flex items-center"
        >
          查看全部 <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
        </button>
      </div>

      {/* DDL Items List */}
      <div className="mt-3 space-y-2.5">
        {displayList.length === 0 ? (
          <div className="py-8 text-center text-xs text-[#8C827A]">
            🎉 赞！近期暂无临近截止的作业
          </div>
        ) : (
          displayList.map((item) => {
            const course = courses.find((c) => c.id === item.courseId);
            const { text: ddlText, isUrgent } = getDDLStatusText(item.ddl);
            const priorityMeta = getPriorityMeta(item.priority);

            let formattedDate = "";
            let formattedDay = "";
            try {
              const d = parseISO(item.ddl);
              formattedDate = format(d, "M月d日", { locale: zhCN });
              formattedDay = format(d, "EEEE", { locale: zhCN });
            } catch (e) {
              formattedDate = item.ddl;
            }

            return (
              <div
                key={item.id}
                onClick={() => setSelectedAssignmentId(item.id)}
                className="group p-3 bg-[#F7F5F5] hover:bg-[#F0EBE1]/70 border border-[#E7E3DD] hover:border-[#D5CBC0] rounded-xl transition-all duration-200 cursor-pointer flex items-center justify-between shadow-subtle hover:shadow-card"
              >
                {/* Left Date Box */}
                <div className="flex items-center space-x-3 min-w-0">
                  <div className="flex flex-col items-center justify-center w-12 h-12 bg-white border border-[#E0D7C6] rounded-lg shrink-0">
                    <span className="text-[10px] text-[#8C827A] font-medium leading-none">
                      {formattedDate.split("月")[0]}月
                    </span>
                    <span className="text-base font-bold text-charcoal leading-none mt-0.5">
                      {formattedDate.split("月")[1]?.replace("日", "")}
                    </span>
                    <span className="text-[9px] text-[#8C827A] leading-none mt-0.5">
                      {formattedDay.replace("星期", "周")}
                    </span>
                  </div>

                  {/* Title & Tag */}
                  <div className="min-w-0">
                    <div className="flex items-center space-x-1.5">
                      <h4 className="text-xs font-semibold text-charcoal truncate group-hover:text-black">
                        {item.title}
                      </h4>
                    </div>
                    <div className="flex items-center space-x-2 mt-1">
                      <span className="text-[11px] text-[#676268] truncate">
                        {course?.name || "常规任务"}
                      </span>
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${priorityMeta.bg} ${priorityMeta.text} ${priorityMeta.border}`}
                      >
                        {priorityMeta.label}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right Countdown Tag */}
                <div className="shrink-0 text-right pl-2">
                  <span
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border ${
                      isUrgent
                        ? "bg-[#FDF0F0] text-[#D94F4F] border-[#F8D7D7]"
                        : "bg-white text-[#676268] border-[#E7E3DD]"
                    }`}
                  >
                    {ddlText}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
