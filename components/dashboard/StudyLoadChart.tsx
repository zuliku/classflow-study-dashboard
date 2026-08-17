"use client";

import React from "react";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  CartesianGrid,
  ReferenceLine,
  LabelList,
} from "recharts";
import { useAppStore } from "@/store/useAppStore";
import { computeWeekCourseLoad, WeekDayLoad } from "@/lib/studyLoad";

interface TooltipEntry {
  payload: WeekDayLoad;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: TooltipEntry[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload;
  return (
    <div
      className="rounded-xl px-2.5 py-1.5 text-[11px] shadow-card"
      style={{ backgroundColor: "#313032", color: "#FFFFFF" }}
    >
      <p className="font-bold">{d.day}</p>
      <p className="text-white/85">
        {d.hours} 小时 · {d.count} 节课
      </p>
    </div>
  );
}

export function StudyLoadChart() {
  const reducedMotion = useEffectiveReducedMotion();
  const { schedules, scheduleOccurrenceOverrides, semester } = useAppStore();

  const today = new Date();
  // 补课 / 调课 / 停课计入实际负荷（与课表同一 resolver；extra 计入、cancel 不计入、move 在目标位）
  const weekLoad = computeWeekCourseLoad(schedules, semester, undefined, scheduleOccurrenceOverrides);
  const todayIndex = (today.getDay() + 6) % 7; // 周一=0 ... 周日=6
  const maxDayHours = Math.max(...weekLoad.days.map((d) => d.hours), 0);
  const yAxisMax = Math.max(6, Math.ceil(maxDayHours + 1));

  return (
    <div
      data-testid="study-load-card"
      className="bg-surface border border-line rounded-xl p-4 shadow-subtle flex flex-col justify-between h-full"
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-2.5 border-b border-line-soft shrink-0">
        <h3 className="text-sm font-bold text-charcoal">
          本周课程负荷
        </h3>
        <span className="text-[10px] font-semibold text-sandrift">
          {weekLoad.isInSemester
            ? `第 ${weekLoad.week} 周 · 按实际课表统计`
            : "本周不在教学周内"}
        </span>
      </div>

      {/* Summary Metrics：总时长 / 本周排课 / 日均课时 */}
      <div className="grid grid-cols-3 gap-3 mt-3 shrink-0">
        <div className="space-y-0.5">
          <div className="flex items-baseline space-x-1">
            <span className="text-2xl font-bold text-charcoal tracking-tight">
              {weekLoad.totalHours}
            </span>
            <span className="text-xs font-semibold text-satin-grey">h</span>
          </div>
          <p className="text-[11px] text-sandrift">本周课程时长</p>
        </div>
        <div className="space-y-0.5">
          <div className="flex items-baseline space-x-1">
            <span className="text-2xl font-bold text-charcoal tracking-tight">
              {weekLoad.totalSessions}
            </span>
            <span className="text-xs font-semibold text-satin-grey">节</span>
          </div>
          <p className="text-[11px] text-sandrift">本周排课</p>
        </div>
        <div className="space-y-0.5">
          <div className="flex items-baseline space-x-1">
            <span className="text-2xl font-bold text-charcoal tracking-tight">
              {weekLoad.averageHours}
            </span>
            <span className="text-xs font-semibold text-satin-grey">h</span>
          </div>
          <p className="text-[11px] text-sandrift">日均课时</p>
        </div>
      </div>

      {/* 最忙辅助信息（仅教学周内有值） */}
      <p className="text-[11px] text-sandrift mt-2 shrink-0">
        {weekLoad.busiestDay
          ? `最忙：${weekLoad.busiestDay.day} · ${weekLoad.busiestDay.hours}h`
          : "本周暂无课程安排"}
      </p>

      {/* Full-width Chart：横向占满卡片主体 */}
      <div className="flex-1 min-h-0 mt-2 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={weekLoad.days}
            margin={{ top: 16, right: 8, left: -25, bottom: 0 }}
          >
            {/* 水平辅助网格线：非常淡 */}
            <CartesianGrid horizontal={true} vertical={false} stroke="#E3DDD2" strokeDasharray="3 4" />
            {/* 日均课时参考线：虚线 + 低对比度（0 时不绘制，避免与坐标轴重叠） */}
            {weekLoad.averageHours > 0 && (
              <ReferenceLine
                y={weekLoad.averageHours}
                stroke="#A48F82"
                strokeDasharray="4 4"
                strokeOpacity={0.55}
                ifOverflow="extendDomain"
              />
            )}
            <XAxis
              dataKey="day"
              tick={{ fontSize: 10, fill: "#A48F82" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#A48F82" }}
              axisLine={false}
              tickLine={false}
              unit="h"
              domain={[0, yAxisMax]}
            />
            <Tooltip
              cursor={{ fill: "rgba(240, 235, 225, 0.4)" }}
              content={<ChartTooltip />}
            />
            <Bar
              dataKey="hours"
              radius={[4, 4, 0, 0]}
              isAnimationActive={!reducedMotion}
              animationDuration={reducedMotion ? 0 : 300}
              animationEasing="ease-out"
            >
              {weekLoad.days.map((d, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={index === todayIndex ? "#A48F82" : "#CDB9AB"}
                />
              ))}
              {/* 柱顶小时数：足够弱，不抢视觉焦点；0 值不绘制 */}
              <LabelList
                dataKey="hours"
                position="top"
                formatter={(value: number | string) =>
                  Number(value) > 0 ? String(Number(value)) : ""
                }
                style={{ fill: "#A48F82", fontSize: 10, fontWeight: 600 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
