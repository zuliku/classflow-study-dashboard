"use client";

import React from "react";
import { Clock, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { format, formatDistanceToNow, differenceInDays } from "date-fns";
import { zhCN } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { parseLocalDDL } from "@/lib/ddl";

export function UpcomingDDL() {
  const { assignments, courses, setSelectedAssignmentId, setActiveTab } = useAppStore();

  const today = new Date();

  // "临近 DDL" = 尚未完成、未逾期、且在未来 7 天内截止（DDL 按本地时间语义）；
  // 已逾期任务保留在 AssignmentTable 的"已逾期"筛选，不占据此处顶部
  const upcomingAssignments = [...assignments]
    .filter((a) => {
      if (a.status === "completed") return false;
      const ddlDate = parseLocalDDL(a.ddl);
      if (!ddlDate) return false;
      const diff = differenceInDays(ddlDate, today);
      return diff >= 0 && diff <= 7;
    })
    .sort((a, b) => {
      const timeA = parseLocalDDL(a.ddl)?.getTime() ?? 0;
      const timeB = parseLocalDDL(b.ddl)?.getTime() ?? 0;
      return timeA - timeB;
    })
    .slice(0, 4);

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case "urgent":
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-danger-bg text-danger border border-danger-border">
            紧急
          </span>
        );
      case "high":
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-warning-bg text-warning border border-warning-border">
            高优先
          </span>
        );
      case "medium":
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-alabaster text-charcoal border border-stone-beige">
            中优先
          </span>
        );
      default:
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-pastel-mint text-charcoal border border-pastel-mint">
            普通
          </span>
        );
    }
  };

  return (
    <div className="bg-surface border border-line rounded-2xl p-4 shadow-subtle flex flex-col justify-between space-y-3">
      {/* Card Header */}
      <div className="flex items-center justify-between border-b border-[#F0EBE1] pb-2.5">
        <div className="flex items-center space-x-2">
          <Clock className="w-4 h-4 text-danger" />
          <h3 className="text-xs font-bold text-charcoal tracking-tight">
            临近 DDL
          </h3>
          <span className="text-[10px] font-semibold text-sandrift bg-[#F7F5F5] px-1.5 py-0.5 rounded border border-line">
            {upcomingAssignments.length} 项待办
          </span>
        </div>
        <button
          onClick={() => setActiveTab("assignments")}
          className="text-[11px] font-semibold text-sandrift hover:text-charcoal flex items-center transition-colors"
        >
          <span>全部任务</span>
          <ArrowUpRight className="w-3 h-3 ml-0.5" />
        </button>
      </div>

      {/* DDL Task Items List */}
      <div className="space-y-2">
        {upcomingAssignments.length === 0 ? (
          <div className="py-6 text-center text-xs text-sandrift space-y-1">
            <CheckCircle2 className="w-6 h-6 mx-auto text-success" />
            <p>暂无临近 DDL</p>
          </div>
        ) : (
          upcomingAssignments.map((task) => {
            const course = courses.find((c) => c.id === task.courseId);
            const ddlDate = parseLocalDDL(task.ddl) ?? new Date();
            const dateDisplay = format(ddlDate, "M月d日 EEE", { locale: zhCN });
            const relativeTime = formatDistanceToNow(ddlDate, {
              addSuffix: true,
              locale: zhCN,
            });

            return (
              <div
                key={task.id}
                onClick={() => setSelectedAssignmentId(task.id)}
                className="p-2.5 bg-[#F7F5F5] hover:bg-alabaster border border-line hover:border-[#CDB9AB] rounded-xl transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] cursor-pointer flex items-center justify-between group"
              >
                <div className="flex items-center space-x-2.5 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-lg bg-white border border-line-strong flex flex-col items-center justify-center shrink-0 text-center">
                    <span className="text-[9px] font-bold text-sandrift leading-none">
                      {format(ddlDate, "M月")}
                    </span>
                    <span className="text-xs font-extrabold text-charcoal leading-none mt-0.5">
                      {format(ddlDate, "d")}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center space-x-1.5">
                      <h4 className="text-xs font-bold text-charcoal truncate group-hover:text-black">
                        {task.title}
                      </h4>
                      {getPriorityBadge(task.priority)}
                    </div>
                    <p className="text-[10px] text-satin-grey truncate mt-0.5">
                      {course?.name || "通用课题"}
                    </p>
                  </div>
                </div>

                <div className="text-right shrink-0 ml-2">
                  <span className="text-[10px] font-bold text-danger block">
                    {relativeTime}
                  </span>
                  <span className="text-[9px] text-sandrift block mt-0.5">
                    {dateDisplay}
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
