"use client";

import React from "react";
import { Popover } from "@/components/ui/Popover";
import { DropdownMenuPanel, DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { KiroAgentMode } from "@/lib/ai/computer/types";
import { cn } from "@/lib/utils";

const MODE_COPY: Record<KiroAgentMode, { label: string; description: string }> = {
  plan: { label: "计划", description: "只读取和分析，不修改文件" },
  guided: { label: "受控", description: "可创建；修改、移动和删除前询问" },
  "workspace-auto": {
    label: "工作区自动",
    description: "授权 Workspace 内文件操作自动执行；不包含终端、网络与工作区外操作",
  },
};

/** Agent Mode 选择（仅 Computer Agent ON 时显示；Composer 只切 preset，细粒度规则在 Settings） */
export function KiroAgentModeMenu({
  mode,
  onChange,
  disabled,
  iconOnly,
}: {
  mode: KiroAgentMode;
  onChange: (mode: KiroAgentMode) => void;
  disabled?: boolean;
  /** Sidecar/compact：一级栏只显示图标，文字进二级 popover */
  iconOnly?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="权限模式"
        aria-expanded={open}
        disabled={disabled}
        title={MODE_COPY[mode].label + "：" + MODE_COPY[mode].description}
        data-mode-open={open}
        className={cn(
          "flex items-center h-9 rounded-xl text-[11px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
          iconOnly ? cn("w-9 justify-center", open ? "bg-alabaster text-charcoal" : "text-sandrift hover:bg-alabaster hover:text-charcoal") : cn("gap-1 px-2.5", open ? "bg-alabaster text-charcoal border border-line-strong" : "text-sandrift border border-transparent hover:bg-alabaster hover:text-charcoal")
        )}
      >
        <ShieldCheckIcon />
        {!iconOnly && MODE_COPY[mode].label}
      </button>
      {/* Composer 位于页面底部 → 向上展开，避免越出 viewport */}
      <DropdownMenuPanel open={open} placement="top-end" motionProfile="kiro" aria-label="权限模式" className="w-56 p-1">
        {(Object.keys(MODE_COPY) as KiroAgentMode[]).map((m) => (
          <div key={m} className="px-1 py-0.5">
            <DropdownMenuItem
              label={
                <span className="flex flex-col gap-0.5 min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className={m === mode ? "text-charcoal font-bold" : ""}>{MODE_COPY[m].label}</span>
                    {m === mode && <CheckIcon className="kiro-check-settle" />}
                  </span>
                  <span className="text-[9px] font-normal text-sandrift">{MODE_COPY[m].description}</span>
                </span>
              }
              onClick={() => {
                onChange(m);
                setOpen(false);
              }}
            />
          </div>
        ))}
      </DropdownMenuPanel>
    </Popover>
  );
}

function ShieldCheckIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={cn("w-3 h-3 text-charcoal shrink-0", className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
