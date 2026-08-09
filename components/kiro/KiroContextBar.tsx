"use client";

import React, { useState } from "react";
import { AtSign, ChevronDown, X } from "lucide-react";
import { KiroContextRef } from "@/lib/ai/context/types";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<KiroContextRef["kind"], string> = {
  course: "课",
  assignment: "务",
  "group-project": "组",
  material: "料",
  week: "周",
};

/**
 * Context Bar：自动 Context + 手动 @ Context 的展示层（显式、可见、可移除）。
 * Workspace 与 Sidecar 都默认 collapsed 摘要行（不默认铺满 chips），点击展开。
 * 摘要：Workspace 有明确主 Context 时显示「@ 主项 · +N ⌄」；Sidecar 恒「@ N 项上下文 ⌄」。
 * 位于 Composer 外部上方，宽度与 Composer 对齐（外层已共用 max-w）。
 */
export function KiroContextBar({
  contexts,
  onRemove,
  compact,
}: {
  contexts: KiroContextRef[];
  onRemove: (key: string) => void;
  /** sidecar：更紧凑 + 摘要恒为「N 项上下文」 */
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (contexts.length === 0) return null;

  // 摘要主项：优先用户显式 @ 的 manual Context（更值得展示），否则取第一个
  const primary = contexts.find((c) => c.source === "manual") ?? contexts[0];
  const summary = compact
    ? `${contexts.length} 项上下文`
    : contexts.length === 1
      ? primary.label
      : `${primary.label} · +${contexts.length - 1}`;

  return (
    <div data-testid="kiro-context-bar" className={cn("pb-1.5", compact && "px-0.5")}>
      {!expanded ? (
        <button
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          title="展开上下文"
          className="flex items-center gap-1.5 text-[11px] font-semibold text-satin-grey hover:text-charcoal transition-colors"
        >
          <AtSign className="w-3.5 h-3.5 text-sandrift shrink-0" />
          <span className="truncate max-w-[220px]">{summary}</span>
          <ChevronDown className="w-3 h-3 shrink-0" />
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {contexts.map((c) => (
            <span
              key={c.key}
              className={cn(
                "inline-flex items-center gap-1.5 pl-2 pr-1 h-7 rounded-lg border text-[11px] font-semibold text-charcoal",
                c.source === "auto"
                  ? "bg-pastel-mint border-line-soft"
                  : "bg-alabaster border-line"
              )}
            >
              <span className="w-3.5 h-3.5 rounded bg-white/70 border border-line-soft flex items-center justify-center text-[8px] font-bold text-sandrift shrink-0">
                {KIND_ICON[c.kind]}
              </span>
              <span className="truncate max-w-[160px]">{c.label}</span>
              <button
                onClick={() => onRemove(c.key)}
                aria-label={`移除上下文 ${c.label}`}
                title={c.source === "auto" ? "本次对话中移除" : "移除"}
                className="p-0.5 rounded text-sandrift hover:text-danger transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <button
            onClick={() => setExpanded(false)}
            aria-label="收起上下文"
            className="p-1 rounded-lg text-sandrift hover:text-charcoal hover:bg-alabaster transition-colors"
          >
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}
