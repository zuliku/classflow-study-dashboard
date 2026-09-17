"use client";

import React, { useState } from "react";
import { X } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { SINGLE_KEY_SHORTCUTS } from "@/lib/shortcuts";

/**
 * V5A4：只读快捷键说明（静态真值展示，不可修改按键）。
 * 按键字符派生自 lib/shortcuts.ts；X = 选择/取消选择（绝非删除），Space = 预览任务（桌面端）。
 */
export const SHORTCUT_OVERVIEW_ROWS: { keys: string; label: string }[] = [
  { keys: SINGLE_KEY_SHORTCUTS.quickCreateTask, label: "快速新建任务" },
  { keys: SINGLE_KEY_SHORTCUTS.openSearch, label: "打开搜索" },
  {
    keys: `${SINGLE_KEY_SHORTCUTS.assignmentMoveDown} / ${SINGLE_KEY_SHORTCUTS.assignmentMoveUp}`,
    label: "任务列表上下移动",
  },
  { keys: SINGLE_KEY_SHORTCUTS.assignmentToggleSelection, label: "选择 / 取消选择任务" },
  { keys: "Space", label: "预览任务（桌面端）" },
  { keys: SINGLE_KEY_SHORTCUTS.openHelp, label: "快捷键帮助" },
];

/** 快捷键说明二级弹窗（只读列表；按键不可修改） */
export function ShortcutOverviewDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      overlayId="shortcuts-overview-dialog"
      stackZ={60}
      closeOnBackdrop
      trapFocus
      aria-label="快捷键说明"
      data-testid="shortcuts-overview-dialog"
      className="max-w-md max-h-[90dvh] flex flex-col"
    >
      <div className="shrink-0 px-5 py-3.5 border-b border-line-soft flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-charcoal">快捷键说明</h3>
          <p className="text-[11px] text-sandrift mt-0.5">常用单键与任务列表操作（只读）。</p>
        </div>
        <button
          onClick={() => onOpenChange(false)}
          className="p-1.5 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors shrink-0"
          aria-label="关闭快捷键说明"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-5">
        <ul className="divide-y divide-line-soft rounded-xl border border-line bg-surface overflow-hidden">
          {SHORTCUT_OVERVIEW_ROWS.map((row) => (
            <li key={row.keys} className="flex items-center gap-3 px-3.5 py-2.5">
              <kbd className="shrink-0 min-w-10 text-center bg-white border border-line rounded-lg px-2 py-1 text-[11px] font-mono font-bold text-charcoal shadow-subtle">
                {row.keys}
              </kbd>
              <span className="text-xs font-semibold text-charcoal">{row.label}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="shrink-0 px-5 py-3.5 border-t border-line-soft flex items-center justify-between gap-3">
        <p className="text-[10px] text-sandrift">方向键、Enter、Tab 与 Cmd/Ctrl 组合始终可用。</p>
        <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
          关闭
        </Button>
      </div>
    </Dialog>
  );
}

/** 快捷键说明行内控件（紧凑模式）：示例 + 计数 + 查看全部入口 */
export function ShortcutOverviewField() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const first = SHORTCUT_OVERVIEW_ROWS[0];

  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-alabaster border border-line text-[11px] font-mono whitespace-nowrap">
        <span className="bg-white border border-line rounded px-1.5 py-0.5 font-bold text-charcoal">
          {first.keys}
        </span>
        <span className="font-bold text-sandrift">{first.label}</span>
        <span className="font-bold text-sandrift">等 {SHORTCUT_OVERVIEW_ROWS.length} 项</span>
      </span>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setDialogOpen(true)}
        aria-label="查看全部快捷键说明"
        className="h-7 px-2.5 text-[11px]"
      >
        查看全部
      </Button>
      <ShortcutOverviewDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </span>
  );
}
