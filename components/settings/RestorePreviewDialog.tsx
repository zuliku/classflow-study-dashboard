"use client";

import React from "react";
import { X, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { PreparedRestore } from "@/lib/backupRestore";
import { pushOverlay, popOverlay, isTopmostOverlay } from "@/lib/overlayStack";
import { usePresence } from "@/lib/usePresence";
import { useRestoreFocus } from "@/lib/useRestoreFocus";
import { cn } from "@/lib/utils";

const OVERLAY_ID = "restore-preview";

interface RestorePreviewDialogProps {
  prepared: PreparedRestore;
  onCancel: () => void;
  onConfirm: () => void;
  committing: boolean;
}

/** Restore Preview：确认前不写任何数据；fatal 进入 blocked（只提供关闭） */
export function RestorePreviewDialog({
  prepared,
  onCancel,
  onConfirm,
  committing,
}: RestorePreviewDialogProps) {
  const { mounted, visible } = usePresence(true, 200);
  useRestoreFocus(true);

  // Esc（最上层时关闭；blocked 态也允许关闭）
  React.useEffect(() => {
    if (!mounted) return;
    pushOverlay(OVERLAY_ID, 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopmostOverlay(OVERLAY_ID) && !committing) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      popOverlay(OVERLAY_ID);
      window.removeEventListener("keydown", onKey);
    };
  }, [mounted, onCancel, committing]);

  if (!mounted) return null;

  const blocked = prepared.integrity.fatal.length > 0;
  const summaryRows = [
    { label: "课程", value: prepared.summary.courses },
    { label: "排课", value: prepared.summary.schedules },
    { label: "任务", value: prepared.summary.assignments },
    { label: "小组项目", value: prepared.summary.groupProjects },
    { label: "课程资料", value: prepared.summary.materials },
  ];

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4",
        "ux-overlay",
        visible ? "opacity-100" : "opacity-0"
      )}
    >
      <div
        data-testid="restore-preview"
        className={cn(
          "w-full max-w-md bg-surface rounded-2xl shadow-drawer border border-line overflow-hidden flex flex-col",
          "ux-modal-panel",
          visible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-[0.985] translate-y-1"
        )}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-line-soft flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-sm font-bold text-charcoal">恢复备份</h3>
            <p className="text-[11px] text-sandrift mt-0.5 truncate max-w-[320px]">
              {prepared.fileName}
            </p>
          </div>
          <button
            onClick={onCancel}
            disabled={committing}
            className="p-1.5 rounded-lg text-sandrift hover:bg-alabaster transition-colors disabled:opacity-50"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto text-xs">
          {blocked ? (
            /* ---- Fatal：blocked ---- */
            <div className="space-y-3" data-testid="restore-blocked">
              <div className="flex items-center gap-2 text-danger font-bold">
                <XCircle className="w-4 h-4 shrink-0" />
                无法恢复此备份
              </div>
              <p className="text-satin-grey">发现以下数据问题：</p>
              <ul className="space-y-1">
                {prepared.integrity.fatal.map((f) => (
                  <li key={f} className="flex items-start gap-1.5 text-satin-grey">
                    <span className="text-danger">•</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              {/* ---- 备份内容 ---- */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold text-sandrift uppercase tracking-wider">备份内容</p>
                <div className="grid grid-cols-5 gap-2 text-center">
                  {summaryRows.map((r) => (
                    <div key={r.label} className="p-2 bg-[#F7F5F5] rounded-lg space-y-0.5">
                      <p className="text-sm font-extrabold text-charcoal leading-none">{r.value}</p>
                      <p className="text-[10px] text-sandrift">{r.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* ---- 数据检查 ---- */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-bold text-sandrift uppercase tracking-wider">数据检查</p>
                <div className="space-y-1">
                  <p className="flex items-center gap-1.5 text-success font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    数据结构正常
                  </p>
                  {prepared.integrity.fatal.length === 0 && (
                    <p className="flex items-center gap-1.5 text-success font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      关联关系正常
                    </p>
                  )}
                  {prepared.integrity.warnings.map((w) => (
                    <p key={w} className="flex items-start gap-1.5 text-warning font-semibold">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{w}</span>
                    </p>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-line-soft flex items-center justify-between gap-3 shrink-0">
          <p className="text-[10px] text-sandrift">
            {blocked
              ? "请关闭并检查备份文件"
              : "恢复会替换 ClassFlow 当前数据。备份内容已在预览中确认。"}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onCancel}
              disabled={committing}
              className="px-3 py-1.5 text-[11px] font-medium text-satin-grey bg-[#F7F5F5] border border-line rounded-xl hover:bg-alba transition-colors disabled:opacity-50"
            >
              {blocked ? "关闭" : "取消"}
            </button>
            {!blocked && (
              <button
                onClick={onConfirm}
                disabled={committing}
                className="ux-press px-3.5 py-1.5 text-[11px] font-bold text-white bg-charcoal hover:bg-black rounded-xl transition-colors shadow-subtle disabled:opacity-50"
                data-testid="confirm-restore"
              >
                {committing ? "正在恢复…" : "恢复"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
