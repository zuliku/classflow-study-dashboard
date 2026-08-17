"use client";

import React from "react";
import { cn } from "@/lib/utils";

/**
 * 全局 Switch primitive（UI Productization Task 2A）：
 * role=switch / aria-checked；几何与 SettingsToggle 一致（w-9 h-5 / thumb w-4 h-4）。
 */
export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onChange, label, disabled, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onChange(!checked);
      }}
      className={cn(
        "relative w-9 h-5 rounded-full transition-colors duration-[var(--motion-fast)]",
        "focus-visible:outline-2 focus-visible:outline-charcoal/30 focus-visible:outline-offset-2",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        checked ? "bg-charcoal" : "bg-alba",
        className
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
