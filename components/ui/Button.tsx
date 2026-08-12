"use client";

import React from "react";
import { cn } from "@/lib/utils";

/**
 * 全局 Button primitive（UI Productization Task 2A）。
 * feature-neutral；不读 Store；透传全部原生 button props（aria / data 属性、type、disabled、title、onClick）。
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "accent";
export type ButtonSize = "sm" | "md";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-charcoal text-white hover:bg-black",
  secondary: "bg-white border border-line text-charcoal hover:bg-alabaster",
  ghost: "text-satin-grey hover:bg-alabaster hover:text-charcoal",
  danger: "bg-danger-bg text-danger border border-danger-border hover:bg-danger-border",
  accent: "bg-pastel-mint text-charcoal hover:bg-pastel-mint",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[11px]",
  md: "h-9 px-3.5 text-xs",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = "secondary",
  size = "sm",
  type = "button",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "ux-press inline-flex items-center justify-center gap-1.5 rounded-lg font-bold transition-colors shrink-0",
        "focus-visible:outline-2 focus-visible:outline-charcoal/30 focus-visible:outline-offset-2",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className
      )}
      {...props}
    />
  );
}
