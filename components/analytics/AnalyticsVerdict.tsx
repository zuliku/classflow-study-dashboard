"use client";

import React from "react";
import { ArrowRight, TriangleAlert, TrendingUp, Minus } from "lucide-react";
import type { AnalyticsVerdict } from "@/lib/analytics/verdict";
import { cn } from "@/lib/utils";

/**
 * 洞察结论横幅（Analytics Verdict）：一句话判断 + 一步行动。
 * Screen Time 式——先给结论（好不好、怎么办），再看下面的数据陈列。
 * 纯新增表达层：标题/testid/数据口径全部复用既有，不碰任何已锁断言。
 */
export function AnalyticsVerdict({
  verdict,
  onAction,
}: {
  verdict: AnalyticsVerdict;
  onAction: (tab: "assignments" | "timetable" | "courses") => void;
}) {
  const Icon = verdict.tone === "warn" ? TriangleAlert : verdict.tone === "good" ? TrendingUp : Minus;
  return (
    <div
      data-testid="analytics-verdict"
      data-verdict-tone={verdict.tone}
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3.5 shadow-subtle",
        verdict.tone === "warn" && "bg-danger-bg/60 border-danger-border",
        verdict.tone === "good" && "bg-pastel-mint/40 border-line",
        verdict.tone === "flat" && "bg-surface border-line"
      )}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        <span
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
            verdict.tone === "warn" && "bg-danger/10 text-danger",
            verdict.tone === "good" && "bg-pastel-mint text-charcoal",
            verdict.tone === "flat" && "bg-alabaster text-sandrift"
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-extrabold tracking-tight text-charcoal">{verdict.headline}</p>
          {verdict.detail && (
            <p className="mt-0.5 text-xs text-satin-grey leading-relaxed">{verdict.detail}</p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onAction(verdict.actionTab)}
        className="flex shrink-0 items-center gap-1 rounded-lg px-3.5 text-xs font-bold transition-colors h-8 bg-charcoal text-white hover:bg-black"
      >
        <span>{verdict.actionLabel}</span>
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
