"use client";

import React from "react";
import { RotateCcw } from "lucide-react";
import { PopoverPanel } from "@/components/ui/Popover";
import { KiroReasoningIcon } from "@/components/kiro/KiroReasoningIcon";
import { KiroReasoningEffort, ReasoningCapability } from "@/lib/ai/reasoning/types";
import {
  isComposerReasoningAdjustable,
  reasoningEffortLabel,
  reasoningStepIndex,
} from "@/components/kiro/composer/KiroComposerModel";
import { cn } from "@/lib/utils";

/**
 * Kiro Composer — Reasoning（Codex-style 分段选择）。
 *
 * - 一级：`🧠 高`（default → `🧠 默认`；compact → 仅图标）
 * - 弹层：当前档位 + 模型名 + 分段轨道；**点击档位即选中（不关闭弹窗）**，不做拖拽放置
 * - 轨道为 flex 分段（无绝对定位溢出 → 不出现滚动条 / 不被裁剪）
 * - Reasoning 是 Model preference：与 Computer 开关无关；模型 fixed → 不渲染
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

  if (!isComposerReasoningAdjustable(capability) || !capability) return null;

  const steps = capability.supportedEfforts;
  const activeIndex = reasoningStepIndex(steps, effort);
  const fillPercent = ((activeIndex + 1) / steps.length) * 100;

  const commit = (step: KiroReasoningEffort) => {
    if (step !== effort) onChange(step);
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
                "gap-1.5 px-2.5 text-[11px] font-semibold",
                open
                  ? "bg-alabaster text-charcoal border border-line-strong"
                  : "text-sandrift border border-transparent hover:bg-alabaster hover:text-charcoal"
              )
        )}
      >
        <KiroReasoningIcon className="w-3.5 h-3.5 shrink-0" />
        {!compact && <span className="truncate max-w-[64px]">{reasoningEffortLabel(effort)}</span>}
      </button>

      {/* overflow-hidden：分段轨道不产生任何滚动条（无绝对定位溢出） */}
      <PopoverPanel
        open={open}
        placement="top-end"
        motionProfile="kiro"
        className="w-60 overflow-hidden"
      >
        <div className="p-3" data-testid="kiro-composer-reasoning-menu" role="dialog" aria-label="思考程度">
          <div className="flex items-center gap-2">
            <KiroReasoningIcon className="w-3.5 h-3.5 text-sandrift shrink-0" />
            <span className="flex-1 text-center text-xs font-bold text-charcoal">
              {reasoningEffortLabel(steps[activeIndex] ?? effort)}
            </span>
            <button
              type="button"
              onClick={() => commit("default")}
              disabled={effort === "default"}
              aria-label="恢复默认思考程度"
              className="p-1 rounded-md text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="mt-0.5 text-center text-[10px] text-sandrift truncate">{modelName}</p>

          {/* 分段轨道：每档一个可点击段（点击选中；弹窗保持打开） */}
          <div
            role="radiogroup"
            aria-label="思考程度"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" && activeIndex > 0) {
                e.preventDefault();
                commit(steps[activeIndex - 1]);
              }
              if (e.key === "ArrowRight" && activeIndex < steps.length - 1) {
                e.preventDefault();
                commit(steps[activeIndex + 1]);
              }
            }}
            data-testid="kiro-composer-reasoning-track"
            className="relative mt-2 h-8 rounded-full bg-alabaster overflow-hidden focus:outline-none focus-visible:ring-1 focus-visible:ring-line-strong"
          >
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 bg-pastel-mint transition-[width] duration-[var(--kiro-motion-control,var(--motion-fast))] ease-[var(--ease-standard)]"
              style={{ width: `${fillPercent}%` }}
            />
            <div className="relative flex h-full">
              {steps.map((step, index) => {
                const selected = index === activeIndex;
                return (
                  <button
                    key={step}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={`思考程度：${reasoningEffortLabel(step)}`}
                    onClick={() => commit(step)}
                    className="group/step flex flex-1 items-center justify-center rounded-full focus:outline-none focus-visible:ring-1 focus-visible:ring-line-strong"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "rounded-full transition-[width,height,background-color] duration-[var(--kiro-motion-control,var(--motion-fast))] ease-[var(--ease-standard)]",
                        selected
                          ? "w-2.5 h-2.5 bg-charcoal"
                          : "w-1.5 h-1.5 bg-sandrift/50 group-hover/step:bg-sandrift"
                      )}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </PopoverPanel>
    </div>
  );
}
