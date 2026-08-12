"use client";

import React from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

/**
 * 全局 SearchField primitive（UI Productization Task 2A）：
 * Search icon + type="search"；value 非空且提供 onClear 时显示清除按钮。
 * 不实现 debounce / filtering / Command Center / Store。
 */
export interface SearchFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  onClear?: () => void;
}

export function SearchField({ onClear, className, ...props }: SearchFieldProps) {
  const value = props.value;
  const hasValue =
    typeof value === "string" ? value.length > 0 : typeof value === "number" ? value > 0 : false;

  return (
    <div className="relative flex items-center min-w-0">
      <Search
        className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-[#A48F82] shrink-0"
        aria-hidden="true"
      />
      <Input
        type="search"
        className={cn("pl-8 pr-8", className)}
        {...props}
      />
      {onClear && hasValue && (
        <button
          type="button"
          onClick={onClear}
          aria-label="清除搜索"
          className="absolute right-1.5 flex h-5 w-5 items-center justify-center rounded-md text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
