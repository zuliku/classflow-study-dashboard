"use client";

import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { useAppStore } from "@/store/useAppStore";
import { computeWeekCourseLoad } from "@/lib/studyLoad";

export function StudyLoadChart() {
  const { schedules, semester } = useAppStore();

  const today = new Date();
  const weekLoad = computeWeekCourseLoad(schedules, semester);
  const todayIndex = (today.getDay() + 6) % 7; // 周一=0 ... 周日=6
  const maxDayHours = Math.max(...weekLoad.days.map((d) => d.hours), 0);
  const yAxisMax = Math.max(6, Math.ceil(maxDayHours + 1));

  return (
    <div className="bg-white border border-[#E7E3DD] rounded-2xl p-4 shadow-subtle flex flex-col justify-between h-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-2.5 border-b border-[#F0EBE1]">
        <h3 className="text-sm font-bold text-charcoal">
          本周课程负荷
        </h3>
        <span className="text-[10px] font-semibold text-[#8C827A] bg-[#F7F5F5] px-2 py-1 rounded-lg border border-[#E7E3DD]">
          {weekLoad.isInSemester
            ? `第 ${weekLoad.week} 周 · 按实际课表统计`
            : "本周不在教学周内"}
        </span>
      </div>

      {/* Content Body */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center mt-3">
        {/* Left Metrics */}
        <div className="space-y-1">
          <div className="flex items-baseline space-x-1">
            <span className="text-2xl font-bold text-charcoal tracking-tight">
              {weekLoad.totalHours}
            </span>
            <span className="text-xs font-semibold text-[#676268]">小时</span>
          </div>
          <p className="text-[11px] text-[#8C827A]">本周课程时长</p>
          <p className="text-[10px] font-semibold text-[#4A7C59]">
            按课表统计
          </p>
        </div>

        {/* Right Recharts Bar Chart */}
        <div className="md:col-span-2 h-36 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={weekLoad.days}
              margin={{ top: 10, right: 10, left: -25, bottom: 0 }}
            >
              <XAxis
                dataKey="day"
                tick={{ fontSize: 10, fill: "#8C827A" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 9, fill: "#8C827A" }}
                axisLine={false}
                tickLine={false}
                unit="h"
                domain={[0, yAxisMax]}
              />
              <Tooltip
                cursor={{ fill: "rgba(240, 235, 225, 0.4)" }}
                contentStyle={{
                  backgroundColor: "#313032",
                  borderColor: "#313032",
                  borderRadius: "10px",
                  color: "#FFFFFF",
                  fontSize: "11px",
                  padding: "6px 10px",
                }}
                formatter={(value: any) => [`${value} 小时`, "课程时长"]}
              />
              <Bar
                dataKey="hours"
                radius={[4, 4, 0, 0]}
              >
                {weekLoad.days.map((_, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={index === todayIndex ? "#A48F82" : "#CDB9AB"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
