"use client";

import React, { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Popover, PopoverPanel } from "@/components/ui/Popover";
import { FOCUS_MAX_PLANNED_MINUTES, FOCUS_MIN_PLANNED_MINUTES } from "@/lib/focus/focusDomain";
import { FOCUS_ERROR_MESSAGES, FOCUS_PRESETS } from "@/lib/focus/focusView";
import { cn } from "@/lib/utils";

/**
 * Task Execution Loop V1：Task Detail 专属「开始专注」入口（anchored popover）。
 * - 与 Overview FocusControl 共享 FOCUS_PRESETS（15/25/30/45/60）与错误文案，不发明第二套
 * - 默认 30 分钟；自定义分钟 + 可选备注；错误内联展示（共享文案）
 * - 打开时表单重置；仅在本组件内 tick 无状态 —— 完全受控（open 由父级持有）
 */
export function FocusStartPopover({
  open,
  onOpenChange,
  assignmentTitle,
  onStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignmentTitle: string;
  /** 校验通过后回调（plannedMinutes 1–240 整数 + 已 trim 备注） */
  onStart: (plannedMinutes: number, note: string) => void;
}) {
  const [planned, setPlanned] = useState("30");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
      setNote("");
    }
  }, [open]);

  const start = () => {
    const minutes = Number(planned);
    if (
      !Number.isInteger(minutes) ||
      minutes < FOCUS_MIN_PLANNED_MINUTES ||
      minutes > FOCUS_MAX_PLANNED_MINUTES
    ) {
      setError(FOCUS_ERROR_MESSAGES.INVALID_FOCUS_DURATION ?? "专注时长需为 1–240 的整数");
      return;
    }
    setError(null);
    onStart(minutes, note.trim());
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange} className="inline-block">
      <Button
        variant="primary"
        size="sm"
        className="h-8 px-3"
        onClick={() => onOpenChange(!open)}
        data-testid="focus-start-trigger"
      >
        <Play className="h-3.5 w-3.5" />
        开始专注
      </Button>
      <PopoverPanel
        placement="bottom-start"
        open={open}
        className="w-[280px] p-3"
        data-testid="focus-start-popover"
      >
        <div className="space-y-2.5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-sandrift">开始专注</p>
            <p className="mt-0.5 truncate text-xs font-bold text-charcoal" title={assignmentTitle}>
              {assignmentTitle}
            </p>
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              {FOCUS_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlanned(String(p))}
                  className={cn(
                    "h-7 rounded-lg px-2 text-[11px] font-bold transition-colors",
                    planned === String(p)
                      ? "bg-charcoal text-white"
                      : "bg-alabaster text-charcoal hover:bg-alba"
                  )}
                >
                  {p} 分
                </button>
              ))}
              <input
                type="number"
                min={FOCUS_MIN_PLANNED_MINUTES}
                max={FOCUS_MAX_PLANNED_MINUTES}
                value={planned}
                onChange={(e) => setPlanned(e.target.value)}
                aria-label="自定义时长（分钟）"
                placeholder="自定义"
                className="h-7 w-[76px] rounded-lg border border-line-strong bg-surface px-2 text-[11px] font-bold text-charcoal outline-none focus:border-charcoal"
              />
            </div>
            {error && <p className="mt-1 text-[11px] font-semibold text-danger">{error}</p>}
          </div>

          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="备注（可选）"
            aria-label="专注备注"
            className="h-8 w-full rounded-lg border border-line-strong bg-surface px-2 text-xs text-charcoal outline-none placeholder:text-satin-grey/60 focus:border-charcoal"
          />

          <Button
            variant="primary"
            size="sm"
            className="w-full"
            onClick={start}
            data-testid="focus-start-confirm"
          >
            开始专注
          </Button>
        </div>
      </PopoverPanel>
    </Popover>
  );
}
