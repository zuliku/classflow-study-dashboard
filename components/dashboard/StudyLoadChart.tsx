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
      style={{ backgroundColor: "var(--dark-charcoal)", color: "#FFFFFF" }}
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
  // 精确 selector：避免整 store 订阅导致无关 state 更新触发整卡 re-render
  const schedules = useAppStore((s) => s.schedules);
  const scheduleOccurrenceOverrides = useAppStore((s) => s.scheduleOccurrenceOverrides);
  const semester = useAppStore((s) => s.semester);

  const today = new Date();
  const weekLoad = computeWeekCourseLoad(schedules, semester, undefined, scheduleOccurrenceOverrides);
  const todayIndex = (today.getDay() + 6) % 7;
  const isEmpty = weekLoad.totalHours === 0 && weekLoad.totalSessions === 0;

  return (
    <div
      data-testid="study-load-card"
      className="dashboard-card p-4 flex flex-col h-full"
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-line-soft shrink-0">
        <h3 className="text-sm font-semibold text-charcoal">本周课程负荷</h3>
        <span className="text-[11px] font-semibold text-sandrift">
          {weekLoad.isInSemester ? `第 ${weekLoad.week} 周` : "本周不在教学周内"}
        </span>
      </div>

      {/* Metrics — unified metric strip：Level 2 inset 表面（surface-inset）+ divide 分隔，
          无独立卡片/阴影，消除 card-inside-card 感；三个等宽指标与信息保持不变 */}
      <div className="mt-3 shrink-0 grid grid-cols-3 divide-x divide-line-soft surface-inset rounded-xl overflow-hidden">
        <div className="px-4 py-3 min-h-[80px] flex flex-col justify-center">
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-bold text-charcoal tracking-tight">{isEmpty ? "0" : weekLoad.totalHours}</span>
            <span className="text-[11px] font-semibold text-satin-grey">h</span>
          </div>
          <p className="text-[10px] font-semibold text-sandrift mt-0.5">本周课时</p>
        </div>
        <div className="px-4 py-3 min-h-[80px] flex flex-col justify-center">
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-bold text-charcoal tracking-tight">{isEmpty ? "0" : weekLoad.totalSessions}</span>
            <span className="text-[11px] font-semibold text-satin-grey">节</span>
          </div>
          <p className="text-[10px] font-semibold text-sandrift mt-0.5">课程安排</p>
        </div>
        <div className="px-4 py-3 min-h-[80px] flex flex-col justify-center">
          {/* 值行高度与前两格 text-xl 行高（28px）对齐，保证三列标签基线一致 */}
          <div className="h-7 flex items-center">
            <span className="text-[13px] font-bold text-charcoal leading-none truncate">
              {isEmpty || !weekLoad.busiestDay ? "—" : `${weekLoad.busiestDay.day} · ${weekLoad.busiestDay.hours}h`}
            </span>
          </div>
          <p className="text-[10px] font-semibold text-sandrift mt-0.5">最忙</p>
        </div>
      </div>

      {/* Chart — adaptive height, anchored near bottom with breathing */}
      <div className="flex-1 flex flex-col justify-end mt-4 min-h-[330px] max-h-[400px] mb-5">
        {isEmpty ? (
          <div className="h-full flex items-center justify-center text-xs text-sandrift border border-dashed border-line-soft rounded-xl bg-surface-soft/50">
            本周暂无课程安排
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weekLoad.days} margin={{ top: 16, right: 8, left: -25, bottom: 0 }}>
              <CartesianGrid horizontal={true} vertical={false} stroke="var(--alba)" strokeDasharray="3 4" />
              {weekLoad.averageHours > 0 && (
                <ReferenceLine
                  y={weekLoad.averageHours}
                  stroke="var(--sandrift)"
                  strokeDasharray="4 4"
                  strokeOpacity={0.55}
                  ifOverflow="extendDomain"
                  label={{
                    value: `日均 ${weekLoad.averageHours}h`,
                    position: "right",
                    fill: "var(--sandrift)",
                    fontSize: 10,
                    fontWeight: 600,
                  }}
                />
              )}
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--sandrift)" }} axisLine={false} tickLine={false} />
              <YAxis ticks={[0, 4, 8]} tick={{ fontSize: 10, fill: "var(--sandrift)" }} axisLine={false} tickLine={false} unit="h" domain={[0, 8]} />
              <Tooltip cursor={{ fill: "rgba(240, 235, 225, 0.4)" }} content={<ChartTooltip />} />
              <Bar dataKey="hours" radius={[4, 4, 0, 0]} isAnimationActive={!reducedMotion} animationDuration={reducedMotion ? 0 : 300} animationEasing="ease-out">
                {weekLoad.days.map((d, index) => (
                  <Cell key={`cell-${index}`} fill={index === todayIndex ? "var(--sandrift)" : "var(--stone-beige)"} />
                ))}
                <LabelList dataKey="hours" position="top" formatter={(v: number | string) => (Number(v) > 0 ? String(Number(v)) : "")} style={{ fill: "var(--sandrift)", fontSize: 10, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
