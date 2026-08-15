"use client";

import React from "react";
import { useEffectiveReducedMotion } from "@/hooks/useEffectiveReducedMotion";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { LearningTrendPoint } from "@/lib/analytics/types";

const PLAN_COLOR = "#CDB9AB";
const FOCUS_COLOR = "#627566";

/** 学习趋势：计划 vs 实际专注（两组相邻 Bar；完成数仅 Tooltip）。
 *  planCoverageFull=false → 隐藏计划序列（避免把 marker 前的 0 解释成"没有计划"） */
export function LearningTrendChart({
  points,
  planCoverageFull = true,
}: {
  points: LearningTrendPoint[];
  planCoverageFull?: boolean;
}) {
  const reducedMotion = useEffectiveReducedMotion();
  const data = points.map((p) => ({
    key: p.key,
    label: p.label,
    计划: planCoverageFull ? p.plannedMinutes : undefined,
    实际专注: p.focusMinutes,
    completed: p.completedAssignments,
  }));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#F0EBE1" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#A48F82" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 9, fill: "#A48F82" }} axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(value, name, item) => {
              const entry = item.payload as { completed?: number };
              if (name === "completed") return [`${value} 项`, "完成任务"];
              return [`${value} 分钟`, name as string];
            }}
            contentStyle={{
              backgroundColor: "#313032",
              borderRadius: "10px",
              color: "#FFF",
              fontSize: "11px",
            }}
          />
          {planCoverageFull && (
            <Bar dataKey="计划" fill={PLAN_COLOR} radius={[3, 3, 0, 0]} isAnimationActive={!reducedMotion} animationDuration={reducedMotion ? 0 : 400} />
          )}
          <Bar dataKey="实际专注" fill={FOCUS_COLOR} radius={[3, 3, 0, 0]} isAnimationActive={!reducedMotion} animationDuration={reducedMotion ? 0 : 400} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
