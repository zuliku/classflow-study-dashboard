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

  return (
    <div className="bg-white border border-[#E7E3DD] rounded-2xl p-4 shadow-subtle flex flex-col justify-between h-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-2.5 border-b border-[#F0EBE1]">
        <h3 className="text-sm font-bold text-charcoal">
          学习负荷（本周）
        </h3>
        <div className="relative">
          <select
            value={filterMode}
            onChange={(e) => setFilterMode(e.target.value as "course" | "task")}
            className="appearance-none bg-[#F7F5F5] border border-[#E7E3DD] text-charcoal text-[11px] font-medium px-2.5 py-1 pr-6 rounded-lg focus:outline-none cursor-pointer"
          >
            <option value="course">按课程</option>
            <option value="task">按任务</option>
          </select>
          <ChevronDown className="w-3 h-3 text-[#8C827A] absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      {/* Content Body */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center mt-3">
        {/* Left Metrics */}
        <div className="space-y-1">
          <div className="flex items-baseline space-x-1">
            <span className="text-2xl font-bold text-charcoal tracking-tight">
              24.5
            </span>
            <span className="text-xs font-semibold text-[#676268]">小时</span>
          </div>
          <p className="text-[11px] text-[#8C827A]">预计学习时长</p>
          <div className="inline-flex items-center text-[10px] font-semibold text-[#D94F4F] mt-1">
            较上周 +3.2 小时 <ArrowUpRight className="w-3 h-3 ml-0.5" />
          </div>
        </div>

        {/* Right Recharts Bar Chart matching reference image 2 */}
        <div className="md:col-span-2 h-36 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={mockStudyLoadData}
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
                domain={[0, 6]}
                ticks={[0, 2, 4, 6]}
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
                formatter={(value: any) => [`${value} 小时`, "学习时长"]}
              />
              <Bar
                dataKey={filterMode === "course" ? "hours" : "taskHours"}
                radius={[4, 4, 0, 0]}
              >
                {mockStudyLoadData.map((_, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={index === 2 ? "#A48F82" : "#CDB9AB"}
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
