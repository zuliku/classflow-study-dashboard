"use client";

import React from "react";
import { cn } from "@/lib/utils";

/**
 * 全局 Field primitive（UI Productization Task 2C）：
 * 只负责 Label / Description / Control / Error 的布局与语义；不管理任何 state。
 * 垂直节奏统一：label → 4-6px → control → 4px → error/description。
 */
export interface FieldProps {
  label?: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  description?: React.ReactNode;
  error?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Field({
  label,
  htmlFor,
  required,
  description,
  error,
  children,
  className,
}: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <label
          htmlFor={htmlFor}
          className="block text-[11px] font-bold text-charcoal"
        >
          {label}
          {required ? <span className="text-danger"> *</span> : null}
        </label>
      ) : null}
      {children}
      {error ? <p className="text-[10px] font-semibold text-danger">{error}</p> : null}
      {description && !error ? (
        <p className="text-[10px] text-sandrift">{description}</p>
      ) : null}
    </div>
  );
}
