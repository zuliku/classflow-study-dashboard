"use client";

import React, { useState } from "react";
import { Archive, Download, Loader2, AlertTriangle } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { ClassFlowBackup, ClassFlowBackupData } from "@/types";
import { buildFullBackupZip } from "@/lib/backupPackage";
import { SettingsActionRow } from "@/components/settings/SettingsActionRow";

const localDateStr = () => {
  const d = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

function downloadBlob(href: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.setAttribute("href", href);
  anchor.setAttribute("download", filename);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** 备份（Settings V3 Task 6）：两行统一 action row；完整 ZIP 为 primary，仅数据 JSON 为 secondary */
export function BackupSection() {
  const state = useAppStore();
  const {
    userProfile,
    semester,
    courses,
    schedules,
    assignments,
    calendarMarks,
    groupProjects,
    preferences,
    reminders,
    focusSessions,
    scheduleOccurrenceOverrides,
  } = state;
  const pushToast = useToastStore((s) => s.pushToast);

  const [isExportingZip, setIsExportingZip] = useState(false);
  const [isExportingJson, setIsExportingJson] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; warning?: string } | null>(null);

  const backupData = (): ClassFlowBackupData => ({
    userProfile,
    semester,
    courses,
    schedules,
    assignments,
    calendarMarks,
    groupProjects,
    preferences,
    reminders,
    focusSessions,
    scheduleOccurrenceOverrides,
  });

  const exportFull = async () => {
    if (isExportingZip) return;
    setIsExportingZip(true);
    setFeedback(null);
    try {
      const { zipBlob, result } = await buildFullBackupZip(backupData());
      const url = URL.createObjectURL(zipBlob);
      downloadBlob(url, `classflow_full_backup_${localDateStr()}.zip`);
      URL.revokeObjectURL(url);
      setFeedback({ message: `备份已导出 · ${result.packedMaterials} 个附件` });
      if (result.missingMaterials.length > 0) {
        setFeedback((f) => ({
          message: f?.message ?? "",
          warning: `${result.missingMaterials.length} 个资料文件未能加入备份`,
        }));
      }
      pushToast({ message: "备份已导出" });
    } catch {
      pushToast({ type: "error", message: "备份导出失败，请重试" });
    } finally {
      setIsExportingZip(false);
    }
  };

  const exportJSON = async () => {
    if (isExportingJson) return;
    setIsExportingJson(true);
    setFeedback(null);
    try {
      const backup: ClassFlowBackup = {
        version: 1,
        exportedAt: new Date().toISOString(),
        data: backupData(),
      };
      const dataStr =
        "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backup, null, 2));
      downloadBlob(dataStr, `classflow_backup_${localDateStr()}.json`);
      setFeedback({ message: "仅数据备份已导出" });
    } finally {
      setIsExportingJson(false);
    }
  };

  return (
    <div data-testid="backup-section">
      <SettingsActionRow
        settingId="backup-full"
        title="完整备份"
        description="包含课程、任务、设置与课程资料文件"
        variant="primary"
        icon={
          isExportingZip ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Archive className="w-3.5 h-3.5" />
          )
        }
        actionLabel={isExportingZip ? "正在打包…" : "导出 ZIP"}
        onAction={() => void exportFull()}
        actionMinWidth="min-w-[104px]"
      />
      <SettingsActionRow
        settingId="backup-json"
        title="仅数据备份"
        description="不包含课程资料文件"
        icon={
          isExportingJson ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5 text-[#A48F82]" />
          )
        }
        actionLabel={isExportingJson ? "正在导出…" : "导出 JSON"}
        onAction={() => void exportJSON()}
        actionMinWidth="min-w-[104px]"
      />
      {feedback && (
        <div className="pt-2 space-y-0.5">
          <p className="font-bold text-success text-[11px]">{feedback.message}</p>
          {feedback.warning && (
            <p className="flex items-center gap-1.5 text-warning font-semibold text-[10px]">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              {feedback.warning}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
