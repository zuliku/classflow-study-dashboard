"use client";

import React, { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { mockStudyLoadData } from "@/lib/mockData";

export function StudyLoadChart() {
  const [filterMode, setFilterMode] = useState<"course" | "task">("course");

  const totalHours = mockStudyLoadData.reduce((acc, d) => acc + d.hours, 0);

  return (
    <div className="bg-white border border-[#E7E3DD] rounded-2xl p-5 shadow-subtle flex flex-col justify-between">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[#F0EBE1]">
        <h3 className="text-base font-bold text-charcoal">
          学习负荷（本周）
        </h3>
        <div className="relative">
          <select
            value={filterMode}
            onChange={(e) => setFilterMode(e.target.value as "course" | "task")}
            className="appearance-none bg-[#F7F5F5] border border-[#E7E3DD] text-charcoal text-xs font-medium px-3 py-1.5 pr-7 rounded-xl focus:outline-none cursor-pointer"
          >
            <option value="course">按课程</option>
            <option value="task">按任务</option>
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-[#8C827A] absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      {/* Content Body: Stats + Recharts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center mt-4">
        {/* Left Metrics */}
        <div className="space-y-2">
          <div className="flex items-baseline space-x-1.5">
            <span className="text-3xl font-extrabold text-charcoal tracking-tight">
              {totalHours}
            </span>
            <span className="text-xs font-semibold text-[#676268]">小时</span>
          </div>
          <p className="text-xs text-[#8C827A]">预计学习时长</p>
          <div className="inline-flex items-center text-xs font-medium text-[#D94F4F] bg-[#FDF0F0] border border-[#F8D7D7] px-2 py-0.5 rounded-md">
            较上周 +3.2 小时 <ArrowUpRight className="w-3.5 h-3.5 ml-0.5" />
          </div>
        </div>

        {/* Right Recharts Bar Chart */}
        <div className="md:col-span-2 h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={mockStudyLoadData}
              margin={{ top: 10, right: 10, left: -25, bottom: 0 }}
            >
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11, fill: "#8C827A" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#8C827A" }}
                axisLine={false}
                tickLine={false}
                unit="h"
              />
              <Tooltip
                cursor={{ fill: "rgba(240, 235, 225, 0.4)" }}
                contentStyle={{
                  backgroundColor: "#313032",
                  borderColor: "#313032",
                  borderRadius: "12px",
                  color: "#FFFFFF",
                  fontSize: "12px",
                  padding: "8px 12px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                }}
                formatter={(value: any) => [`${value} 小时`, "学习时长"]}
              />
              <Bar
                dataKey={filterMode === "course" ? "hours" : "taskHours"}
                radius={[6, 6, 0, 0]}
              >
                {mockStudyLoadData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={index === 2 ? "#A48F82" : "#CDB9AB"} // Highlight Wednesday
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
