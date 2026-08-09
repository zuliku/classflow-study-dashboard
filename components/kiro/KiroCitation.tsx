"use client";

import React from "react";
import { BookOpen } from "lucide-react";
import { KiroCitation as KiroCitationData, KiroSourceMeta } from "@/lib/ai/citations/types";
import { resolveCitation, citationLabel } from "@/lib/ai/citations/parser";

/**
 * Kiro Citation pill（Task 11）：可验证的来源展示。
 * 渲染前必须通过 Source Registry 校验（sourceId 存在 + 页码实际提供）；
 * 无效引用返回 null（正文保留，不显示不可信来源）。
 * 不做点击跳转（V1 只做来源展示）。
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

  return (
    <span
      data-testid="kiro-citation"
      className="inline-flex items-center gap-1 align-middle mx-0.5 px-1.5 py-px rounded-md bg-pastel-mint/70 border border-line text-[11px] font-semibold text-charcoal whitespace-nowrap"
      title={citationLabel(source, citation)}
    >
      <BookOpen className="w-3 h-3 text-sandrift shrink-0" aria-hidden="true" />
      {citationLabel(source, citation)}
    </span>
  );
}
