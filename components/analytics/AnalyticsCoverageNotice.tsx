"use client";

import React, { useState } from "react";
import { Info, ChevronDown } from "lucide-react";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import {
  buildCoverageFactLines,
  buildCoverageSummary,
  CoverageFacts,
} from "@/lib/analytics/presentation";
import { cn } from "@/lib/utils";

/**
 * Analytics V3.1 Coverage Notice（低关注，非 banner；progressive disclosure）：
 * 折叠：ⓘ 部分历史记录不完整 · 部分指标仅展示已记录内容 [查看详情]
 * 展开：逐项事实（只来自真实 metadata；focus partial 不制造具体起点）
 *
 * 进入不做高度展开：notice 出现时直接占最终布局高度，只做 opacity 轻淡入。
 * 此前 Enter 阶段用 ExitCollapse 从 0fr 展开会把 top grid 向下推 190ms，
 * 看起来像“顶部卡片延迟后突然弹出来”。
 */
export function AnalyticsCoverageNotice({ facts }: { facts: CoverageFacts }) {
  const summary = buildCoverageSummary(facts);
  const [open, setOpen] = useState(false);
  if (!summary) return null;

  const factsLines = buildCoverageFactLines(facts);
  const panelId = "analytics-coverage-detail";
  return (
    <div
      data-testid="analytics-coverage-notice"
      className="flex items-start gap-2 pb-3 border-b border-line-soft text-[11px] text-sandrift"
    >
      <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="font-semibold text-charcoal/80">{summary.title}</span>
          <span>·</span>
          <span>{summary.hint}</span>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
            className="ml-auto inline-flex items-center gap-0.5 shrink-0 text-[11px] font-semibold text-sandrift hover:text-charcoal transition-colors"
          >
            {open ? "收起" : "查看详情"}
            <ChevronDown className={cn("w-3 h-3 transition-transform duration-[var(--motion-fast)]", open && "rotate-180")} />
          </button>
        </p>
        <DisclosureRegion open={open} id={panelId} innerClassName="pt-1.5">
          <ul className="space-y-0.5">
            {factsLines.map((line) => (
              <li key={line} className="flex gap-1.5">
                <span aria-hidden="true" className="shrink-0">
                  •
                </span>
                <span className="leading-snug">{line}</span>
              </li>
            ))}
          </ul>
        </DisclosureRegion>
      </div>
    </div>
  );
}
