"use client";

import React from "react";
import { Save } from "lucide-react";
import { cn } from "@/lib/utils";

interface SettingsSaveBarProps {
  dirty: boolean;
  onSave: () => void;
  onDiscard: () => void;
  saving?: boolean;
}

/** Profile / Semester 的保存体验：无变化显示"已保存"，有变化显示放弃/保存 */
export function SettingsSaveBar({ dirty, onSave, onDiscard, saving = false }: SettingsSaveBarProps) {
  return (
    <div className="flex items-center justify-between pt-1 border-t border-line-soft">
      <span
        className={cn(
          "text-[11px] font-medium",
          dirty ? "text-warning" : "text-sandrift"
        )}
        data-testid="settings-save-status"
      >
        {dirty ? "有未保存的更改" : "已保存"}
      </span>
      {dirty && (
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
      )}
    </div>
  );
}
