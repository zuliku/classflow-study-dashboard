"use client";

import React from "react";
import { X, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { PreparedRestore } from "@/lib/backupRestore";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";

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
  const blocked = prepared.integrity.fatal.length > 0;
  const summaryRows = [
    { label: "课程", value: prepared.summary.courses },
    { label: "排课", value: prepared.summary.schedules },
    { label: "任务", value: prepared.summary.assignments },
    { label: "小组项目", value: prepared.summary.groupProjects },
    { label: "课程资料", value: prepared.summary.materials },
  ];

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !committing) onCancel();
      }}
      overlayId="restore-preview"
      stackZ={50}
      onEscapeKeyDown={(event) => {
        // committing 期间禁止 Esc 关闭
        if (committing) event.preventDefault();
      }}
      aria-label="恢复备份"
      data-testid="restore-preview"
    >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-line-soft flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-sm font-bold text-charcoal">恢复备份</h3>
            <p className="text-[11px] text-sandrift mt-0.5 truncate max-w-[320px]">
              {prepared.fileName}
            </p>
          </div>
          <IconButton
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={committing}
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </IconButton>
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
                  {prepared.integrity.fatal.length === 0 && prepared.missingMaterials.length === 0 && (
                    <p className="flex items-center gap-1.5 text-success font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      关联关系正常
                    </p>
                  )}
                  {/* B1：ZIP 内缺失的附件必须在预览可见（否则用户在「关联关系正常」误导下确认恢复） */}
                  {prepared.missingMaterials.length > 0 && (
                    <p
                      className="flex items-start gap-1.5 text-warning font-semibold"
                      data-testid="restore-missing-materials"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>
                        {prepared.missingMaterials.length} 个附件文件不在备份包内（如{" "}
                        {prepared.missingMaterials[0].title}
                        {prepared.missingMaterials.length > 1 ? " 等" : ""}），恢复后将无法打开这些资料
                      </span>
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
            <Button
              variant="secondary"
              size="sm"
              onClick={onCancel}
              disabled={committing}
            >
              {blocked ? "关闭" : "取消"}
            </Button>
            {!blocked && (
              <Button
                variant="primary"
                size="sm"
                onClick={onConfirm}
                loading={committing}
                loadingLabel="正在恢复…"
                data-testid="confirm-restore"
              >
                恢复
              </Button>
            )}
          </div>
        </div>
      </Dialog>
  );
}
