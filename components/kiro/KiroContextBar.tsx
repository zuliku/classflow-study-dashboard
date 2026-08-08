"use client";

import React, { useState } from "react";
import { AtSign, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface KiroContextChip {
  id: string;
  kind: "course" | "assignment" | "schedule" | "project" | "material" | "range";
  label: string;
  /** 自动上下文（来自当前选中实体）不可手动关闭时留空 */
  removable?: boolean;
}

/**
 * Context Bar：自动 Context + 手动 Context 的展示层。
 * Collapsed：`◎ 使用 N 项 ClassFlow 上下文`；Expanded：可移除的 chips。
 * 组件只展示，不构造 Prompt、不发送数据。
 */
export function KiroContextBar({
  contexts,
  onRemove,
}: {
  contexts: KiroContextChip[];
  onRemove: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  if (contexts.length === 0) return null;

  return (
    <div data-testid="kiro-context-bar" className="px-1 pb-2">
      {!expanded ? (
        <button
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-satin-grey hover:text-charcoal transition-colors"
        >
          <AtSign className="w-3.5 h-3.5 text-sandrift" />
          ◎ 使用 {contexts.length} 项 ClassFlow 上下文
          <ChevronDown className="w-3 h-3" />
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {contexts.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1.5 pl-2 pr-1 h-7 rounded-lg bg-alabaster border border-line text-[11px] font-semibold text-charcoal"
            >
              <AtSign className="w-3 h-3 text-sandrift" />
              <span className="truncate max-w-[160px]">{c.label}</span>
              {c.removable !== false && (
                <button
                  onClick={() => onRemove(c.id)}
                  aria-label={`移除上下文 ${c.label}`}
                  className="p-0.5 rounded text-sandrift hover:text-danger transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
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
