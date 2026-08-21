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
  const weekLoad = computeWeekCourseLoad(schedules, semester, undefined, scheduleOccurrenceOverrides);
  const todayIndex = (today.getDay() + 6) % 7;
  const isEmpty = weekLoad.totalHours === 0 && weekLoad.totalSessions === 0;

  return (
    <div
      data-testid="study-load-card"
      className="bg-surface border border-line rounded-xl p-4 shadow-subtle flex flex-col h-full"
    >
      {/* Header — simplified */}
      <div className="flex items-center justify-between pb-3 border-b border-line-soft shrink-0">
        <h3 className="text-sm font-bold text-charcoal">本周课程负荷</h3>
        <span className="text-[11px] font-semibold text-sandrift">
          {weekLoad.isInSemester ? `第 ${weekLoad.week} 周` : "本周不在教学周内"}
        </span>
      </div>

      {/* Metrics — 3 equal light boxes */}
      <div className="grid grid-cols-3 gap-2.5 mt-3 shrink-0">
        <div className="bg-surface-soft border border-line-soft rounded-xl p-3 flex flex-col justify-center min-h-[72px]">
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-bold text-charcoal tracking-tight">{isEmpty ? "0" : weekLoad.totalHours}</span>
            <span className="text-[11px] font-semibold text-satin-grey">h</span>
          </div>
          <p className="text-[10px] font-semibold text-sandrift mt-1">本周课时</p>
        </div>
        <div className="bg-surface-soft border border-line-soft rounded-xl p-3 flex flex-col justify-center min-h-[72px]">
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-bold text-charcoal tracking-tight">{isEmpty ? "0" : weekLoad.totalSessions}</span>
            <span className="text-[11px] font-semibold text-satin-grey">节</span>
          </div>
          <p className="text-[10px] font-semibold text-sandrift mt-1">课程安排</p>
        </div>
        <div className="bg-surface-soft border border-line-soft rounded-xl p-3 flex flex-col justify-center min-h-[72px]">
          <div className="text-[13px] font-bold text-charcoal leading-5 truncate">
            {isEmpty || !weekLoad.busiestDay ? "—" : `${weekLoad.busiestDay.day} · ${weekLoad.busiestDay.hours}h`}
          </div>
          <p className="text-[10px] font-semibold text-sandrift mt-1">最忙</p>
        </div>
      </div>

      {/* Chart — bounded height, not flex-1 infinite */}
      <div className="mt-3 shrink-0" style={{ height: "clamp(250px, 28vh, 310px)" }}>
        {isEmpty ? (
          <div className="h-full flex items-center justify-center text-xs text-sandrift border border-dashed border-line-soft rounded-xl bg-surface-soft/50">
            本周暂无课程安排
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weekLoad.days} margin={{ top: 16, right: 8, left: -25, bottom: 0 }}>
              <CartesianGrid horizontal={true} vertical={false} stroke="#E3DDD2" strokeDasharray="3 4" />
              {weekLoad.averageHours > 0 && (
                <ReferenceLine
                  y={weekLoad.averageHours}
                  stroke="#A48F82"
                  strokeDasharray="4 4"
                  strokeOpacity={0.55}
                  ifOverflow="extendDomain"
                  label={{
                    value: `日均 ${weekLoad.averageHours}h`,
                    position: "right",
                    fill: "#A48F82",
                    fontSize: 10,
                    fontWeight: 600,
                  }}
                />
              )}
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#A48F82" }} axisLine={false} tickLine={false} />
              <YAxis ticks={[0, 4, 8]} tick={{ fontSize: 10, fill: "#A48F82" }} axisLine={false} tickLine={false} unit="h" domain={[0, 8]} />
              <Tooltip cursor={{ fill: "rgba(240, 235, 225, 0.4)" }} content={<ChartTooltip />} />
              <Bar dataKey="hours" radius={[4, 4, 0, 0]} isAnimationActive={!reducedMotion} animationDuration={reducedMotion ? 0 : 300} animationEasing="ease-out">
                {weekLoad.days.map((d, index) => (
                  <Cell key={`cell-${index}`} fill={index === todayIndex ? "#A48F82" : "#CDB9AB"} />
                ))}
                <LabelList dataKey="hours" position="top" formatter={(v: number | string) => (Number(v) > 0 ? String(Number(v)) : "")} style={{ fill: "#A48F82", fontSize: 10, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
