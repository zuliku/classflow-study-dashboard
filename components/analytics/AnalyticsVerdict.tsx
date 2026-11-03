"use client";

import React from "react";
import { ArrowRight } from "lucide-react";
import type { AnalyticsVerdict } from "@/lib/analytics/verdict";
import { cn } from "@/lib/utils";

/**
 * 洞察结论（Analytics Verdict）：一句话判断 + 一步行动。
 * 产品化 V2：不再使用彩色卡片/圆形图标容器；以左侧语气线 + 编辑器式标题呈现，
 * 让结论像页面导语而不是一张“AI 提示卡”。数据与 testid 不变。
 */
export function AnalyticsVerdict({
  verdict,
  onAction,
}: {
  verdict: AnalyticsVerdict;
  onAction: (tab: "assignments" | "timetable" | "courses") => void;
}) {
  return (
    <div
      data-testid="analytics-verdict"
      data-verdict-tone={verdict.tone}
      className={cn(
        "flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-l-2 pl-4 py-0.5",
        verdict.tone === "warn" && "border-danger/70",
        verdict.tone === "good" && "border-charcoal/70",
        verdict.tone === "flat" && "border-line-strong"
      )}
    >
      <div className="min-w-0 max-w-[720px]">
        <p className="text-[19px] font-semibold leading-snug tracking-[-0.015em] text-charcoal">
          {verdict.headline}
        </p>
        {verdict.detail && (
          <p className="mt-1 text-xs leading-relaxed text-satin-grey">{verdict.detail}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onAction(verdict.actionTab)}
        className="group/action inline-flex shrink-0 items-center gap-1.5 pb-0.5 text-xs font-semibold text-charcoal border-b border-charcoal/30 hover:border-charcoal transition-colors"
      >
        <span>{verdict.actionLabel}</span>
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/action:translate-x-0.5" aria-hidden="true" />
      </button>
    </div>
  );
}

