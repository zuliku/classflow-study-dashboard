"use client";

import React from "react";
import { cn } from "@/lib/utils";

/**
 * 全局 Input primitive（UI Productization Task 2A）：单行输入。
 * 不内置 label / description / error message / form state。
 */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  mono?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, mono, className, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={cn(
        "w-full h-9 px-2.5 bg-background border rounded-lg text-xs font-semibold text-charcoal",
        // BUG-G4：focus 边框色过渡（与 Select trigger 同语义；此前瞬变）
        // S2-2：focus:outline-none 会覆盖全局 :focus-visible 环（specificity），故显式补回与 Button 同款 ring
        "transition-colors duration-[var(--motion-fast)] placeholder:text-sandrift focus:outline-none focus:border-charcoal focus-visible:outline-2 focus-visible:outline-charcoal/30 focus-visible:outline-offset-2",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        invalid ? "border-danger-border" : "border-line",
        mono && "font-mono",
        className
      )}
      {...props}
    />
  );
});
