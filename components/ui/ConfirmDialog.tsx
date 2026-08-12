"use client";

import React from "react";
import { AlertTriangle, X } from "lucide-react";
import { useConfirmStore } from "@/store/useConfirmStore";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/utils";

const OVERLAY_ID = "confirm-dialog";

/** 统一危险操作确认对话框（删除课程、重置数据、Kiro 高风险工具等） */
export function ConfirmDialog() {
  const { request, close } = useConfirmStore();

  /** Esc / X / 取消按钮统一走 onCancel（确认按钮不触发） */
  const handleCancel = () => {
    const fn = request?.onCancel;
    close();
    fn?.();
  };

  const handleConfirm = () => {
    if (!request) return;
    const fn = request.onConfirm;
    close();
    fn();
  };

  return (
    <Dialog
      open={!!request}
      onOpenChange={(next) => {
        if (!next) handleCancel();
      }}
      overlayId={OVERLAY_ID}
      stackZ={60}
      closeOnBackdrop={false}
      role="alertdialog"
      aria-label={request?.title}
      className="max-w-sm"
    >
      {request && (
        <div className="p-5 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              {request.danger && (
                <AlertTriangle className="w-4 h-4 text-danger shrink-0" />
              )}
              <h3 className="text-sm font-bold text-charcoal">{request.title}</h3>
            </div>
            <button
              onClick={handleCancel}
              className="p-1 rounded-lg text-sandrift hover:bg-alabaster hover:text-charcoal transition-colors"
              aria-label="关闭"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {request.description && (
            <p className="text-xs text-satin-grey leading-relaxed">{request.description}</p>
          )}

          <div className="flex justify-end space-x-2 pt-2 border-t border-[#F0EBE1]">
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-xs font-medium text-satin-grey bg-alabaster border border-line rounded-xl hover:bg-alba transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              autoFocus
              data-testid="confirm-dialog-confirm"
              className={cn(
                "ux-press px-4 py-2 text-xs font-bold rounded-xl transition-colors",
                request.danger
                  ? "bg-danger hover:bg-danger/85 text-white"
                  : "bg-charcoal hover:bg-black text-white"
              )}
            >
              {request.confirmLabel || "确认"}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
