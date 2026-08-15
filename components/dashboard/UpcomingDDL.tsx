"use client";

import React, { useState, useMemo } from "react";
import { Clock, ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { format, formatDistanceToNow, differenceInDays } from "date-fns";
import { zhCN } from "date-fns/locale";
import { parseLocalDDL } from "@/lib/ddl";
import { paginate } from "@/lib/pagination";

/** Overview「临近 DDL」每页最多 3 条（右栏 Hero 空间内充分利用，分页摘要定位） */
const UPCOMING_DDL_PAGE_SIZE = 3;

export function UpcomingDDL() {
  const { assignments, courses, setSelectedAssignmentId, setActiveTab, preferences } =
    useAppStore();
  const [currentPage, setCurrentPage] = useState(1);

  const today = new Date();
  // "临近 DDL" 窗口 = preferences.ddlWarningDays（默认 3 天；语义为临近截止提示，非筛选）
  const warningDays = preferences.ddlWarningDays;

  // "临近 DDL" = 尚未完成、未逾期、且在 warningDays 天内截止（DDL 按本地时间语义）；
  // 已逾期任务保留在 AssignmentTable 的"已逾期"筛选，不占据此处顶部
  const upcomingAssignments = useMemo(
    () =>
      [...assignments]
        .filter((a) => {
          if (a.status === "completed") return false;
          const ddlDate = parseLocalDDL(a.ddl);
          if (!ddlDate) return false;
          const diff = differenceInDays(ddlDate, today);
          return diff >= 0 && diff <= warningDays;
        })
        .sort((a, b) => {
          const timeA = parseLocalDDL(a.ddl)?.getTime() ?? 0;
          const timeB = parseLocalDDL(b.ddl)?.getTime() ?? 0;
          return timeA - timeB;
        }),
    [assignments, warningDays]
  );

  // 纯展示分页：每页 3 条；currentPage 渲染时 clamp（任务数量变化自动回到最后一个有效页）
  const paged = useMemo(
    () => paginate(upcomingAssignments, currentPage, UPCOMING_DDL_PAGE_SIZE),
    [upcomingAssignments, currentPage]
  );
  const pagedItems = paged.items;
  const totalPages = paged.totalPages;
  const safePage = paged.currentPage;
  const showPagination = upcomingAssignments.length > UPCOMING_DDL_PAGE_SIZE;

  // 优先级：仅 urgent / high 使用明显 Badge；medium / low 退化为小圆点（文字提示）
  const getPriorityMark = (priority: string) => {
    switch (priority) {
      case "urgent":
        return (
          <span className="shrink-0 px-1.5 py-px rounded text-[10px] font-bold bg-danger-bg text-danger border border-danger-border leading-4">
            紧急
          </span>
        );
      case "high":
        return (
          <span className="shrink-0 px-1.5 py-px rounded text-[10px] font-bold bg-warning-bg text-warning border border-warning-border leading-4">
            高优
          </span>
        );
      case "medium":
        return (
          <span
            aria-hidden="true"
            title="中优先"
            className="shrink-0 w-1.5 h-1.5 rounded-full bg-stone-beige"
          />
        );
      default:
        return (
          <span
            aria-hidden="true"
            title="低优先"
            className="shrink-0 w-1.5 h-1.5 rounded-full bg-ashy-beige"
          />
        );
    }
  };

  // 按日期分组的展示结构（保持 ddl 升序）：日期分组头 + 内部 Row（无每行 Card）
  const grouped = useMemo(() => {
    const groups: { key: string; label: string; items: typeof pagedItems }[] = [];
    for (const task of pagedItems) {
      const ddlDate = parseLocalDDL(task.ddl) ?? new Date();
      const key = format(ddlDate, "yyyy-MM-dd");
      const last = groups[groups.length - 1];
      if (last && last.key === key) {
        last.items.push(task);
      } else {
        groups.push({ key, label: format(ddlDate, "M月d日 EEE", { locale: zhCN }), items: [task] });
      }
    }
    return groups;
  }, [pagedItems]);

  return (
    <div
      data-testid="upcoming-ddl-card"
      className="bg-surface border border-line rounded-xl p-3.5 shadow-subtle flex flex-col min-h-0 h-full"
    >
      {/* Card Header */}
      <div className="flex items-center justify-between border-b border-line-soft pb-2 shrink-0">
        <div className="flex items-center space-x-2">
          <Clock className="w-4 h-4 text-danger" />
          <h3 className="text-sm font-bold text-charcoal tracking-tight">
            临近 DDL
          </h3>
          <span className="text-[10px] font-semibold text-sandrift">
            {paged.totalItems} 项待办
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

      {/* DDL Task Rows：日期分组 + Row 语言（hover bg，无每行 Card） */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none space-y-1 py-1.5">
        {grouped.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-xs text-sandrift space-y-1 min-h-24">
            <CheckCircle2 className="w-6 h-6 text-success" />
            <p>暂无临近 DDL</p>
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.key} className="shrink-0">
              <p className="text-[11px] font-bold text-sandrift px-2 pt-0.5 pb-0.5">
                {group.label}
              </p>
              <div className="space-y-px">
                {group.items.map((task) => {
                  const course = courses.find((c) => c.id === task.courseId);
                  const ddlDate = parseLocalDDL(task.ddl) ?? new Date();
                  const relativeTime = formatDistanceToNow(ddlDate, {
                    addSuffix: true,
                    locale: zhCN,
                  });

                  return (
                    <div
                      key={task.id}
                      onClick={() => setSelectedAssignmentId(task.id)}
                      className="flex items-start gap-2.5 px-2 py-1.5 rounded-lg hover:bg-alabaster/50 cursor-pointer group transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]"
                    >
                      <span className="text-[11px] tabular-nums text-sandrift font-semibold shrink-0 w-11 leading-5 pt-px">
                        {format(ddlDate, "HH:mm")}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-xs font-bold text-charcoal truncate group-hover:text-black leading-5">
                          {task.title}
                        </h4>
                        <div className="flex items-center gap-1.5 min-w-0 mt-0.5">
                          <span className="text-[10px] text-satin-grey truncate">
                            {course?.name || "通用课题"}
                          </span>
                          {getPriorityMark(task.priority)}
                        </div>
                      </div>
                      <span className="text-[10px] font-bold text-danger/90 shrink-0 pt-px leading-5">
                        {relativeTime}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 轻量 Footer（恒显保证高度稳定；仅 >3 项时显示分页按钮） */}
      <div
        data-testid="upcoming-ddl-pagination"
        className="pt-2 border-t border-line-soft flex items-center justify-between shrink-0"
      >
        <span className="text-[11px] text-sandrift">
          {showPagination ? `${safePage} / ${totalPages}` : `共 ${paged.totalItems} 项`}
        </span>
        {showPagination && (
          <span className="inline-flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(safePage - 1)}
              disabled={safePage <= 1}
              aria-label="上一页"
              className="w-6 h-6 flex items-center justify-center rounded-md text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-sandrift"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setCurrentPage(safePage + 1)}
              disabled={safePage >= totalPages}
              aria-label="下一页"
              className="w-6 h-6 flex items-center justify-center rounded-md text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-sandrift"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
