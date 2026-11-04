"use client";

import React, { useState } from "react";
import { Check, ChevronDown, Circle, ListChecks, Loader2 } from "lucide-react";
import {
  KiroAgentPlan,
  summarizeAgentPlan,
} from "@/lib/ai/agent/plan";
import { cn } from "@/lib/utils";

/**
 * Kiro Agent Plan Card（Agent Superpowers V1）：
 * - Agent Run Header 与 Worklog 之间，Worklog 折叠时仍可见；
 * - 只展示真实 update_agent_plan Tool Result 归一化后的 plan；
 * - 默认展开短计划；长计划（>5 步）折叠为前 3 步 + 展开入口。
 */
export function KiroAgentPlanCard({
  plan,
  running,
}: {
  plan: KiroAgentPlan;
  running: boolean;
}) {
  const summary = summarizeAgentPlan(plan);
  const [expanded, setExpanded] = useState(plan.steps.length <= 5);
  const visibleSteps = expanded ? plan.steps : plan.steps.slice(0, 3);
  // 折叠入口只在「有第 4 步及以后」时需要；不能随 expanded 变成 0，否则永远无法收起
  const hiddenCount = Math.max(0, plan.steps.length - 3);

  return (
    <section
      data-testid="kiro-agent-plan"
      aria-label={plan.title || "执行计划"}
      className="rounded-xl border border-line-soft bg-alabaster/45 px-3 py-2.5 min-w-0"
    >
      <div className="flex items-center gap-2 min-w-0">
        <ListChecks className="w-3.5 h-3.5 text-sandrift shrink-0" aria-hidden="true" />
        <span className="text-[11px] font-bold text-charcoal truncate">
          {plan.title || "执行计划"}
        </span>
        {running && summary.nextStep && (
          <span className="hidden sm:inline text-[10px] text-sandrift truncate">
            · {summary.nextStep.title}
          </span>
        )}
        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-sandrift">
          {summary.completed}/{summary.total}
        </span>
      </div>

      <div
        className="mt-1.5 h-1 rounded-full bg-line-soft overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={summary.total}
        aria-valuenow={summary.completed}
        aria-label="计划完成进度"
      >
        <div
          className="h-full rounded-full bg-charcoal/70 transition-[width] duration-[var(--motion-base)] ease-[var(--ease-standard)]"
          style={{ width: `${summary.progressPercent}%` }}
        />
      </div>

      <ol className="mt-2 space-y-1">
        {visibleSteps.map((step) => {
          const completed = step.status === "completed";
          const active = step.status === "in_progress";
          return (
            <li key={step.id} className="flex items-start gap-1.5 min-w-0">
              {completed ? (
                <Check className="w-3 h-3 mt-[2px] shrink-0 text-success" aria-hidden="true" />
              ) : active ? (
                <Loader2 className="w-3 h-3 mt-[2px] shrink-0 animate-spin text-charcoal" aria-hidden="true" />
              ) : (
                <Circle className="w-3 h-3 mt-[2px] shrink-0 text-sandrift/70" aria-hidden="true" />
              )}
              <span
                className={cn(
                  "text-[11px] leading-relaxed break-words min-w-0",
                  completed && "text-sandrift line-through",
                  active && "text-charcoal font-semibold",
                  !completed && !active && "text-satin-grey"
                )}
              >
                {step.title}
              </span>
            </li>
          );
        })}
      </ol>

      {hiddenCount > 0 && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold text-sandrift hover:text-charcoal transition-colors"
        >
          展开剩余 {hiddenCount} 步
          <ChevronDown className="w-3 h-3" aria-hidden="true" />
        </button>
      )}
      {expanded && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-expanded
          className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold text-sandrift hover:text-charcoal transition-colors"
        >
          收起计划
          <ChevronDown className="w-3 h-3 rotate-180" aria-hidden="true" />
        </button>
      )}
    </section>
  );
}
