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
/** 弹窗固定宽度（w-64 = 256px）：用于锚点精确居中 */
const KiroComposerReasoningControlWIDTH = 256;

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

      {/* 弹窗锚点：位于「思考程度图标」中心（inline style 保证 containing block，不随 label 宽度漂移） */}
      <span
        aria-hidden="true"
        data-testid="kiro-composer-reasoning-anchor"
        className="pointer-events-none"
        style={{ position: "absolute", left: 18, top: 0, width: 0, height: 0 }}
      >
        <PopoverPanel
          open={open}
          placement="anchor"
          motionProfile="kiro"
          className="pointer-events-auto w-64 max-w-[calc(100vw-24px)] overflow-hidden"
          /* 固定宽度居中对齐到锚点（182 = w-64/2 + 图标中心偏移）：不依赖 transform，保留 enter/exit motion */
          style={{ left: "50%", bottom: "100%", marginLeft: -(KiroComposerReasoningControlWIDTH / 2), marginBottom: 6 }}
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

          {/* 分段轨道（Codex-style）：点击选中；白色 knob 指示当前档位（恒在轨道内，不溢出） */}
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
            className="relative mt-2 h-9 rounded-full bg-alabaster overflow-hidden focus:outline-none focus-visible:ring-1 focus-visible:ring-line-strong"
          >
            {/* 填充：到当前档位中心（knob 覆盖接缝，视觉连续） */}
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 bg-pastel-mint transition-[width] duration-[var(--kiro-motion-control,var(--motion-fast))] ease-[var(--ease-standard)]"
              style={{ width: `${((activeIndex + 0.5) / steps.length) * 100}%` }}
            />
            {/* 档位点：未选中显示小点；选中位置由 knob 表达 */}
            {steps.map((step, index) =>
              index === activeIndex ? null : (
                <span
                  key={step}
                  aria-hidden="true"
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-sandrift/50"
                  style={{ left: `${((index + 0.5) / steps.length) * 100}%` }}
                />
              )
            )}
            {/* 白色 knob：位置 = 当前档位中心 */}
            <span
              aria-hidden="true"
              data-testid="kiro-composer-reasoning-knob"
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-surface border border-line shadow-subtle transition-[left] duration-[var(--kiro-motion-control,var(--motion-fast))] ease-[var(--ease-standard)]"
              style={{ left: `${((activeIndex + 0.5) / steps.length) * 100}%` }}
            />
            {/* 可点击段：每档一个（点击选中；弹窗保持打开） */}
            <div className="absolute inset-0 flex">
              {steps.map((step, index) => {
                const selected = index === activeIndex;
                return (
                  <button
                    key={step}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={`思考程度：${reasoningEffortLabel(step)}`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      commit(step);
                    }}
                    onClick={() => commit(step)}
                    className="flex flex-1 min-w-0 items-center justify-center rounded-full focus:outline-none focus-visible:ring-1 focus-visible:ring-line-strong"
                  >
                    <span className="sr-only">{reasoningEffortLabel(step)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        </PopoverPanel>
      </span>
    </div>
  );
}
