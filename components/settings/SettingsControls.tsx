"use client";

import React from "react";
import { cn } from "@/lib/utils";

/**
 * Settings 共享控件 primitives（Settings V3 Task 1）：
 * 统一高度、字体、边框、focus-visible ring、disabled 状态。
 * 圆角体系：Input/Button/Segmented = 小圆角（rounded-lg）；Segmented 内项 = rounded-md。
 * 不建完整 UI framework，只收敛设置页常用的控件。
 */

const controlCls =
  "h-9 px-2.5 bg-[#F7F5F5] border border-line rounded-lg text-xs font-bold text-charcoal focus:outline-none focus:border-charcoal focus-visible:outline-2 focus-visible:outline-charcoal/30 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

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

/** 开关（role=switch；pill 形态保留） */
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
        "focus-visible:outline-2 focus-visible:outline-charcoal/30 focus-visible:outline-offset-2",
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

/** 分段选择（3–4 项短文案，如 1/3/7 天、舒适/紧凑；值可为 string 或 number） */
export function SettingsSegmentedControl<T extends string | number>({
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
      className="flex items-center gap-1 bg-alabaster p-0.5 rounded-lg border border-line-strong"
    >
      {options.map((o) => {
        const isActive = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            aria-pressed={isActive}
            className={cn(
              "px-2.5 py-1.5 rounded-md text-[11px] font-bold whitespace-nowrap transition-colors duration-[var(--motion-fast)]",
              "focus-visible:outline-2 focus-visible:outline-charcoal/30",
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

export type SettingsButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_VARIANTS: Record<SettingsButtonVariant, string> = {
  primary: "bg-charcoal text-white hover:bg-black shadow-subtle",
  secondary: "bg-white border border-line text-charcoal hover:bg-alabaster",
  ghost: "text-satin-grey hover:bg-alabaster hover:text-charcoal",
  danger: "bg-danger-bg text-danger border border-danger-border hover:bg-danger-border",
};

/** 动作按钮（统一 h-8 / rounded-lg / 小号字体 / disabled）；icon 由调用方传入 */
export function SettingsButton({
  variant = "secondary",
  disabled,
  onClick,
  children,
  className,
  "aria-label": ariaLabel,
  testid,
}: {
  variant?: SettingsButtonVariant;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  "aria-label"?: string;
  testid?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      data-testid={testid}
      className={cn(
        "ux-press flex items-center gap-1.5 px-3 h-8 text-[11px] font-bold rounded-lg transition-colors shrink-0",
        "focus-visible:outline-2 focus-visible:outline-charcoal/30",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        BUTTON_VARIANTS[variant],
        className
      )}
    >
      {children}
    </button>
  );
}
