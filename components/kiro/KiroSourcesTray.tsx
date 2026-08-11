"use client";

import React, { useState } from "react";
import { Globe2, ExternalLink, ChevronDown } from "lucide-react";
import { KiroSourceMeta } from "@/lib/ai/citations/types";
import { collectCitedWebSources, isSafeWebUrl } from "@/lib/ai/citations/parser";
import { cn } from "@/lib/utils";

/**
 * Kiro Answer Sources Tray（Task 17B）：
 * 显示 Final Answer 中实际引用的 Web Sources（按首次出现顺序去重）。
 * 默认折叠；来源 0 → 不渲染；URL 经 isSafeWebUrl 二次校验后才可点击。
 */
export function KiroSourcesTray({
  content,
  sources,
}: {
  content: string;
  sources?: KiroSourceMeta[];
}) {
  const [open, setOpen] = useState(false);
  const cited = React.useMemo(() => collectCitedWebSources(content, sources), [content, sources]);
  if (cited.length === 0) return null;

  return (
    <div className="mt-3 border-t border-line pt-2" data-testid="kiro-sources-tray">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-semibold text-charcoal hover:text-sandrift transition-colors duration-[var(--motion-fast)]"
        aria-expanded={open}
      >
        <Globe2 className="w-3.5 h-3.5 text-sandrift" aria-hidden="true" />
        来源 · {cited.length}
        <ChevronDown
          className={cn(
            "w-3 h-3 text-sandrift transition-transform duration-[var(--motion-fast)]",
            open && "rotate-180"
          )}
          aria-hidden="true"
        />
      </button>
      {open && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {cited.map((source) => {
            const url = isSafeWebUrl(source.url) ? source.url : null;
            return (
              <li key={source.sourceId} className="flex items-center gap-2 min-w-0">
                <span className="text-[11px] font-semibold text-charcoal truncate" title={source.name}>
                  {source.name}
                </span>
                {source.domain && (
                  <span className="text-[11px] text-sandrift truncate shrink-0">{source.domain}</span>
                )}
                {source.publishedAt && (
                  <span className="text-[11px] text-sandrift shrink-0">{source.publishedAt}</span>
                )}
                {url && (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-sandrift hover:text-charcoal transition-colors duration-[var(--motion-fast)]"
                    aria-label={`打开来源：${source.name}`}
                  >
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
