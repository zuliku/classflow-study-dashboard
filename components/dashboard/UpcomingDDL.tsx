"use client";

import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Clock, ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { format, formatDistanceToNow, differenceInDays } from "date-fns";
import { zhCN } from "date-fns/locale";
import { parseLocalDDL } from "@/lib/ddl";
import { paginate } from "@/lib/pagination";
import { DDL_DENSITY_METRICS, resolveAdaptiveDdlLayout, DdlDensity } from "@/lib/ui/adaptiveDdlLayout";
import { cn, cardKeyHandler } from "@/lib/utils";

function DDLDateTile({ date, taskId, density }: { date: Date; taskId: string; density: DdlDensity }) {
  const metrics = DDL_DENSITY_METRICS[density];
  return (
    <div
      aria-hidden="true"
      data-testid={`upcoming-ddl-date-${taskId}`}
      className="shrink-0 rounded-xl border border-line bg-surface flex flex-col items-center justify-center leading-none"
      style={{ width: metrics.dateTile.w, height: metrics.dateTile.h }}
    >
      <span className="text-[9px] font-semibold text-sandrift">{format(date, "M月")}</span>
      <span className="font-bold tabular-nums text-warning leading-none mt-1" style={{ fontSize: density === "compact" ? 15 : density === "spacious" ? 19 : 17 }}>{format(date, "d")}</span>
      <span className="text-[9px] font-semibold text-satin-grey mt-1">{format(date, "EEE", { locale: zhCN })}</span>
    </div>
  );
}

export function UpcomingDDL() {
  const { assignments, courses, setSelectedAssignmentId, setActiveTab, preferences } = useAppStore();
  const [currentPage, setCurrentPage] = useState(1);
  const today = new Date();
  const warningDays = preferences.ddlWarningDays;

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

  const containerRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const [availableHeight, setAvailableHeight] = useState(360);
  const [prevPageSize, setPrevPageSize] = useState(3);

  const layout = useMemo(() => resolveAdaptiveDdlLayout({ availableHeight, itemCount: upcomingAssignments.length }), [availableHeight, upcomingAssignments.length]);
  const pageSize = layout.pageSize || 4;
  const density = layout.density;
  const cardHeight = layout.cardHeight;

  // ResizeObserver for adaptive height
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      const total = el.clientHeight;
      const headerH = headerRef.current?.offsetHeight ?? 56;
      const footerH = footerRef.current?.offsetHeight ?? 36;
      const listH = total - headerH - footerH - 12;
      if (Math.abs(listH - availableHeight) > 12) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => setAvailableHeight(Math.max(80, listH)));
      }
    };
    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [availableHeight]);

  // Preserve anchor when pageSize changes
  const handlePageSizeChange = useCallback(
    (newSize: number) => {
      if (newSize !== prevPageSize) {
        const oldStart = (currentPage - 1) * prevPageSize;
        const newPage = Math.floor(oldStart / newSize) + 1;
        setCurrentPage(newPage);
        setPrevPageSize(newSize);
      }
    },
    [currentPage, prevPageSize]
  );

  useEffect(() => {
    handlePageSizeChange(pageSize);
  }, [pageSize, handlePageSizeChange]);

  // Clamp page when itemCount changes
  useEffect(() => {
    const totalPages = pageSize > 0 ? Math.ceil(upcomingAssignments.length / pageSize) : 1;
    if (currentPage > totalPages) setCurrentPage(Math.max(1, totalPages));
  }, [upcomingAssignments.length, pageSize, currentPage]);

  const paged = useMemo(() => paginate(upcomingAssignments, currentPage, pageSize), [upcomingAssignments, currentPage, pageSize]);
  const pagedItems = paged.items;
  const totalPages = paged.totalPages;
  const safePage = paged.currentPage;
  const showPagination = upcomingAssignments.length > pageSize;

  const getPriorityMark = (priority: string) => {
    switch (priority) {
      case "urgent":
        return <span className="shrink-0 px-1.5 py-px rounded text-[10px] font-bold bg-danger-bg text-danger border border-danger-border leading-4">紧急</span>;
      case "high":
        return <span className="shrink-0 px-1.5 py-px rounded text-[10px] font-bold bg-warning-bg text-warning border border-warning-border leading-4">高优</span>;
      case "medium":
        return <span aria-hidden="true" title="中优先" className="shrink-0 w-1.5 h-1.5 rounded-full bg-stone-beige self-center" />;
      default:
        return <span aria-hidden="true" title="低优先" className="shrink-0 w-1.5 h-1.5 rounded-full bg-ashy-beige self-center" />;
    }
  };

  const metrics = DDL_DENSITY_METRICS[density];
  const cardPadding = density === "compact" ? "p-2" : density === "spacious" ? "p-3.5" : "p-2.5";

  return (
    <div
      ref={containerRef}
      data-testid="upcoming-ddl-card"
      data-density={density}
      className="bg-surface border border-line rounded-xl p-3.5 shadow-subtle flex flex-col min-h-0 h-full"
    >
      <div ref={headerRef} className="flex items-center justify-between border-b border-line-soft pb-3 shrink-0">
        <div className="flex items-center space-x-2">
          <Clock className="w-4 h-4 text-danger" />
          <h3 className="text-sm font-bold text-charcoal tracking-tight">临近 DDL</h3>
          <span className="text-[10px] font-semibold text-sandrift">{paged.totalItems} 项待办</span>
        </div>
        <button onClick={() => setActiveTab("assignments")} className="text-[11px] font-semibold text-sandrift hover:text-charcoal flex items-center transition-colors">
          <span>全部任务</span>
          <ArrowUpRight className="w-3 h-3 ml-0.5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col py-1.5" style={{ ["--ddl-card-height" as string]: `${cardHeight}px` } as React.CSSProperties}>
        {pagedItems.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-xs text-sandrift space-y-1 min-h-24">
            <CheckCircle2 className="w-6 h-6 text-success" />
            <p>暂无临近 DDL</p>
          </div>
        ) : (
          <div
            key={`${safePage}-${pageSize}-${density}-${cardHeight}`}
            className="grid ux-agenda-enter"
            style={{ gridTemplateRows: `repeat(${pagedItems.length}, ${cardHeight}px)`, gap: `${metrics.gap}px` }}
          >
            {pagedItems.map((task) => {
              const course = courses.find((c) => c.id === task.courseId);
              const ddlDate = parseLocalDDL(task.ddl) ?? new Date();
              const relativeTime = formatDistanceToNow(ddlDate, { addSuffix: true, locale: zhCN });
              return (
                <div
                  key={task.id}
                  onClick={() => setSelectedAssignmentId(task.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={cardKeyHandler(() => setSelectedAssignmentId(task.id))}
                  aria-label={`${task.title}，${course?.name || "通用课题"}，${format(ddlDate, "M月d日 EEE", { locale: zhCN })} ${format(ddlDate, "HH:mm")}，${relativeTime}`}
                  className={cn(
                    "group flex items-center rounded-lg border border-line bg-surface-soft",
                    "cursor-pointer transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]",
                    "hover:bg-alabaster hover:border-line-strong",
                    cardPadding,
                    density === "compact" ? "gap-x-2.5" : "gap-x-3"
                  )}
                  style={{ height: cardHeight }}
                >
                  <DDLDateTile date={ddlDate} taskId={task.id} density={density} />
                  <div className="min-w-0 flex-1">
                    <h4 className="text-[13px] font-bold text-charcoal truncate group-hover:text-black leading-5">{task.title}</h4>
                    <div className="flex items-center gap-1.5 min-w-0 mt-0.5">
                      <span className="text-[11px] text-satin-grey truncate">{course?.name || "通用课题"}</span>
                      {getPriorityMark(task.priority)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right min-w-[76px]">
                    <div className="text-[11px] font-bold text-danger/90 truncate">{relativeTime}</div>
                    <div className="text-[10px] text-sandrift tabular-nums mt-0.5">{format(ddlDate, "HH:mm")}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div ref={footerRef} data-testid="upcoming-ddl-pagination" className="pt-2 border-t border-line-soft flex items-center justify-between shrink-0">
        <span className="text-[11px] text-sandrift">{showPagination ? `${safePage} / ${totalPages}` : `共 ${paged.totalItems} 项`}</span>
        {showPagination && (
          <span className="inline-flex items-center gap-1">
            <button onClick={() => setCurrentPage(safePage - 1)} disabled={safePage <= 1} aria-label="上一页" className="w-6 h-6 flex items-center justify-center rounded-md text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-sandrift">
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setCurrentPage(safePage + 1)} disabled={safePage >= totalPages} aria-label="下一页" className="w-6 h-6 flex items-center justify-center rounded-md text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-sandrift">
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
