"use client";

import React from "react";
import { Pause, Play, Square, X } from "lucide-react";
import type { DesktopSessionTone } from "@/lib/ai/ui/kiroComputerSession";
import type { DesktopSessionActionState } from "@/components/kiro/computer/session/useKiroComputerSessionActions";
import { cn } from "@/lib/utils";

const TONE_DOT: Record<DesktopSessionTone, string> = {
  active: "bg-charcoal",
  warning: "bg-warning",
  muted: "bg-sandrift",
  success: "bg-success",
  danger: "bg-danger",
  neutral: "bg-sandrift",
};

const TONE_TEXT: Record<DesktopSessionTone, string> = {
  active: "text-charcoal",
  warning: "text-charcoal",
  muted: "text-satin-grey",
  success: "text-charcoal",
  danger: "text-danger",
  neutral: "text-satin-grey",
};

const CONTROL_BUTTON =
  "flex items-center gap-1 px-1.5 h-6 rounded-md text-[11px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

/**
 * Computer Session Header（P5 §13）：
 * - 静态状态点（§12：不做 pulse / ring / spinner——Rail 是唯一主要动画信号）；
 * - 状态文案 role=status aria-live=polite aria-atomic（低频，不逐事件播报）；
 * - 控制按钮只在 Runtime 允许时渲染（approval-required 不提供 Pause，Stop 保留）；
 * - 受保护应用 badge 使用 danger semantic；
 * - terminal 时提供 UI-only 收起（×），active session 不可收起。
 */
export function KiroComputerSessionHeader({
  statusText,
  tone,
  blocked,
  stepLabel,
  controls,
  pending,
  onPause,
  onResume,
  onStop,
  onDismiss,
}: {
  statusText: string;
  tone: DesktopSessionTone;
  blocked: boolean;
  stepLabel: string | null;
  controls: { canPause: boolean; canResume: boolean; canStop: boolean };
  pending: DesktopSessionActionState;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onDismiss?: () => void;
}) {
  const busy = pending !== "idle";
  return (
    <div data-testid="kiro-computer-session-header" data-tone={tone} className="flex items-center gap-2 min-w-0">
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", TONE_DOT[tone])} aria-hidden="true" />
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={cn("text-[11px] font-semibold truncate min-w-0", TONE_TEXT[tone])}
      >
        {statusText}
      </p>
      {blocked && (
        <span
          data-testid="computer-session-profile-blocked"
          className="text-[10px] font-bold text-danger shrink-0"
        >
          受保护应用
        </span>
      )}
      {stepLabel && (
        <span className="text-[10px] font-semibold text-sandrift shrink-0">{stepLabel}</span>
      )}

      <div className="ml-auto flex items-center gap-1 shrink-0">
        {controls.canPause && (
          <button
            type="button"
            data-testid="computer-session-pause"
            onClick={onPause}
            disabled={busy}
            className={cn(CONTROL_BUTTON, "text-satin-grey hover:text-charcoal hover:bg-alabaster")}
          >
            <Pause className="w-3 h-3" aria-hidden="true" />
            {pending === "pausing" ? "暂停中…" : "暂停"}
          </button>
        )}
        {controls.canResume && (
          <button
            type="button"
            data-testid="computer-session-resume"
            onClick={onResume}
            disabled={busy}
            className={cn(CONTROL_BUTTON, "text-charcoal hover:bg-alabaster")}
          >
            <Play className="w-3 h-3" aria-hidden="true" />
            {pending === "resuming" ? "继续中…" : "继续"}
          </button>
        )}
        {controls.canStop && (
          <button
            type="button"
            data-testid="computer-session-stop"
            onClick={onStop}
            disabled={busy}
            className={cn(CONTROL_BUTTON, "text-satin-grey hover:text-danger hover:bg-danger-bg")}
          >
            <Square className="w-3 h-3" aria-hidden="true" />
            停止
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            data-testid="computer-session-dismiss"
            onClick={onDismiss}
            aria-label="收起"
            className="w-6 h-6 rounded-md flex items-center justify-center text-sandrift hover:text-charcoal hover:bg-alabaster transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
