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
import { AnalyticsPeriod } from "@/lib/analytics/types";
import { formatAnalyticsDuration } from "@/lib/analytics/presentation";
import { formatTrendTooltip } from "@/lib/analytics/presentation";

const PLAN_COLOR = "#CDB9AB";
const FOCUS_COLOR = "#627566";

/**
 * Learning Trend（V3）：页面唯一主分析视觉。
 * - XAxis 使用 V3 UI label（8/10 周一 / 7/20 / 第1周），raw ISO key 只进 tooltip
 * - null = unknown（coverage 起点之前）：不画 bar；tooltip 显示「记录不足」，禁止显示 0
 * - Legend：● 实际专注 / ● 计划学习 + 单位：分钟；计划无任何可靠 bucket → 轻量提示代替 legend
 */
export function LearningTrendChart({
  points,
  period,
  animate = true,
}: {
  points: LearningTrendPoint[];
  period: AnalyticsPeriod;
  /** 是否播放 Recharts 条形入场动画（仅首次 meaningful load 启用；Range 切换由外层 ux-settle 表达） */
  animate?: boolean;
}) {
  const reducedMotion = useEffectiveReducedMotion();
  const hasPlanValues = points.some((p) => p.plannedMinutes !== null);
  const chartActive = animate && !reducedMotion;
  const data = points.map((p) => ({
    key: p.key,
    label: p.label,
    计划: p.plannedMinutes,
    实际专注: p.focusMinutes,
    completed: p.completedAssignments,
  }));
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-2">
        <span className="flex items-center gap-1 text-[10px] font-semibold text-sandrift">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: FOCUS_COLOR }} />
          实际专注
        </span>
        {hasPlanValues ? (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-sandrift">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PLAN_COLOR }} />
            计划学习
          </span>
        ) : (
          <span className="text-[10px] text-satin-grey">计划记录不足，暂不显示完整计划序列</span>
        )}
        <span className="ml-auto text-[10px] text-satin-grey">单位：分钟</span>
      </div>
      <div className="h-56 w-full md:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F0EBE1" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#A48F82" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9, fill: "#A48F82" }} axisLine={false} tickLine={false} />
            <Tooltip
              labelFormatter={(_, payload) => {
                const key = payload?.[0]?.payload?.key as string | undefined;
                return key ? formatTrendTooltip(period, key) : "";
              }}
              formatter={(value, name, item) => {
                const entry = item.payload as { completed?: number };
                if (name === "completed") {
                  return value == null ? ["记录不足", "完成任务"] : [`${value} 项`, "完成任务"];
                }
                // null = unknown：绝不显示 0
                if (value == null) return ["记录不足", name as string];
                return [`${formatAnalyticsDuration(Number(value))}`, name as string];
              }}
              contentStyle={{
                backgroundColor: "#313032",
                borderRadius: "10px",
                color: "#FFF",
                fontSize: "11px",
              }}
              wrapperStyle={{ outline: "none" }}
            />
            {hasPlanValues && (
              <Bar dataKey="计划" fill={PLAN_COLOR} radius={[3, 3, 0, 0]} isAnimationActive={chartActive} animationDuration={chartActive ? 400 : 0} />
            )}
            <Bar dataKey="实际专注" fill={FOCUS_COLOR} radius={[3, 3, 0, 0]} isAnimationActive={chartActive} animationDuration={chartActive ? 400 : 0} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
