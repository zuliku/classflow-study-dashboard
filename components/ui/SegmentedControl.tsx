"use client";

import React from "react";
import { cn } from "@/lib/utils";

/**
 * 全局 SegmentedControl primitive（UI Productization Task 2A）。
 * role=group + aria-pressed buttons；无 animated slider / feature variants。
 */
export interface SegmentedOption<T extends string | number> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string | number> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  ariaLabel?: string;
  className?: string;
}

export function SegmentedControl<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "flex items-center gap-1 bg-alabaster p-0.5 rounded-lg border border-line-strong",
        className
      )}
    >
      {options.map((option) => {
        const isActive = value === option.value;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={isActive}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "px-2.5 py-1.5 rounded-md text-[11px] font-bold whitespace-nowrap transition-colors duration-[var(--motion-fast)]",
              "focus-visible:outline-2 focus-visible:outline-charcoal/30",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              isActive
                ? "bg-white text-charcoal shadow-subtle"
                : "text-satin-grey hover:text-charcoal"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
