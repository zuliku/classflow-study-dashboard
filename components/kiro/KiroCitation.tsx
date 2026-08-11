"use client";

import React from "react";
import { BookOpen, Globe2 } from "lucide-react";
import { KiroCitation as KiroCitationData, KiroSourceMeta } from "@/lib/ai/citations/types";
import { resolveCitation, citationLabel, isSafeWebUrl } from "@/lib/ai/citations/parser";

/** Web pill 紧凑 label：短标题直接用；过长时用 domain，title 属性显示完整标题 + domain */
function webLabel(source: KiroSourceMeta): string {
  const title = source.name;
  if (title && title.length <= 24) return title;
  return source.domain ?? title;
}

/**
 * Kiro Citation pill（Task 11 / 14）：可验证的来源展示。
 * 渲染前必须通过 Source Registry 校验（sourceId 存在 + 页码实际提供）；
 * 无效引用返回 null（正文保留，不显示不可信来源）。
 * Web Source：Globe2 图标 + 可点击（target=_blank / noopener；URL 再次校验 http/https）。
 */
export function KiroCitation({
  citation,
  sources,
}: {
  citation: KiroCitationData;
  sources?: KiroSourceMeta[];
}) {
  const source = sources ? resolveCitation(citation, sources) : null;
  if (!source) return null;

  const label = citationLabel(source, citation);
  if (source.source === "web") {
    const url = isSafeWebUrl(source.url) ? source.url : null;
    const pill = (
      <span
        data-testid="kiro-citation"
        className="inline-flex items-center gap-1 align-middle mx-0.5 px-1.5 py-px rounded-md bg-pastel-mint/70 border border-line text-[11px] font-semibold text-charcoal whitespace-nowrap"
        title={source.domain ? `${label} · ${source.domain}` : label}
      >
        <Globe2 className="w-3 h-3 text-sandrift shrink-0" aria-hidden="true" />
        {webLabel(source)}
      </span>
    );
    if (!url) return pill;
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center align-middle no-underline"
      >
        {pill}
      </a>
    );
  }

  return (
    <span
      data-testid="kiro-citation"
      className="inline-flex items-center gap-1 align-middle mx-0.5 px-1.5 py-px rounded-md bg-pastel-mint/70 border border-line text-[11px] font-semibold text-charcoal whitespace-nowrap"
      title={label}
    >
      <BookOpen className="w-3 h-3 text-sandrift shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}
