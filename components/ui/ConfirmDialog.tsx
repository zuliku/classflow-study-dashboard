"use client";

import React, { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useConfirmStore } from "@/store/useConfirmStore";
import { usePresence } from "@/lib/usePresence";
import { useRestoreFocus } from "@/lib/useRestoreFocus";
import { cn } from "@/lib/utils";
import { pushOverlay, popOverlay, isTopmostOverlay } from "@/lib/overlayStack";

const OVERLAY_ID = "confirm-dialog";

/** 统一危险操作确认对话框（仅用于删除课程、重置数据等高危操作） */
export function ConfirmDialog() {
  const { request, close } = useConfirmStore();
  const { mounted, visible } = usePresence(!!request, 220);
  useRestoreFocus(!!request);

  useEffect(() => {
    if (!mounted) return;
    pushOverlay(OVERLAY_ID, 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopmostOverlay(OVERLAY_ID)) close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      popOverlay(OVERLAY_ID);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  if (!mounted || !request) return null;

  const handleConfirm = () => {
    const fn = request.onConfirm;
    close();
    fn();
  };

  return (
    <div
      className={cn(
        "fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4",
        "ux-overlay",
        visible ? "opacity-100" : "opacity-0"
      )}
      role="alertdialog"
      aria-modal="true"
    >
      <div
        className={cn(
          "w-full max-w-sm bg-surface rounded-2xl shadow-drawer border border-line overflow-hidden",
          "ux-modal-panel",
          visible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-[0.985] translate-y-1"
        )}
      >
        <div className="p-5 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              {request.danger && (
                <AlertTriangle className="w-4 h-4 text-danger shrink-0" />
              )}
              <h3 className="text-sm font-bold text-charcoal">{request.title}</h3>
            </div>
            <button
              onClick={close}
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
              onClick={close}
              className="px-4 py-2 text-xs font-medium text-satin-grey bg-alabaster border border-line rounded-xl hover:bg-alba transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              autoFocus
              className={cn(
                "px-4 py-2 text-xs font-bold rounded-xl transition-colors",
                request.danger
                  ? "bg-danger hover:bg-danger/85 text-white"
                  : "bg-charcoal hover:bg-black text-white"
              )}
            >
              {request.confirmLabel || "确认"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
