"use client";

import React from "react";
import { cn } from "@/lib/utils";

/**
 * 全局 Textarea primitive（UI Productization Task 2C）：
 * 与 Input 同一视觉语言；不内置 label；不管理 state；高度由 consumer rows/className 控制。
 */
export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function Textarea({ invalid, className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        "w-full px-2.5 py-2 bg-background border rounded-lg text-xs font-semibold text-charcoal",
        "placeholder:text-sandrift focus:outline-none focus:border-charcoal",
        "disabled:opacity-50 disabled:cursor-not-allowed resize-none leading-relaxed",
        invalid ? "border-danger-border" : "border-line",
        className
      )}
      {...props}
    />
  );
}
