"use client";

import React, { useState } from "react";
import { Check, Loader2, Circle, ChevronDown } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";

export interface KiroTraceStep {
  label: string;
  status: "done" | "working" | "pending";
}

/**
 * Agent Activity Trace 视觉组件（Task 0 无 Agent Runtime，用静态/mock props）。
 * Collapsed：`✓ 完成 N 项操作` / `● Kiro 正在处理 · n / N`
 * Expanded：逐项状态列表。
 * 禁止展示 JSON / tool args / 内部工具名 / token 细节。
 */
export function KiroActivityTrace({
  status,
  steps,
}: {
  status: "done" | "working";
  steps: KiroTraceStep[];
}) {
  const [expanded, setExpanded] = useState(false);
  const contentDensity = useAppStore((s) => s.preferences.contentDensity);
  const compact = contentDensity === "compact";

  const doneCount = steps.filter((s) => s.status === "done").length;
  const workingCount = steps.filter((s) => s.status === "working").length;

  return (
    <div className="inline-flex flex-col items-start">
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={cn(
          "flex items-center gap-1.5 rounded-xl bg-[#F7F5F5] border border-line px-3 text-[11px] font-semibold text-satin-grey hover:text-charcoal hover:border-line-strong transition-colors",
          compact ? "py-1.5" : "py-2"
        )}
      >
        {status === "done" ? (
          <>
            <Check className="w-3.5 h-3.5 text-success" />
            完成 {steps.length} 项操作
          </>
        ) : (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin text-charcoal" />
            Kiro 正在处理 · {doneCount + workingCount} / {steps.length}
          </>
        )}
        <ChevronDown
          className={cn("w-3 h-3 text-sandrift transition-transform duration-[var(--motion-fast)]", expanded && "rotate-180")}
        />
      </button>

      {expanded && (
        <div
          role="list"
          aria-label="Kiro 处理步骤"
          className="mt-1.5 w-full rounded-xl bg-[#F7F5F5] border border-line p-1.5 space-y-0.5 ux-fade"
        >
          {steps.map((s) => (
            <div
              key={s.label}
              role="listitem"
              className={cn(
                "flex items-center gap-2 px-2 rounded-lg text-[11px]",
                compact ? "py-1.5" : "py-2",
                s.status === "done"
                  ? "text-satin-grey"
                  : s.status === "working"
                  ? "text-charcoal font-semibold"
                  : "text-sandrift"
              )}
            >
              {s.status === "done" ? (
                <Check className="w-3.5 h-3.5 text-success shrink-0" />
              ) : s.status === "working" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-charcoal shrink-0" />
              ) : (
                <Circle className="w-3.5 h-3.5 text-line-strong shrink-0" />
              )}
              <span className="truncate">{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
