"use client";

import React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 全局 Checkbox primitive（UI Productization Task 2C）。
 * 与 Switch 语义不同：Checkbox = 表单内是否包含/启用某选项；
 * 保留真实 checkbox semantics（原生 input + 自定义视觉，非浏览器默认 accent）。
 * 支持 checked / disabled / aria-label / focus-visible / 键盘 Space（原生 input 自带）。
 */
export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}

export function Checkbox({ checked, onChange, label, className, ...props }: CheckboxProps) {
  return (
    <label
      className={cn(
        "relative inline-flex items-center gap-1.5 select-none",
        props.disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        className
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={props.disabled}
        className="peer absolute inset-0 opacity-0 cursor-inherit"
        {...props}
      />
      <span
        aria-hidden="true"
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-md border transition-colors duration-[var(--motion-fast)] pointer-events-none",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-charcoal/30 peer-focus-visible:outline-offset-2",
          checked ? "bg-charcoal border-charcoal text-white" : "bg-white border-line-strong text-transparent",
          props.disabled && "cursor-not-allowed"
        )}
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
      {label ? <span className="text-[11px] font-bold text-charcoal">{label}</span> : null}
    </label>
  );
}
