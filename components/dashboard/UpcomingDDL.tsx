"use client";

import React, { useState, useMemo } from "react";
import { Clock, ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { format, formatDistanceToNow, differenceInDays } from "date-fns";
import { zhCN } from "date-fns/locale";
import { parseLocalDDL } from "@/lib/ddl";
import { paginate } from "@/lib/pagination";
import { cn, cardKeyHandler } from "@/lib/utils";

/** Overview「临近 DDL」每页最多 3 条（右栏 Hero 空间内充分利用，分页摘要定位） */
const UPCOMING_DDL_PAGE_SIZE = 3;

/**
 * Compact Calendar Date Anchor（Overview Upcoming DDL V1）：
 * 纯视觉 temporal orientation —— 月份 / 日期 / 星期，来自同一个 parseLocalDDL Date。
 * decorative：不进入 tab order、无点击语义、无独立 aria-label；a11y 由 Card 组合 aria-label 承担。
 */
function DDLDateTile({ date, taskId }: { date: Date; taskId: string }) {
  return (
    <div
      aria-hidden="true"
      data-testid={`upcoming-ddl-date-${taskId}`}
      className="shrink-0 w-[46px] h-[56px] rounded-xl border border-line bg-surface flex flex-col items-center justify-center leading-none"
    >
      <span className="text-[9px] font-semibold text-sandrift">
        {format(date, "M月")}
      </span>
      <span className="text-[17px] font-bold tabular-nums text-warning leading-none mt-1">
        {format(date, "d")}
      </span>
      <span className="text-[9px] font-semibold text-satin-grey mt-1">
        {format(date, "EEE", { locale: zhCN })}
      </span>
    </div>
  );
}

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
            className="shrink-0 w-1.5 h-1.5 rounded-full bg-stone-beige self-center"
          />
        );
      default:
        return (
          <span
            aria-hidden="true"
            title="低优先"
            className="shrink-0 w-1.5 h-1.5 rounded-full bg-ashy-beige self-center"
          />
        );
    }
  };

  // 每页 3 张独立任务卡：满页时在可用高度内均分（flex-1 + min-h 下限），
  // 少于 3 张时保持自然高度顶部排列，不无限拉高
  const fillAvailable = pagedItems.length === UPCOMING_DDL_PAGE_SIZE;

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

      {/* DDL Task Cards：每页 3 张；卡片无 shadow、无嵌套小卡 */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none flex flex-col gap-2 py-1.5">
        {pagedItems.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-xs text-sandrift space-y-1 min-h-24">
            <CheckCircle2 className="w-6 h-6 text-success" />
            <p>暂无临近 DDL</p>
          </div>
        ) : (
          pagedItems.map((task) => {
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
                role="button"
                tabIndex={0}
                onKeyDown={cardKeyHandler(() => setSelectedAssignmentId(task.id))}
                aria-label={`${task.title}，${course?.name || "通用课题"}，${format(ddlDate, "M月d日 EEE", { locale: zhCN })} ${format(ddlDate, "HH:mm")}，${relativeTime}`}
                className={cn(
                  "group flex items-center gap-3 p-2.5 rounded-lg border border-line bg-[#F7F5F5]",
                  "cursor-pointer transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
                  "hover:bg-alabaster hover:border-[#CDB9AB]",
                  fillAvailable && "flex-1 min-h-[72px]"
                )}
              >
                {/* 左侧 Calendar Date Anchor（decorative；日期事实由同一 ddlDate 承担） */}
                <DDLDateTile date={ddlDate} taskId={task.id} />

                {/* 中间：Title + Course + Priority（min-w-0 防止长标题推走右侧） */}
                <div className="min-w-0 flex-1">
                  <h4 className="text-[13px] font-bold text-charcoal truncate group-hover:text-black leading-5">
                    {task.title}
                  </h4>
                  <div className="flex items-center gap-1.5 min-w-0 mt-0.5">
                    <span className="text-[11px] text-satin-grey truncate">
                      {course?.name || "通用课题"}
                    </span>
                    {getPriorityMark(task.priority)}
                  </div>
                </div>

                {/* 右侧：relative urgency（主）+ 精确时间（次） */}
                <div className="shrink-0 text-right">
                  <div className="text-[11px] font-bold text-danger/90 truncate">
                    {relativeTime}
                  </div>
                  <div className="text-[10px] text-sandrift tabular-nums mt-0.5">
                    {format(ddlDate, "HH:mm")}
                  </div>
                </div>
              </div>
            );
          })
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
