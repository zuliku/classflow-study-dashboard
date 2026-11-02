"use client";

import React from "react";
import { Square } from "lucide-react";

/**
 * Kiro Agent Run Controls（P4）：Run Header 内的运行控制。
 * 只负责触发 canonical Stop（useKiroChat.handleStop）——绝不自行清理 Runtime 状态。
 * Desktop Session 的 Pause / Resume / Stop 仍由 Sidecar Session Card 承担（Control Surface 单一）。
 */
export function KiroAgentRunControls({ onStop, stopLabel }: { onStop: () => void; stopLabel?: string }) {
  return (
    <button
      type="button"
      data-testid="kiro-agent-run-stop"
      onClick={onStop}
      className="shrink-0 flex items-center gap-1 px-1.5 h-6 rounded-md text-[11px] font-semibold text-sandrift hover:text-charcoal hover:bg-alabaster transition-colors"
    >
      <Square className="w-3 h-3" aria-hidden="true" />
      {stopLabel ?? "停止"}
    </button>
  );
}
