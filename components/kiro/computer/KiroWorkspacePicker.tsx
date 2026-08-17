"use client";

import React from "react";
import { Popover } from "@/components/ui/Popover";
import { DropdownMenuPanel, DropdownMenuItem } from "@/components/ui/DropdownMenu";
import { KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import { cn } from "@/lib/utils";

/** 状态图标（本地/Sandbox/警告） */
function LocalIcon() {
  return (
    <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

function SandboxIcon() {
  return (
    <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 4.1 12 6l-2.1-2.1a2 2 0 0 0-2.8 0L2.1 9.1a2 2 0 0 0 0 2.8l4 4a2 2 0 0 0 2.8 0L11 15.6l2 2 4.6-4.6" />
      <path d="m2 13 4.6 4.6" />
      <path d="M11.6 3.4 14 5.8l5.4 5.4a2 2 0 0 1 0 2.8l-2.6 2.6a2 2 0 0 1-2.8 0L8.6 11.2" />
      <path d="m13 2 2 2" />
    </svg>
  );
}

/**
 * Workspace 指示（Composer prompt 上方，低噪声）：
 * 展示当前 Workspace name + 本地/Sandbox；无 workspace 或授权缺失时提示。
 * 顶层/上下文区 = Kiro 正在处理什么；底部执行控件 = 如何被允许行动。
 */
export function KiroWorkspacePicker({
  workspace,
  isSandbox,
  grantWarning,
  disabled,
}: {
  workspace: KiroWorkspaceMeta | null;
  isSandbox: boolean;
  grantWarning?: string | null;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  if (!workspace) {
    return (
      <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-alabaster/70 border border-line text-[10px] font-semibold text-sandrift">
        <LocalIcon />
        未配置 Workspace
      </span>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="工作区"
        aria-expanded={open}
        disabled={disabled}
        data-workspace-open={open}
        className={cn(
          "inline-flex items-center gap-1.5 pl-2 pr-1.5 h-7 rounded-full border text-[11px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
          open
            ? "bg-pastel-mint/75 border-line-strong text-charcoal"
            : "bg-pastel-mint/55 border-line-soft text-satin-grey hover:bg-pastel-mint/75"
        )}
      >
        {isSandbox ? <SandboxIcon /> : <LocalIcon />}
        <span className="truncate max-w-[140px]">{workspace.name}</span>
        <span className="text-[9px] font-bold text-sandrift">{isSandbox ? "Sandbox" : "本地"}</span>
      </button>
      <DropdownMenuPanel open={open} placement="bottom-start" motionProfile="kiro" aria-label="工作区" className="w-56 p-1.5">
        <p className="px-2 py-1 text-[10px] font-bold text-sandrift">当前 Workspace</p>
        <div className="px-2 pb-1 flex items-center gap-1.5 text-[11px] font-semibold text-charcoal">
          {isSandbox ? <SandboxIcon /> : <LocalIcon />}
          {workspace.name}
        </div>
        <p className="px-2 pb-2 text-[9px] text-sandrift leading-relaxed">
          {isSandbox
            ? "数据仅保存在当前设备（Kiro 内置工作区），不会写入本地文件夹。"
            : "工作区文件只在你授权的目录内访问。"}
        </p>
        {grantWarning && (
          <p className="mx-1.5 mb-1 px-2 py-1 rounded-lg bg-danger-bg text-[10px] font-semibold text-danger">
            {grantWarning}
          </p>
        )}
      </DropdownMenuPanel>
    </Popover>
  );
}
