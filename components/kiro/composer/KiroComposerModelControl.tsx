"use client";

import React from "react";
import { Check, ChevronDown } from "lucide-react";
import { PopoverPanel } from "@/components/ui/Popover";
import { ProviderLogo } from "@/components/kiro/ProviderLogo";
import { AIModelVendor } from "@/lib/ai/providers/types";
import { KiroReasoningEffort, ReasoningCapability } from "@/lib/ai/reasoning/types";

import { cn } from "@/lib/utils";

/**
 * Kiro Composer — Model · Reasoning（合并控件）。
 *
 * 一级：模型名（provider logo + name）。思考程度是左侧独立控件（Codex-style 滑块）。
 * 菜单：模型列表 + modelUnavailable warning；不复制 reasoning 文案。
 */
export function KiroComposerModelControl({
  modelOptions,
  selectedModelId,
  activeModelName,
  activeModelVendor,
  modelUnavailable,
  disabled,
  compact,
  onSelectModel,
  onOpenSettings,
  open: openProp,
  onOpenChange,
}: {
  modelOptions: { value: string; label: string; vendor: AIModelVendor | null }[];
  selectedModelId: string;
  activeModelName: string;
  activeModelVendor: AIModelVendor | null;
  modelUnavailable?: boolean;
  /** next-turn preference 锁（preparing 且 intent 未冻结） */
  disabled?: boolean;
  compact?: boolean;
  onSelectModel: (id: string) => void;
  onOpenSettings: () => void;
  /** 受控 open（Composer 单一菜单 ownership）；不传则内部自管 */
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

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen(!open);
        }}
        aria-label="选择模型"
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        title={modelUnavailable ? "当前模型已不可用，请重新选择" : activeModelName}
        data-testid="kiro-composer-model"
        data-model-open={open}
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
        <ProviderLogo vendor={activeModelVendor} size="sm" />
        {!compact && (
          <>
            <span className="truncate max-w-[150px]">{activeModelName}</span>
            <ChevronDown
              className={cn(
                "w-3 h-3 shrink-0 transition-transform duration-[var(--kiro-motion-control,var(--motion-fast))] ease-[var(--ease-standard)]",
                open && "rotate-180"
              )}
            />
          </>
        )}
      </button>

      <PopoverPanel open={open} placement="top-end" motionProfile="kiro" className="w-64">
        <div
          role="menu"
          aria-label="选择模型"
          className="py-1 max-h-[min(380px,60vh)] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          data-testid="kiro-composer-model-menu"
          data-kiro-composer-menu="model"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          <p className="px-3 pt-1 pb-1 text-[10px] font-bold text-sandrift">模型</p>
          {modelUnavailable && (
            <p className="px-3 py-2 text-[11px] font-semibold text-danger">当前模型已不可用，请重新选择。</p>
          )}
          {modelOptions.length === 0 ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
              className="w-full text-left px-3 py-2 text-xs text-sandrift hover:text-charcoal transition-colors"
            >
              请先在设置中填写模型 ID。
            </button>
          ) : (
            modelOptions.map((m) => (
              <button
                key={m.value}
                type="button"
                role="menuitemradio"
                aria-checked={m.value === selectedModelId}
                onClick={() => {
                  onSelectModel(m.value);
                  setOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs font-semibold transition-colors",
                  m.value === selectedModelId ? "text-charcoal bg-pastel-mint" : "text-satin-grey hover:bg-alabaster"
                )}
              >
                <ProviderLogo vendor={m.vendor} size="md" />
                <span className="min-w-0 flex-1 truncate">{m.label}</span>
                {m.value === selectedModelId && <Check className="w-4 h-4 text-charcoal shrink-0 kiro-check-settle" />}
              </button>
            ))
          )}

        </div>
      </PopoverPanel>
    </div>
  );
}
