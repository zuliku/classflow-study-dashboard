"use client";

import React from "react";
import { Check, Settings2, ShieldAlert, ShieldCheck } from "lucide-react";
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

export interface KiroComposerPermissionSummary {
  terminal: boolean;
  desktopObserve: boolean;
  desktopAction: boolean;
  clipboard: boolean;
}

function PermissionRow({ label, allowed }: { label: string; allowed: boolean }) {
  return (
    <div
      className="flex items-center justify-between gap-1.5 px-2 h-7 rounded-md bg-alabaster/60"
      data-testid="kiro-composer-permission-row"
    >
      <span className="text-[10px] font-medium text-satin-grey truncate">{label}</span>
      <span className={cn("text-[10px] font-semibold shrink-0", allowed ? "text-charcoal" : "text-sandrift/80")}>
        {allowed ? "已允许" : "未允许"}
      </span>
    </div>
  );
}

/**
 * Kiro Composer — Access（访问）：Computer 开关 + Agent Mode + 工作范围 + 权限摘要。
 *
 * - 一级只显示一个 chip（🛡 仅对话 / 仅规划 / 受控访问 / 自动执行）
 * - 仅对话 ↔ Computer ON/OFF：Turn 运行中禁用（属于当前 Turn scope）
 * - plan / guided / workspace-auto：只受 next-turn preference 锁（Intent 冻结后仍可改）
 * - 细粒度权限只显示「已允许 / 未允许」（permission preference），不声称 runtime availability
 * - 权限修改入口：管理 Agent 权限… → 设置
 */
export function KiroComposerAccessControl({
  computerEnabled,
  agentMode,
  workspaceName,
  workspaceConfigured,
  grantWarning,
  permissions,
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
  workspaceName: string | null;
  workspaceConfigured: boolean;
  grantWarning?: string | null;
  permissions: KiroComposerPermissionSummary;
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
        title={`${copy.label}${workspaceConfigured && workspaceName ? ` · ${workspaceName}` : ""}`}
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
        {!compact && <span className="truncate max-w-[110px]">{copy.label}</span>}
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

          <div className="px-3 py-1" data-testid="kiro-composer-access-workspace">
            <p className="text-[10px] font-bold tracking-[0.02em] text-sandrift">工作范围</p>
            <p className="mt-0.5 text-[11px] font-semibold text-charcoal truncate">
              {workspaceName ?? "未配置 Workspace"}
            </p>
            {warning && (
              <p className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-warning">
                <ShieldAlert className="w-3 h-3 shrink-0" />
                {grantWarning}
              </p>
            )}
          </div>

          <div className="my-1 h-px bg-line-soft" aria-hidden="true" />

          <div className="px-3 pt-0.5" data-testid="kiro-composer-access-permissions">
            <p className="pb-1 text-[10px] font-bold tracking-[0.02em] text-sandrift">权限</p>
            <div className="grid grid-cols-2 gap-1">
              <PermissionRow label="终端" allowed={permissions.terminal} />
              <PermissionRow label="查看桌面" allowed={permissions.desktopObserve} />
              <PermissionRow label="操作电脑" allowed={permissions.desktopAction} />
              <PermissionRow label="剪贴板" allowed={permissions.clipboard} />
            </div>
          </div>

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
