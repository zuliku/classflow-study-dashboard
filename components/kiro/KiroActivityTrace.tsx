"use client";

import React, { useState } from "react";
import { Check, Loader2, Circle, ChevronDown, BookOpenCheck } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { KiroActivityStep } from "@/hooks/useKiroChat";
import { cn } from "@/lib/utils";

/**
 * Kiro Activity Trace（Task 2）：展示真实 Read Tool 调用（用户语义标签）。
 * mode="read"（Task 2）→ collapsed「✓ 读取 N 项 ClassFlow 信息」；
 * mode="action"（未来 Task 3 写操作）→「完成 N 项操作」。
 * 禁止展示 JSON / tool args / 内部工具名 / token 细节。
 */
export function KiroActivityTrace({
  steps,
  done,
  mode = "read",
}: {
  steps: KiroActivityStep[];
  done: boolean;
  mode?: "read" | "action";
}) {
  const [expanded, setExpanded] = useState(false);
  const contentDensity = useAppStore((s) => s.preferences.contentDensity);
  const compact = contentDensity === "compact";

  const doneCount = steps.filter((s) => s.status === "done").length;
  const workingCount = steps.filter((s) => s.status === "working").length;
  if (steps.length === 0) return null;

  const summary = done
    ? mode === "read"
      ? `✓ 读取 ${steps.length} 项 ClassFlow 信息`
      : `✓ 完成 ${steps.length} 项操作`
    : `● Kiro 正在处理 · ${doneCount + workingCount} / ${steps.length}`;

  return (
    <div className="inline-flex flex-col items-start" data-testid="kiro-activity-trace">
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={cn(
          "flex items-center gap-1.5 rounded-xl bg-[#F7F5F5] border border-line px-3 text-[11px] font-semibold text-satin-grey hover:text-charcoal hover:border-line-strong transition-colors",
          compact ? "py-1.5" : "py-2"
        )}
      >
        {done ? (
          <>
            <Check className="w-3.5 h-3.5 text-success" />
            {summary}
          </>
        ) : (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin text-charcoal" />
            {summary}
          </>
        )}
        <ChevronDown
          className={cn("w-3 h-3 text-sandrift transition-transform duration-[var(--motion-fast)]", expanded && "rotate-180")}
        />
      </button>

      {expanded && (
        <div
          role="list"
          aria-label="Kiro 读取记录"
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
                  : "text-danger"
              )}
            >
              {s.status === "done" ? (
                <Check className="w-3.5 h-3.5 text-success shrink-0" />
              ) : s.status === "working" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-charcoal shrink-0" />
              ) : (
                <Circle className="w-3.5 h-3.5 text-danger shrink-0" />
              )}
              <span className="truncate">{s.label}</span>
              {s.status === "error" && (
                <BookOpenCheck className="w-3 h-3 text-sandrift shrink-0 ml-auto" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
