"use client";

import React from "react";
import { cn } from "@/lib/utils";

/**
 * 全局 IconButton primitive（UI Productization Task 2A）：正方形 icon control。
 * 只负责 32×32 / 36×36 的 ghost/secondary/primary/danger 语义；
 * 不做 Tooltip / 业务状态 / feature variant。
 * Icon-only 调用方必须提供 aria-label。
 * Workflow UX Motion M1：soft press = opacity 反馈（--motion-snap）——
 * IconButton 多为 Close/Chevron/Toolbar 等空间稳定控件，不做 scale tactile。
 */
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "ghost" | "secondary" | "primary" | "danger";
  size?: "sm" | "md";
}

const ICON_BUTTON_VARIANTS: Record<NonNullable<IconButtonProps["variant"]>, string> = {
  ghost: "text-sandrift hover:bg-alabaster hover:text-charcoal",
  secondary: "bg-white border border-line text-charcoal hover:bg-alabaster",
  primary: "bg-charcoal text-white hover:bg-black",
  danger: "bg-danger-bg text-danger border border-danger-border hover:bg-danger-border",
};

const ICON_BUTTON_SIZES: Record<NonNullable<IconButtonProps["size"]>, string> = {
  sm: "h-8 w-8",
  md: "h-9 w-9",
};

export function IconButton({
  variant = "ghost",
  size = "sm",
  type = "button",
  className,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-lg shrink-0",
        "transition-[background-color,color,opacity] duration-[var(--motion-snap)] ease-[var(--ease-standard)]",
        "active:opacity-75",
        "focus-visible:outline-2 focus-visible:outline-charcoal/30 focus-visible:outline-offset-2",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        ICON_BUTTON_VARIANTS[variant],
        ICON_BUTTON_SIZES[size],
        className
      )}
      {...props}
    />
  );
}
