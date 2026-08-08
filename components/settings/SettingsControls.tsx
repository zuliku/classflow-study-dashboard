"use client";

import React from "react";
import { cn } from "@/lib/utils";

/**
 * Settings 共享控件 primitives：
 * 统一高度、字体、边框、focus ring、disabled 状态。
 * 不建完整 UI framework，只收敛设置页常用的三种控件。
 */

const controlCls =
  "h-9 px-2.5 bg-[#F7F5F5] border border-line rounded-xl text-xs font-bold text-charcoal focus:outline-none focus:border-charcoal cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

/** 标准下拉（优先级/状态/动效等） */
export function SettingsSelect<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  ariaLabel?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      aria-label={ariaLabel}
      className={controlCls}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** 开关（role=switch） */
export function SettingsToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative w-9 h-5 rounded-full transition-colors duration-[var(--motion-fast)]",
        checked ? "bg-charcoal" : "bg-alba"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-subtle transition-transform duration-[var(--motion-fast)]",
          checked && "translate-x-4"
        )}
      />
    </button>
  );
}

/** 分段选择（3–4 项短文案，如 1/3/7 天、舒适/紧凑） */
export function SettingsSegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  ariaLabel?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex items-center gap-1 bg-alabaster p-0.5 rounded-xl border border-line-strong"
    >
      {options.map((o) => {
        const isActive = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            aria-pressed={isActive}
            className={cn(
              "px-2.5 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors duration-[var(--motion-fast)]",
              isActive
                ? "bg-white text-charcoal shadow-subtle"
                : "text-satin-grey hover:text-charcoal"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
