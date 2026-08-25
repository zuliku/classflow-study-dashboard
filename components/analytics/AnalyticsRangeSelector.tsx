"use client";

import React from "react";
import { AnalyticsRangePreset } from "@/lib/analytics/types";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

const PRESET_LABELS: Record<AnalyticsRangePreset, string> = {
  week: "本周",
  "4weeks": "近 4 周",
  semester: "本学期",
};

/**
 * 分析范围选择（本周 / 近 4 周 / 本学期）。
 * Workflow UX Motion M3：从手写三 button（active 瞬间切背景）收敛为
 * 共享 SegmentedControl——single moving Active Plate（--motion-base /
 * --ease-emphasized），programmatic change（周回顾回跳）同样自然移动。
 * AnalyticsRangePreset 业务语义完全不变。
 */
export function AnalyticsRangeSelector({
  value,
  onChange,
}: {
  value: AnalyticsRangePreset;
  onChange: (preset: AnalyticsRangePreset) => void;
}) {
  return (
    <SegmentedControl<AnalyticsRangePreset>
      value={value}
      onChange={onChange}
      ariaLabel="分析范围"
      options={[
        { value: "week", label: PRESET_LABELS.week },
        { value: "4weeks", label: PRESET_LABELS["4weeks"] },
        { value: "semester", label: PRESET_LABELS.semester },
      ]}
    />
  );
}
