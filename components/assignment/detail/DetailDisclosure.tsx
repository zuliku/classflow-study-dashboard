"use client";

import React, { useState } from "react";
import { ChevronRight } from "lucide-react";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { cn } from "@/lib/utils";

/**
 * Task/DDL Detail Panel：轻量 Disclosure（Progressive Disclosure）。
 * - 内容区复用 DisclosureRegion（grid-rows 0fr↔1fr + presence + inert，collapsed 不参与 Tab）
 * - aria-expanded；可选受控 open（供「提醒」主操作直接展开）
 */
export function DetailDisclosure({
  title,
  summary,
  action,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  children,
  testid,
  className,
}: {
  title: React.ReactNode;
  /** collapsed 摘要（如数量 / 状态文案） */
  summary?: React.ReactNode;
  /** header 右侧操作（如「添加资料」） */
  action?: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
  testid?: string;
  className?: string;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (v: boolean) => {
    setInternalOpen(v);
    onOpenChange?.(v);
  };

  return (
    <section className={cn("space-y-1", className)}>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          data-testid={testid}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="ux-press flex min-w-0 items-center gap-1 rounded-lg py-0.5 pr-1 text-left text-xs font-semibold text-sandrift transition-colors hover:text-charcoal"
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 transition-transform duration-[var(--motion-fast)]",
              open && "rotate-90"
            )}
          />
          <span className="truncate">{title}</span>
          {summary != null && (
            <span className="shrink-0 text-[10px] font-bold text-satin-grey">{summary}</span>
          )}
        </button>
        {action}
      </div>
      <DisclosureRegion open={open}>{children}</DisclosureRegion>
    </section>
  );
}
