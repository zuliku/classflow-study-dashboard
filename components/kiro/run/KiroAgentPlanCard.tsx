"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Circle, ListChecks, Loader2 } from "lucide-react";
import {
  KiroAgentPlan,
  summarizeAgentPlan,
} from "@/lib/ai/agent/plan";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { cn } from "@/lib/utils";

const NARROW_PLAN_WIDTH = 460;

/**
 * Kiro Agent Plan Card（Agent Superpowers V1.1）：
 * - Agent Run Header 与 Worklog 之间，Worklog 折叠时仍可见；
 * - 收起态只显示标题 / 进度 / 当前步骤；展开态用 measured-height DisclosureRegion 平滑展开全部步骤；
 * - 容器宽度 < 360（Sidecar / 窄 Dock）自动收起，用户手动展开后不再被自动折叠；
 * - 出现走 animate-enter；离开由 KiroAgentRun 的 ExitCollapse presence 负责。
 */
export function KiroAgentPlanCard({
  plan,
  running,
}: {
  plan: KiroAgentPlan;
  running: boolean;
}) {
  const summary = summarizeAgentPlan(plan);
  const allCompleted = summary.completed === summary.total;
  const [expanded, setExpanded] = useState(plan.steps.length <= 5);
  const userToggledRef = useRef(false);
  const rootRef = useRef<HTMLElement | null>(null);
  const [narrow, setNarrow] = useState(false);

  // 小窗适配：按真实容器宽度（不是 viewport）自动收起长计划
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setNarrow(width > 0 && width < NARROW_PLAN_WIDTH);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (userToggledRef.current) return;
    if (narrow && plan.steps.length > 3) setExpanded(false);
  }, [narrow, plan.steps.length]);

  const toggle = () => {
    userToggledRef.current = true;
    setExpanded((v) => !v);
  };

  const statusLabel = running ? "进行中" : allCompleted ? "已完成" : "待继续";
  const statusTone = running
    ? "text-charcoal bg-pastel-mint/70 border-line"
    : allCompleted
      ? "text-success bg-success/10 border-success/20"
      : "text-satin-grey bg-alabaster border-line";

  return (
    <section
      ref={rootRef}
      data-testid="kiro-agent-plan"
      data-expanded={expanded ? "true" : "false"}
      data-narrow={narrow ? "true" : "false"}
      aria-label={plan.title || "执行计划"}
      className="rounded-xl border border-line-soft bg-alabaster/45 px-3 py-2.5 min-w-0 animate-enter"
    >
      <div className="flex items-center gap-2 min-w-0">
        <ListChecks className="w-3.5 h-3.5 text-sandrift shrink-0" aria-hidden="true" />
        <span className="text-[11px] font-bold text-charcoal truncate min-w-0">
          {plan.title || "执行计划"}
        </span>
        <span
          className={cn(
            "shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold leading-none transition-colors duration-[var(--motion-fast)]",
            statusTone
          )}
        >
          <span key={statusLabel} className="inline-block kiro-status-swap">
            {statusLabel}
          </span>
        </span>
        <span className="ml-auto shrink-0 text-[10px] tabular-nums text-sandrift">
          {summary.completed}/{summary.total}
        </span>
        <button
          type="button"
          onClick={toggle}
          aria-label={expanded ? "收起执行计划" : "展开执行计划"}
          aria-expanded={expanded}
          data-testid="kiro-agent-plan-toggle"
          className="shrink-0 rounded-md p-0.5 text-sandrift hover:text-charcoal hover:bg-alabaster transition-colors"
        >
          <ChevronDown
            className={cn(
              "w-3.5 h-3.5 transition-transform duration-[var(--motion-fast)]",
              expanded && "rotate-180"
            )}
            aria-hidden="true"
          />
        </button>
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
          className="h-full w-full origin-left rounded-full bg-charcoal/70 transition-transform duration-[var(--motion-base)] ease-[var(--ease-standard)]"
          style={{ transform: `scaleX(${summary.progressPercent / 100})` }}
        />
      </div>

      {!expanded && (
        <div className="mt-2 flex items-start gap-1.5 min-w-0">
          <span
            key={
              allCompleted
                ? "done"
                : summary.nextStep?.status === "in_progress"
                  ? "active"
                  : "pending"
            }
            className="inline-flex shrink-0 mt-[2px] kiro-status-swap"
            aria-hidden="true"
          >
            {allCompleted ? (
              <Check className="w-3 h-3 text-success" />
            ) : summary.nextStep?.status === "in_progress" ? (
              <Loader2 className="w-3 h-3 animate-spin text-charcoal" />
            ) : (
              <Circle className="w-3 h-3 text-sandrift/70" />
            )}
          </span>
          <span className="text-[11px] leading-relaxed text-satin-grey min-w-0 truncate">
            {allCompleted
              ? "全部步骤已完成"
              : summary.nextStep
                ? `${summary.nextStep.status === "in_progress" ? "当前" : "下一步"}：${summary.nextStep.title}`
                : "等待下一步"}
          </span>
        </div>
      )}

      <DisclosureRegion open={expanded} innerClassName="pt-2">
        <ol className="space-y-1 max-h-[min(240px,40vh)] overflow-y-auto overscroll-contain pr-1">
          {plan.steps.map((step) => {
            const completed = step.status === "completed";
            const active = step.status === "in_progress";
            return (
              <li key={step.id} className="flex items-start gap-1.5 min-w-0 animate-enter">
                <span
                  key={completed ? "done" : active ? "active" : "pending"}
                  className="inline-flex shrink-0 mt-[2px] kiro-status-swap"
                  aria-hidden="true"
                >
                  {completed ? (
                    <Check className="w-3 h-3 text-success kiro-check-settle" />
                  ) : active ? (
                    <Loader2 className="w-3 h-3 animate-spin text-charcoal" />
                  ) : (
                    <Circle className="w-3 h-3 text-sandrift/70" />
                  )}
                </span>
                <span
                  className={cn(
                    "text-[11px] leading-relaxed break-words min-w-0 transition-colors duration-[var(--motion-fast)]",
                    completed && "text-sandrift line-through",
                    active && "text-charcoal font-semibold",
                    !completed && !active && "text-satin-grey"
                  )}
                >
                  {step.title}
                </span>
                {active && (
                  <span className="ml-auto shrink-0 text-[9px] font-bold text-charcoal/70 animate-enter">
                    进行中
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </DisclosureRegion>
    </section>
  );
}
