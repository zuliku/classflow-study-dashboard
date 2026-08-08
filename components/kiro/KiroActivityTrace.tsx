"use client";

import React, { useState } from "react";
import { Check, Loader2, Circle, ChevronDown, PencilLine } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { KiroActivityStep } from "@/hooks/useKiroChat";
import { cn } from "@/lib/utils";

/**
 * Kiro Activity Trace（Task 3）：展示真实工具调用（用户语义标签）。
 * 本轮只有 Read →「✓ 读取 N 项 ClassFlow 信息」；
 * 存在 Write →「✓ 完成 N 个步骤 · 修改 M 项内容」。
 * 禁止展示 JSON / tool args / 内部工具名。
 */
export function KiroActivityTrace({
  steps,
  done,
}: {
  steps: KiroActivityStep[];
  done: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentDensity = useAppStore((s) => s.preferences.contentDensity);
  const compact = contentDensity === "compact";

  const writeCount = steps.filter((s) => s.kind === "write").length;
  const doneCount = steps.filter((s) => s.status === "done").length;
  const workingCount = steps.filter((s) => s.status === "working").length;
  if (steps.length === 0) return null;

  const summary = done
    ? writeCount > 0
      ? `✓ 完成 ${steps.length} 个步骤 · 修改 ${writeCount} 项内容`
      : `✓ 读取 ${steps.length} 项 ClassFlow 信息`
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
          aria-label="Kiro 工具记录"
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
              {s.kind === "write" && s.status !== "error" && (
                <PencilLine className="w-3 h-3 text-sandrift shrink-0 ml-auto" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
