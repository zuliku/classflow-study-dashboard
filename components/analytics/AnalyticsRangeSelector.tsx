"use client";

import React from "react";
import { AnalyticsRangePreset } from "@/lib/analytics/types";
import { cn } from "@/lib/utils";

const PRESET_LABELS: Record<AnalyticsRangePreset, string> = {
  week: "本周",
  "4weeks": "近 4 周",
  semester: "本学期",
};

/** 分析范围选择（本周 / 近 4 周 / 本学期） */
export function AnalyticsRangeSelector({
  value,
  onChange,
}: {
  value: AnalyticsRangePreset;
  onChange: (preset: AnalyticsRangePreset) => void;
}) {
  return (
    <div
      role="group"
      aria-label="分析范围"
      className="flex items-center gap-1 bg-alabaster p-0.5 rounded-lg border border-line-strong"
    >
      {(["week", "4weeks", "semester"] as AnalyticsRangePreset[]).map((preset) => {
        const active = value === preset;
        return (
          <button
            key={preset}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(preset)}
            className={cn(
              "px-2.5 py-1 rounded-md text-[11px] font-bold whitespace-nowrap transition-colors duration-[var(--motion-fast)]",
              active
                ? "bg-white text-charcoal shadow-subtle"
                : "text-satin-grey hover:text-charcoal"
            )}
          >
            {PRESET_LABELS[preset]}
          </button>
        );
      })}
    </div>
  );
}
