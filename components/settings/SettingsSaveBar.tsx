"use client";

import React from "react";
import { Save } from "lucide-react";
import { ExitCollapse } from "@/components/ui/ExitCollapse";
import { cn } from "@/lib/utils";

interface SettingsSaveBarProps {
  dirty: boolean;
  /** 有改动但字段非法：仍显示放弃/保存，状态明确提示先修正 */
  valid?: boolean;
  /** 编辑模式：即使尚未改动也显示放弃/保存（否则没有退出编辑态的入口） */
  forceActions?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  saving?: boolean;
}

/** Profile / Semester 的保存体验：无变化显示"已保存"，有变化显示放弃/保存 */
export function SettingsSaveBar({ dirty, valid = true, forceActions = false, onSave, onDiscard, saving = false }: SettingsSaveBarProps) {
  const showActions = dirty || forceActions;
  return (
    <div className="flex items-center justify-between pt-1 border-t border-line-soft">
      <span
        className={cn(
          "text-[11px] font-medium",
          dirty ? (valid ? "text-warning" : "text-danger") : "text-sandrift"
        )}
        data-testid="settings-save-status"
      >
        {dirty ? (valid ? "有未保存的更改" : "请先修正错误") : forceActions ? "编辑中" : "已保存"}
      </span>
      {/* 按钮组始终挂载：dirty 变化只切换折叠，不先卸载内容（否则退出折叠的是空盒） */}
      <ExitCollapse exiting={!showActions} axis="horizontal" className="shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={onDiscard}
            disabled={saving}
            className="px-3 py-1.5 text-[11px] font-medium text-satin-grey bg-[#F7F5F5] border border-line rounded-xl hover:bg-alba transition-colors disabled:opacity-50"
          >
            放弃更改
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="ux-press flex items-center gap-1.5 px-3.5 py-1.5 text-[11px] font-bold text-white bg-charcoal hover:bg-black rounded-xl transition-colors shadow-subtle disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            保存
          </button>
        </div>
      </ExitCollapse>
    </div>
  );
}
