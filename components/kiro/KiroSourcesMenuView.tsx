"use client";

import React from "react";
import { Globe2, ExternalLink, ChevronLeft } from "lucide-react";
import { KiroSourceMeta } from "@/lib/ai/citations/types";
import { isSafeWebUrl } from "@/lib/ai/citations/parser";

/**
 * Kiro More → 来源 View（Citation Layout Hotfix）：
 * 只渲染「来源」页面内容（同一 Popover 内切换；页面导航 state 在 KiroMessage）。
 * - 来源顺序 = Final Answer 首次引用顺序（由调用方 collectCitedWebSources 保证）
 * - 每个 Web Source：title / domain / publishedAt（存在时）/ ExternalLink
 * - URL 只经 isSafeWebUrl 二次校验后 href；target=_blank + noopener
 * - 不显示 snippet / evidence / raw URL / query / score
 */
export function KiroSourcesMenuView({
  sources,
  onBack,
}: {
  sources: KiroSourceMeta[];
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col" data-testid="kiro-sources-menu-view">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-left font-semibold text-satin-grey hover:bg-alabaster hover:text-charcoal transition-colors"
        aria-label="返回消息操作"
      >
        <ChevronLeft className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        来源
      </button>
      <div className="my-1 h-px bg-line-soft" />
      <ul className="flex flex-col gap-1">
        {sources.map((source) => {
          const url = isSafeWebUrl(source.url) ? source.url : null;
          return (
            <li key={source.sourceId} className="flex items-center gap-2 px-2.5 py-2 min-w-0">
              <Globe2 className="w-3.5 h-3.5 text-sandrift shrink-0" aria-hidden="true" />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[11px] font-semibold text-charcoal truncate" title={source.name}>
                  {source.name}
                </span>
                <span className="text-[10px] text-sandrift truncate">
                  {[source.domain, source.publishedAt].filter(Boolean).join(" · ")}
                </span>
              </div>
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-sandrift hover:text-charcoal transition-colors"
                  aria-label={`打开来源：${source.name}`}
                >
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
