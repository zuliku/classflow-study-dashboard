"use client";

import React, { useState } from "react";
import { Archive, Download, Loader2, AlertTriangle } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { ClassFlowBackup, ClassFlowBackupData } from "@/types";
import { buildFullBackupZip } from "@/lib/backupPackage";

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

/** 备份：完整 ZIP 为 primary，仅数据 JSON 为 secondary；反馈留在本区不弹大 banner */
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
    <div className="space-y-2.5 text-xs" data-testid="backup-section">
      {feedback && (
        <div className="p-2.5 bg-pastel-mint/60 border border-line rounded-xl space-y-0.5">
          <p className="font-bold text-success">{feedback.message}</p>
          {feedback.warning && (
            <p className="flex items-center gap-1.5 text-warning font-semibold">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {feedback.warning}
            </p>
          )}
        </div>
      )}

      {/* 完整备份（primary） */}
      <div className="flex items-center justify-between gap-4 p-3 bg-[#F7F5F5] border border-line rounded-xl">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-bold text-charcoal">
            <Archive className="w-3.5 h-3.5 text-[#A48F82]" />
            完整备份
            <span className="text-[9px] font-bold text-charcoal bg-pastel-mint px-1.5 py-0.5 rounded-full">推荐</span>
          </p>
          <p className="text-[10px] text-sandrift mt-0.5">包含课程、任务、设置与课程资料文件</p>
        </div>
        <button
          onClick={exportFull}
          disabled={isExportingZip || isExportingJson}
          className="ux-press flex items-center gap-1.5 px-3 py-1.5 bg-charcoal hover:bg-black text-white font-bold rounded-xl transition-colors shadow-subtle disabled:opacity-60 shrink-0"
        >
          {isExportingZip ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Archive className="w-3.5 h-3.5" />
          )}
          {isExportingZip ? "正在打包…" : "导出 ZIP"}
        </button>
      </div>

      {/* 仅数据备份（secondary） */}
      <div className="flex items-center justify-between gap-4 p-3 bg-[#F7F5F5] border border-line rounded-xl">
        <div className="min-w-0">
          <p className="font-bold text-charcoal">仅数据备份</p>
          <p className="text-[10px] text-sandrift mt-0.5">不包含课程资料文件</p>
        </div>
        <button
          onClick={exportJSON}
          disabled={isExportingZip || isExportingJson}
          className="ux-press flex items-center gap-1.5 px-3 py-1.5 bg-white border border-line text-charcoal font-bold rounded-xl transition-colors hover:bg-alabaster disabled:opacity-60 shrink-0"
        >
          <Download className="w-3.5 h-3.5 text-[#A48F82]" />
          {isExportingJson ? "正在导出…" : "导出 JSON"}
        </button>
      </div>
    </div>
  );
}
