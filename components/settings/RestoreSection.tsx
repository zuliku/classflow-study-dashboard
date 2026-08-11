"use client";

import React, { useRef, useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { prepareBackupRestore, commitBackupRestore, PreparedRestore } from "@/lib/backupRestore";
import { RestorePreviewDialog } from "@/components/settings/RestorePreviewDialog";
import { SettingsActionRow } from "@/components/settings/SettingsActionRow";

export interface RestoreResult {
  courses: number;
  schedules: number;
  assignments: number;
  materials: number;
  warnings: string[];
}

/** 恢复数据：选择文件 → 只做 prepare（预览）→ 用户确认 → commit */
export function RestoreSection({
  onRestored,
}: {
  onRestored: (result: RestoreResult) => void;
}) {
  const restoreAppData = useAppStore((s) => s.restoreAppData);
  const pushToast = useToastStore((s) => s.pushToast);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const [prepared, setPrepared] = useState<PreparedRestore | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);

  const handlePickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setIsPreparing(true);
    try {
      const result = await prepareBackupRestore(file);
      if (!result.ok) {
        pushToast({ type: "error", message: result.error });
        return;
      }
      setPrepared(result.prepared);
    } catch {
      pushToast({ type: "error", message: "无法读取备份文件，请确认文件未损坏" });
    } finally {
      setIsPreparing(false);
    }
  };

  const handleCancel = () => setPrepared(null);

  const handleConfirm = async () => {
    if (!prepared || isCommitting) return;
    setIsCommitting(true);
    try {
      const { savedFailures } = await commitBackupRestore(prepared, { restoreAppData });
      const warnings: string[] = [...prepared.integrity.warnings];
      if (savedFailures.length > 0) {
        warnings.push(`${savedFailures.length} 个附件未能恢复`);
      }
      onRestored({
        courses: prepared.summary.courses,
        schedules: prepared.summary.schedules,
        assignments: prepared.summary.assignments,
        materials: prepared.materials.size,
        warnings,
      });
      pushToast({ message: "备份已恢复" });
    } catch {
      pushToast({ type: "error", message: "恢复失败，请重试" });
    } finally {
      setIsCommitting(false);
      setPrepared(null);
    }
  };

  return (
    <div data-testid="restore-section">
      <input
        ref={inputRef}
        type="file"
        accept=".zip,.json"
        onChange={handlePickFile}
        className="hidden"
        id="restore-file-input"
      />
      <SettingsActionRow
        title="从 ClassFlow 备份恢复"
        description="支持 .zip / .json，选择后先预览再确认恢复"
        icon={
          isPreparing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-sandrift" />
          ) : (
            <Upload className="w-3.5 h-3.5 text-[#A48F82]" />
          )
        }
        actionLabel={isPreparing ? "正在检查…" : "选择文件"}
        onAction={() => inputRef.current?.click()}
        actionMinWidth="min-w-[104px]"
      />

      {prepared && (
        <RestorePreviewDialog
          prepared={prepared}
          onCancel={handleCancel}
          onConfirm={handleConfirm}
          committing={isCommitting}
        />
      )}
    </div>
  );
}
