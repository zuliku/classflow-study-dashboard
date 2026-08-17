"use client";

import React, { useMemo } from "react";
import { CalendarClock, ArrowUpRight } from "lucide-react";
import { format } from "date-fns";
import { useAppStore } from "@/store/useAppStore";

/**
 * 总览页「今日学习计划」：展示今天的时间表任务小卡片（StudyBlock），
 * 与时间表同款浅 mint 底 + 明显边框；点击标题区跳转时间表。
 * 只在总览（Overview）Secondary 区展示，是时间表 StudyBlock 在总览的入口。
 */
export function TodayStudyPlanCard() {
  const studyBlocks = useAppStore((s) => s.studyBlocks);
  const setActiveTab = useAppStore((s) => s.setActiveTab);

  const today = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);

  const todayBlocks = useMemo(
    () =>
      studyBlocks
        .filter((b) => b.date === today)
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [studyBlocks, today]
  );

  return (
    <div className="bg-surface border border-line rounded-2xl p-4 flex flex-col min-h-0 h-full">
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-line-soft">
        <div className="flex items-center gap-1.5 min-w-0">
          <CalendarClock className="w-4 h-4 text-[#A48F82] shrink-0" />
          <h3 className="text-sm font-bold text-charcoal truncate">今日学习计划</h3>
          <span className="text-[10px] font-semibold text-sandrift shrink-0">
            {todayBlocks.length} 项
          </span>
        </div>
        <button
          type="button"
          onClick={() => setActiveTab("timetable")}
          className="flex items-center gap-0.5 text-[11px] font-semibold text-sandrift hover:text-charcoal transition-colors shrink-0"
          aria-label="打开时间表"
        >
          时间表
          <ArrowUpRight className="w-3 h-3" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5 pt-2.5 scrollbar-none">
        {todayBlocks.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-1 py-6">
            <p className="text-xs font-semibold text-sandrift">今天暂无学习计划</p>
            <p className="text-[10px] text-sandrift">可在时间表中添加学习安排</p>
          </div>
        ) : (
          todayBlocks.map((b) => (
            <div
              key={b.id}
              data-testid="overview-study-block"
              title={`${b.title} · ${b.startTime}–${b.endTime}`}
              className="flex items-center gap-2 rounded-lg border border-line bg-pastel-mint/20 px-2 py-1.5"
            >
              <span className="text-[11px] font-bold text-charcoal tabular-nums shrink-0">
                {b.startTime}–{b.endTime}
              </span>
              <span className="truncate text-[11px] font-semibold text-satin-grey">{b.title}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
