"use client";

import React, { useState, useEffect } from "react";
import {
  Download,
  Upload,
  RotateCcw,
  CheckCircle,
  Archive,
  RefreshCw,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { parseBackupJSON, hasMaterialStorageKeys } from "@/lib/backup";
import { ClassFlowBackup, ClassFlowBackupData } from "@/types";
import {
  buildFullBackupZip,
  parseFullBackupFile,
  checkMaterialAvailability,
  MaterialAvailability,
} from "@/lib/backupPackage";
import { findDataIntegrityIssues, classifyIntegrityIssues } from "@/lib/dataIntegrity";
import { saveFileBlob } from "@/lib/fileStorage";
import { SettingsSection } from "@/components/settings/SettingsSection";

const localDateStr = () => {
  const d = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

export function DataSettings() {
  const state = useAppStore();
  const {
    userProfile,
    resetAllDataToDefault,
    restoreAppData,
    courses,
    schedules,
    assignments,
    calendarMarks,
    groupProjects,
    semester,
    preferences,
  } = state;

  const pushToast = useToastStore((s) => s.pushToast);
  const confirmRequest = useConfirmStore((s) => s.confirm);

  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importWarning, setImportWarning] = useState<string | null>(null);
  const [materialHealth, setMaterialHealth] = useState<MaterialAvailability | null>(null);
  const [isCheckingMaterials, setIsCheckingMaterials] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // 进入设置页时做一次轻量课程资料可用性检查（非常驻扫描）
  useEffect(() => {
    let cancelled = false;
    checkMaterialAvailability(courses)
      .then((health) => {
        if (!cancelled) setMaterialHealth(health);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [courses]);

  const handleRefreshMaterialHealth = async () => {
    setIsCheckingMaterials(true);
    try {
      const health = await checkMaterialAvailability(courses);
      setMaterialHealth(health);
    } finally {
      setIsCheckingMaterials(false);
    }
  };

  const handleExportDataJSON = () => {
    const backup: ClassFlowBackup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        userProfile,
        semester,
        courses,
        schedules,
        assignments,
        calendarMarks,
        groupProjects,
        preferences,
      },
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backup, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `classflow_backup_${localDateStr()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // 导出完整备份 ZIP：data.json + materials/ 下的真实文件 Blob
  const handleExportFullBackup = async () => {
    if (isExporting) return;
    setIsExporting(true);
    setImportStatus(null);
    setImportWarning(null);
    try {
      const data: ClassFlowBackupData = {
        userProfile,
        semester,
        courses,
        schedules,
        assignments,
        calendarMarks,
        groupProjects,
        preferences,
      };
      const { zipBlob, result } = await buildFullBackupZip(data);

      const url = URL.createObjectURL(zipBlob);
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", url);
      downloadAnchor.setAttribute("download", `classflow_full_backup_${localDateStr()}.zip`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      URL.revokeObjectURL(url);

      setImportStatus(`备份已导出，包含 ${result.packedMaterials} 个课程附件`);
      if (result.missingMaterials.length > 0) {
        setImportWarning(
          `${result.missingMaterials.length} 个资料文件本体缺失，仅保留元数据：` +
            result.missingMaterials.map((m) => `「${m.title}」`).join("、")
        );
      }
      setTimeout(() => {
        setImportStatus(null);
        setImportWarning(null);
      }, 6000);
    } catch {
      pushToast({ type: "error", message: "备份导出失败，请重试" });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const input = e.currentTarget;
    const isZip = file.name.toLowerCase().endsWith(".zip");

    if (isImporting) return;
    setIsImporting(true);

    const finish = () => {
      setIsImporting(false);
      input.value = "";
    };

    if (isZip) {
      // --- 完整备份 ZIP：先纯解析校验，通过后才写入 IndexedDB 与 Zustand ---
      parseFullBackupFile(file)
        .then(async (outcome) => {
          if (!outcome.ok) {
            pushToast({ type: "error", message: outcome.error });
            return;
          }
          const { data, materials, missingMaterials, issues } = outcome.parsed;

          // 完整性校验：fatal 阻止恢复（在写入任何状态之前），warnings 仅提示
          const integrity = classifyIntegrityIssues(issues);
          if (integrity.fatal.length > 0) {
            pushToast({
              type: "error",
              message: "备份数据存在致命问题，已取消恢复：" + integrity.fatal.join("；"),
            });
            return;
          }

          // 恢复 IndexedDB Blob（失败不阻断 metadata 恢复，但必须提示）
          const saveFailures: string[] = [];
          await Promise.all(
            Array.from(materials.entries()).map(async ([storageKey, blob]) => {
              try {
                await saveFileBlob(storageKey, blob);
              } catch {
                saveFailures.push(storageKey);
              }
            })
          );

          // 校验完成且 Blob 已准备 → 原子替换业务数据
          restoreAppData(data);

          const warnings: string[] = [...integrity.warnings];
          for (const m of missingMaterials) {
            warnings.push(`「${m.title}」文件本体缺失，仅恢复元数据`);
          }
          for (const key of saveFailures) {
            warnings.push(`「${key}」写入本地存储失败`);
          }

          setImportStatus(
            `备份已恢复：${data.courses.length} 门课程、${data.schedules.length} 个上课时段、${data.assignments.length} 项任务，附件 ${materials.size} 个`
          );
          if (warnings.length > 0) {
            setImportWarning(warnings.join("；"));
          }
          setTimeout(() => {
            setImportStatus(null);
            setImportWarning(null);
          }, 7000);
        })
        .catch(() => {
          pushToast({ type: "error", message: "无法读取备份文件，请确认文件未损坏" });
        })
        .finally(finish);
      return;
    }

    // --- 旧版 / 仅数据 JSON 备份 ---
    const reader = new FileReader();
    reader.onload = (evt) => {
      const result = parseBackupJSON(evt.target?.result as string);

      if (!result.ok) {
        // 校验失败：保持当前数据不变，仅提示错误
        pushToast({ type: "error", message: result.error });
        finish();
        return;
      }

      // 完整性校验：fatal 阻止恢复（写入任何状态之前），warnings 仅提示
      const integrity = classifyIntegrityIssues(findDataIntegrityIssues(result.data));
      if (integrity.fatal.length > 0) {
        pushToast({
          type: "error",
          message: "备份数据存在致命问题，已取消恢复：" + integrity.fatal.join("；"),
        });
        finish();
        return;
      }

      // 原子恢复：整体替换现有业务数据，而非追加
      restoreAppData(result.data);

      setImportStatus(
        `备份已恢复：${result.data.courses.length} 门课程、${result.data.schedules.length} 个上课时段、${result.data.assignments.length} 项任务`
      );
      const warnings = [...integrity.warnings];
      if (hasMaterialStorageKeys(result.data.courses)) {
        warnings.push("该备份不含课程附件，相关文件可能需要重新上传");
      }
      if (warnings.length > 0) {
        setImportWarning(warnings.join("；"));
      }
      setTimeout(() => {
        setImportStatus(null);
        setImportWarning(null);
      }, 6000);
      finish();
    };
    reader.readAsText(file);
  };

  const handleResetData = () => {
    confirmRequest({
      title: "重置所有数据？",
      description: "课程、任务、日历与本地资料都会恢复为演示数据，现有修改会丢失。",
      confirmLabel: "重置数据",
      danger: true,
      onConfirm: () => {
        resetAllDataToDefault();
        // 保持 SPA 连续体验：同步资料健康检查，无需整页刷新
        checkMaterialAvailability(useAppStore.getState().courses)
          .then((health) => setMaterialHealth(health))
          .catch(() => {});
        pushToast({ message: "已重置为演示数据" });
      },
    });
  };

  return (
    <SettingsSection
      title="数据与存储"
      description="本地数据备份、恢复与健康检查。所有数据保存在浏览器本地。"
    >
      <div className="space-y-3" data-testid="settings-data">
        {/* Feedback Alerts */}
        {importStatus && (
          <div className="p-3 bg-pastel-mint border border-pastel-mint rounded-xl flex items-center space-x-2 text-success font-bold text-xs animate-in fade-in">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>{importStatus}</span>
          </div>
        )}

        {importWarning && (
          <div className="p-3 bg-warning-bg border border-warning-border rounded-xl flex items-start space-x-2 text-warning font-bold text-xs animate-in fade-in">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{importWarning}</span>
          </div>
        )}

        {/* 课程资料可用性状态 */}
        <div className="p-3 bg-[#F7F5F5] border border-line rounded-xl space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-charcoal">课程资料本地状态</span>
            <button
              onClick={handleRefreshMaterialHealth}
              disabled={isCheckingMaterials}
              className="p-1 text-sandrift hover:bg-alba rounded-lg transition-colors disabled:opacity-50"
              title="重新检测"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isCheckingMaterials ? "animate-spin" : ""}`} />
            </button>
          </div>
          {materialHealth ? (
            <p className="text-[10px] text-satin-grey">
              课程资料：{materialHealth.total} 个 · 本地文件正常：{materialHealth.available} 个
              {materialHealth.missing.length > 0 && (
                <span className="text-danger font-bold">
                  {" "}· 缺失：{materialHealth.missing.length} 个
                </span>
              )}
            </p>
          ) : (
            <p className="text-[10px] text-sandrift">检测中…</p>
          )}
        </div>

        {/* 1. 导出完整备份 ZIP（含课程附件） */}
        <button
          onClick={handleExportFullBackup}
          disabled={isExporting || isImporting}
          className="flex items-center justify-between w-full p-3 bg-charcoal hover:bg-black text-white font-bold rounded-xl transition-colors disabled:opacity-60"
        >
          <div className="flex items-center space-x-2">
            {isExporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Archive className="w-4 h-4" />
            )}
            <span>{isExporting ? "正在导出…" : "导出备份 ZIP"}</span>
          </div>
          <span className="text-[10px] opacity-80 font-normal">含附件</span>
        </button>

        {/* 2. 导出仅数据 JSON（不含附件） */}
        <button
          onClick={handleExportDataJSON}
          disabled={isExporting || isImporting}
          className="flex items-center justify-between w-full p-3 bg-[#F7F5F5] hover:bg-alabaster border border-line text-charcoal font-bold rounded-xl transition-colors disabled:opacity-60"
        >
          <div className="flex items-center space-x-2">
            <Download className="w-4 h-4 text-[#A48F82]" />
            <span>导出数据 JSON</span>
          </div>
          <span className="text-[10px] text-sandrift font-normal">仅数据</span>
        </button>

        {/* 3. 导入备份（支持 .zip / .json） */}
        <input
          type="file"
          accept=".zip,.json"
          onChange={handleImportBackup}
          className="hidden"
          id="backup-import-input"
        />
        <label
          htmlFor="backup-import-input"
          className={`flex items-center justify-between w-full p-3 border text-charcoal font-bold rounded-xl cursor-pointer transition-colors ${
            isImporting
              ? "bg-pastel-mint border-pastel-mint cursor-not-allowed"
              : "bg-[#F7F5F5] hover:bg-alabaster border-line"
          }`}
        >
          <div className="flex items-center space-x-2">
            {isImporting ? (
              <Loader2 className="w-4 h-4 animate-spin text-sandrift" />
            ) : (
              <Upload className="w-4 h-4 text-[#A48F82]" />
            )}
            <span>{isImporting ? "正在导入…" : "导入备份"}</span>
          </div>
          <span className="text-[10px] text-sandrift font-normal">支持 .zip / .json</span>
        </label>

        {/* 4. 重置演示数据 */}
        <button
          onClick={handleResetData}
          className="flex items-center justify-between w-full p-3 bg-danger-bg hover:bg-danger-border border border-danger-border text-danger font-bold rounded-xl transition-colors"
        >
          <div className="flex items-center space-x-2">
            <RotateCcw className="w-4 h-4" />
            <span>重置演示数据</span>
          </div>
          <span className="text-[10px] font-normal opacity-80">重置</span>
        </button>
      </div>
    </SettingsSection>
  );
}
