"use client";

import React from "react";
import { Popover } from "@/components/ui/Popover";
import { DropdownMenuPanel, DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { KiroReasoningEffort, ReasoningCapability } from "@/lib/ai/reasoning/types";
import { cn } from "@/lib/utils";

const EFFORT_LABELS: Record<KiroReasoningEffort, string> = {
  default: "默认",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "超高",
  max: "极高",
};

/**
 * Reasoning 选择（capability-driven）：
 * - 模型支持 >1 个 effort 时显示（默认 + 可调档位）；
 * - 模型 fixed 时 Composer 不显示 chip（Settings 负责说明「当前模型不可调」）。
 */
export function KiroReasoningMenu({
  capability,
  effort,
  onChange,
  disabled,
  iconOnly,
}: {
  capability: ReasoningCapability;
  effort: KiroReasoningEffort;
  onChange: (effort: KiroReasoningEffort) => void;
  disabled?: boolean;
  /** Sidecar/compact：一级栏只显示图标，文字进二级 popover */
  iconOnly?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  if (!capability.adjustable || capability.supportedEfforts.length <= 1) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="思考程度"
        aria-expanded={open}
        disabled={disabled}
        title={`思考程度：${effort === "default" ? "默认" : EFFORT_LABELS[effort]}`}
        className={cn(
          "flex items-center h-9 rounded-xl text-[11px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
          iconOnly
            ? cn("w-9 justify-center", open ? "bg-alabaster text-charcoal" : "text-sandrift hover:bg-alabaster hover:text-charcoal")
            : cn("gap-1 px-2.5", open ? "bg-alabaster text-charcoal border border-line-strong" : "text-sandrift border border-transparent hover:bg-alabaster hover:text-charcoal")
        )}
      >
        <BrainIcon />
        {!iconOnly && `思考 ${effort === "default" ? "默认" : EFFORT_LABELS[effort]}`}
      </button>
      {/* Composer 位于页面底部 → 向上展开，避免越出 viewport */}
      <DropdownMenuPanel open={open} placement="top-end" motionProfile="kiro" aria-label="思考程度" className="w-40 p-1">
        {capability.supportedEfforts.map((e) => (
          <DropdownMenuItem
            key={e}
            label={
              <span className="flex items-center justify-between gap-2">
                <span className={e === effort ? "text-charcoal font-bold" : ""}>
                  {e === "default" ? "默认" : EFFORT_LABELS[e]}
                </span>
                {e === effort && (
                  <svg className="w-3 h-3 text-charcoal shrink-0 kiro-check-settle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </span>
            }
            onClick={() => {
              onChange(e);
              setOpen(false);
            }}
          />
        ))}
      </DropdownMenuPanel>
    </Popover>
  );
}

function BrainIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M12 5v13" />
    </svg>
  );
}
