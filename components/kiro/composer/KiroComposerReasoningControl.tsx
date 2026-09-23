"use client";

import React from "react";
import { RotateCcw, Zap } from "lucide-react";
import { PopoverPanel } from "@/components/ui/Popover";
import { KiroReasoningEffort, ReasoningCapability } from "@/lib/ai/reasoning/types";
import {
  isComposerReasoningAdjustable,
  reasoningEffortLabel,
  reasoningStepIndex,
} from "@/components/kiro/composer/KiroComposerModel";
import { cn } from "@/lib/utils";

/**
 * Kiro Composer — Reasoning（Codex-style 滑块）。
 *
 * - 一级：`⚡ 高`（default → `⚡ 默认`；compact → 仅图标）
 * - 弹层：当前档位 + 模型名 + 分段滑块（点选 / 拖拽 / 键盘 ← →），↺ 恢复默认
 * - Reasoning 是 Model preference：与 Computer 开关无关；模型 fixed → 不渲染
 * - 动画克制：只允许 knob / fill 的 transition；无持续动画
 */
export function KiroComposerReasoningControl({
  capability,
  effort,
  modelName,
  disabled,
  compact,
  onChange,
  open: openProp,
  onOpenChange,
}: {
  capability?: ReasoningCapability | null;
  effort: KiroReasoningEffort;
  modelName: string;
  disabled?: boolean;
  compact?: boolean;
  onChange: (effort: KiroReasoningEffort) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = React.useCallback(
    (next: boolean) => {
      onOpenChange?.(next);
      if (openProp === undefined) setInternalOpen(next);
    },
    [onOpenChange, openProp]
  );
  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const trackRef = React.useRef<HTMLDivElement | null>(null);

  if (!isComposerReasoningAdjustable(capability) || !capability) return null;

  const steps = capability.supportedEfforts;
  const activeIndex = reasoningStepIndex(steps, effort);
  const shownIndex = dragIndex ?? activeIndex;
  const lastIndex = Math.max(1, steps.length - 1);
  const fillPercent = (shownIndex / lastIndex) * 100;

  const indexFromClientX = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return activeIndex;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(ratio * lastIndex);
  };

  const commitIndex = (index: number) => {
    const next = steps[Math.min(steps.length - 1, Math.max(0, index))];
    if (next && next !== effort) onChange(next);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen(!open);
        }}
        aria-label="思考程度"
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        title={`思考程度：${reasoningEffortLabel(effort)}`}
        data-testid="kiro-composer-reasoning"
        className={cn(
          "flex items-center h-9 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
          compact
            ? cn(
                "w-9 justify-center",
                open ? "bg-alabaster text-charcoal" : "text-sandrift hover:bg-alabaster hover:text-charcoal"
              )
            : cn(
                "gap-1 px-2.5 text-[11px] font-semibold",
                open
                  ? "bg-alabaster text-charcoal border border-line-strong"
                  : "text-sandrift border border-transparent hover:bg-alabaster hover:text-charcoal"
              )
        )}
      >
        <Zap className="w-3.5 h-3.5 shrink-0" />
        {!compact && <span className="truncate max-w-[64px]">{reasoningEffortLabel(effort)}</span>}
      </button>

      <PopoverPanel open={open} placement="top-end" motionProfile="kiro" className="w-56">
        <div className="p-2.5" data-testid="kiro-composer-reasoning-menu" role="dialog" aria-label="思考程度">
          <div className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-sandrift shrink-0" aria-hidden="true" />
            <span className="flex-1 text-center text-xs font-bold text-charcoal">
              {reasoningEffortLabel(steps[shownIndex] ?? effort)}
            </span>
            <button
              type="button"
              onClick={() => commitIndex(steps.indexOf("default"))}
              disabled={effort === "default"}
              aria-label="恢复默认思考程度"
              className="p-1 rounded-md text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="mt-0.5 text-center text-[10px] text-sandrift truncate">{modelName}</p>

          {/* 分段滑块：点选 / 拖拽 / 键盘；轨道上的点对应每个 supportedEffort */}
          <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label="思考程度"
            aria-valuemin={0}
            aria-valuemax={lastIndex}
            aria-valuenow={shownIndex}
            aria-valuetext={reasoningEffortLabel(steps[shownIndex] ?? effort)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                commitIndex(shownIndex - 1);
              }
              if (e.key === "ArrowRight") {
                e.preventDefault();
                commitIndex(shownIndex + 1);
              }
            }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const index = indexFromClientX(e.clientX);
              setDragIndex(index);
            }}
            onPointerMove={(e) => {
              if (dragIndex === null) return;
              setDragIndex(indexFromClientX(e.clientX));
            }}
            onPointerUp={(e) => {
              if (dragIndex === null) return;
              const index = indexFromClientX(e.clientX);
              setDragIndex(null);
              commitIndex(index);
            }}
            onPointerCancel={() => setDragIndex(null)}
            className="relative mt-2 h-9 rounded-full bg-alabaster cursor-pointer select-none touch-none focus:outline-none focus-visible:ring-1 focus-visible:ring-line-strong"
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-pastel-mint transition-[width] duration-[var(--kiro-motion-control,var(--motion-fast))] ease-[var(--ease-standard)]"
              style={{ width: `${fillPercent}%` }}
              aria-hidden="true"
            />
            {steps.map((step, index) => (
              <span
                key={step}
                aria-hidden="true"
                className={cn(
                  "absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full",
                  index <= shownIndex ? "bg-charcoal/40" : "bg-sandrift/50"
                )}
                style={{ left: `${(index / lastIndex) * 100}%` }}
              />
            ))}
            <span
              aria-hidden="true"
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-surface border border-line shadow-subtle transition-[left] duration-[var(--kiro-motion-control,var(--motion-fast))] ease-[var(--ease-standard)]"
              style={{ left: `${fillPercent}%` }}
            />
          </div>
        </div>
      </PopoverPanel>
    </div>
  );
}
