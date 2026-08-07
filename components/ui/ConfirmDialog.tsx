"use client";

import React, { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useConfirmStore } from "@/store/useConfirmStore";
import { usePresence } from "@/lib/usePresence";
import { cn } from "@/lib/utils";

/** 统一危险操作确认对话框（仅用于删除课程、重置数据等高危操作） */
export function ConfirmDialog() {
  const { request, close } = useConfirmStore();
  const { mounted, visible } = usePresence(!!request, 220);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
          "w-full max-w-sm bg-white rounded-2xl shadow-drawer border border-[#E7E3DD] overflow-hidden",
          "ux-modal-panel",
          visible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-[0.985] translate-y-1"
        )}
      >
        <div className="p-5 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              {request.danger && (
                <AlertTriangle className="w-4 h-4 text-[#D94F4F] shrink-0" />
              )}
              <h3 className="text-sm font-bold text-charcoal">{request.title}</h3>
            </div>
            <button
              onClick={close}
              className="p-1 rounded-lg text-[#8C827A] hover:bg-[#F0EBE1] hover:text-charcoal transition-colors"
              aria-label="关闭"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {request.description && (
            <p className="text-xs text-[#676268] leading-relaxed">{request.description}</p>
          )}

          <div className="flex justify-end space-x-2 pt-2 border-t border-[#F0EBE1]">
            <button
              onClick={close}
              className="px-4 py-2 text-xs font-medium text-[#676268] bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl hover:bg-[#E0D7C6] transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              autoFocus
              className={cn(
                "px-4 py-2 text-xs font-bold rounded-xl transition-colors",
                request.danger
                  ? "bg-[#D94F4F] hover:bg-[#C44343] text-white"
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
