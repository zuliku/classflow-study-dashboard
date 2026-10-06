"use client";

import React from "react";
import { Check, Settings2, ShieldCheck } from "lucide-react";
import { PopoverPanel } from "@/components/ui/Popover";
import { KiroAgentMode } from "@/lib/ai/computer/types";
import {
  COMPOSER_ACCESS_MODES,
  COMPOSER_ACCESS_COPY,
  composerAccessAgentMode,
  composerAccessDescription,
  composerAccessRequiresComputer,
  isComposerAccessDanger,
  resolveComposerAccessState,
  type KiroComposerAccessMode,
} from "@/components/kiro/composer/KiroComposerAccess";
import { cn } from "@/lib/utils";

/**
 * Kiro Composer — Access（访问）：只做访问等级选择 + 设置入口。
 *
 * - 弹窗仅两段：顶部访问等级（仅对话 / 仅规划 / 受控访问 / 自动执行）+ 底部管理 Agent 权限…
 * - 工作范围 / 细粒度权限明细不在此展开，进设置 → Agent 与权限查看修改
 *   （一级 chip 的 title + 未授权 warning 圆点保留状态提示）
 * - 仅对话 ↔ Computer ON/OFF：Turn 运行中禁用（属于当前 Turn scope）
 * - plan / guided / workspace-auto：只受 next-turn preference 锁（Intent 冻结后仍可改）
 */
export function KiroComposerAccessControl({
  computerEnabled,
  agentMode,
  workspaceConfigured,
  grantWarning,
  scopeLocked,
  preferencesLocked,
  compact,
  onSelectMode,
  onOpenAgentSettings,
  open: openProp,
  onOpenChange,
}: {
  computerEnabled: boolean;
  agentMode: KiroAgentMode;
  workspaceConfigured: boolean;
  grantWarning?: string | null;
  /** 当前 Turn scope 锁（仅对话 ↔ Computer 开关） */
  scopeLocked: boolean;
  /** 下一 Turn preference 锁（Agent Mode 选择） */
  preferencesLocked: boolean;
  compact?: boolean;
  onSelectMode: (mode: KiroComposerAccessMode) => void;
  onOpenAgentSettings: () => void;
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
  const state = resolveComposerAccessState({ computerEnabled, agentMode });
  const copy = COMPOSER_ACCESS_COPY[state];
  const danger = isComposerAccessDanger(state);
  const warning = !!grantWarning;

  const modeDisabled = (mode: KiroComposerAccessMode): boolean => {
    // 仅对话 / 开启 Computer 都改变当前 Turn scope → Turn 运行中禁用
    if (mode === "chat" || !computerEnabled) return scopeLocked;
    return preferencesLocked;
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          if (scopeLocked && preferencesLocked) return;
          setOpen(!open);
        }}
        aria-label="访问"
        aria-expanded={open}
        aria-haspopup="menu"
        title={copy.label}
        data-testid="kiro-composer-access"
        data-access-mode={state}
        className={cn(
          "flex items-center h-9 rounded-xl text-[11px] font-semibold transition-colors min-w-0",
          compact ? "w-9 justify-center" : "gap-1.5 px-2.5",
          // P0 产品化：完全访问（workspace 已配）用橙色一眼可判（参考 Codex“完全访问”橙）；
          // 未配 workspace 的自动执行保持克制 danger 语义
          danger && workspaceConfigured && !warning
            ? open
              ? "bg-[#FFF1E6] text-[#C2410C]"
              : "text-[#C2410C] bg-[#FFF7ED] hover:bg-[#FFF1E6]"
            : danger
              ? open
                ? "bg-danger/10 text-danger"
                : "text-danger bg-danger/5 hover:bg-danger/10"
              : open
                ? "bg-alabaster text-charcoal"
                : "text-sandrift hover:bg-alabaster hover:text-charcoal"
        )}
      >
        <ShieldCheck className="w-4 h-4 shrink-0" />
        {/* P1：label 固定最小宽（模式切换“仅对话↔自动执行”字数不同，定宽后工具栏零位移） */}
        {!compact && <span className="truncate min-w-[56px] text-center max-w-[110px]">{copy.label}</span>}
        {warning && <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" aria-hidden="true" />}
      </button>

      <PopoverPanel open={open} placement="top-start" motionProfile="kiro" className="w-64">
        <div
          role="menu"
          aria-label="访问"
          className="py-1 max-h-[min(460px,68vh)] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          data-testid="kiro-composer-access-menu"
          data-kiro-composer-menu="access"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          <p className="px-3 pt-1 pb-1 text-[10px] font-bold tracking-[0.02em] text-sandrift">访问</p>
          {COMPOSER_ACCESS_MODES.map((mode) => {
            const item = COMPOSER_ACCESS_COPY[mode];
            const selected = mode === state;
            const disabled = modeDisabled(mode);
            return (
              <button
                key={mode}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => {
                  onSelectMode(mode);
                  setOpen(false);
                }}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors",
                  disabled
                    ? "opacity-40 cursor-not-allowed"
                    : selected
                      ? "bg-pastel-mint/55"
                      : "hover:bg-alabaster"
                )}
              >
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-xs",
                      selected ? "font-bold text-charcoal" : "font-semibold text-satin-grey",
                      !selected && !disabled && isComposerAccessDanger(mode) && "text-danger"
                    )}
                  >
                    {item.label}
                  </span>
                  <span className="block text-[10px] font-normal text-sandrift truncate">{item.description}</span>
                </span>
                {selected && <Check className="w-3.5 h-3.5 text-charcoal shrink-0 kiro-check-settle" />}
              </button>
            );
          })}

          <div className="my-1 h-px bg-line-soft" aria-hidden="true" />

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenAgentSettings();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-[11px] font-semibold text-satin-grey hover:bg-alabaster hover:text-charcoal transition-colors"
          >
            <Settings2 className="w-3.5 h-3.5 text-sandrift shrink-0" />
            管理 Agent 权限…
          </button>
        </div>
      </PopoverPanel>
    </div>
  );
}

/** Access 模式 → Computer / AgentMode 变更（复用 owner 的 canonical handler） */
export function composerAccessSelection(mode: KiroComposerAccessMode): {
  requiresComputer: boolean;
  agentMode: KiroAgentMode | null;
  description: string;
} {
  return {
    requiresComputer: composerAccessRequiresComputer(mode),
    agentMode: composerAccessAgentMode(mode),
    description: composerAccessDescription(mode),
  };
}
