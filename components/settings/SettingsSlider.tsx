"use client";

import React from "react";
import { cn } from "@/lib/utils";

/**
 * 设置统一滑杆（界面字号缩放 / 提示音量共用）。
 * - 与 SettingsRow 右侧控件同高语义：滑杆 + 数值 badge 一组，不再裸 <input type="range">。
 * - 禁用态：整体 opacity + 不可聚焦（聚焦仍可读值但不响应，行为诚实）。
 */
export function SettingsSlider({
  value,
  min,
  max,
  step,
  onChange,
  ariaLabel,
  disabled,
  formatValue,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  ariaLabel: string;
  disabled?: boolean;
  formatValue: (v: number) => string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2",
        disabled && "opacity-50"
      )}
    >
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={ariaLabel}
        className={cn(
          "w-32 accent-charcoal cursor-pointer",
          "focus-visible:outline-2 focus-visible:outline-charcoal/30 focus-visible:outline-offset-2 rounded-full",
          "disabled:cursor-not-allowed"
        )}
      />
      <span
        aria-hidden="true"
        className="text-[11px] font-bold text-sandrift min-w-10 text-right tabular-nums"
      >
        {formatValue(value)}
      </span>
    </span>
  );
}
