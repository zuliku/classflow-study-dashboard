"use client";

import React, { useState, useEffect } from "react";
import {
  User,
  Settings,
  Calendar,
  Download,
  Upload,
  RotateCcw,
  CheckCircle,
  Sliders,
  ShieldCheck,
  Save,
  BookOpen,
  Info,
  Archive,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { parseBackupJSON, hasMaterialStorageKeys } from "@/lib/backup";
import { ClassFlowBackup, ClassFlowBackupData } from "@/types";
import {
  buildFullBackupZip,
  parseFullBackupFile,
  checkMaterialAvailability,
  MaterialAvailability,
} from "@/lib/backupPackage";
import { saveFileBlob } from "@/lib/fileStorage";

const localDateStr = () => {
  const d = new Date();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

export function SettingsView() {
  const {
    userProfile,
    updateUserProfile,
    resetAllDataToDefault,
    restoreAppData,
    courses,
    schedules,
    assignments,
    calendarMarks,
    groupProjects,
    semester,
    setSemester,
  } = useAppStore();

  // Personal Profile state
  const [name, setName] = useState(userProfile.name);
  const [college, setCollege] = useState(userProfile.college);
  const [grade, setGrade] = useState(userProfile.grade);
  const [studentId, setStudentId] = useState(userProfile.studentId);
  const [completedCredits, setCompletedCredits] = useState(userProfile.completedCredits);
  const [totalCredits, setTotalCredits] = useState(userProfile.totalCredits);

  // Semester Settings state
  const [semesterName, setSemesterName] = useState(semester.name);
  const [semesterStartDate, setSemesterStartDate] = useState(semester.startDate);
  const [totalWeeks, setTotalWeeks] = useState(semester.totalWeeks);

  const [savedSuccess, setSavedSuccess] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importWarning, setImportWarning] = useState<string | null>(null);
  const [materialHealth, setMaterialHealth] = useState<MaterialAvailability | null>(null);
  const [isCheckingMaterials, setIsCheckingMaterials] = useState(false);

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

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    updateUserProfile({
      name,
      college,
      grade,
      studentId,
      completedCredits: Number(completedCredits),
      totalCredits: Number(totalCredits),
    });

    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
  };

  const handleSaveSemester = (e: React.FormEvent) => {
    e.preventDefault();
    setSemester({
      ...semester,
      name: semesterName,
      startDate: semesterStartDate,
      totalWeeks: Number(totalWeeks),
    });

    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2000);
  };

  // 导出仅数据 JSON（不包含课程附件 Blob）
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
      alert("备份导出失败，请重试");
    }
  };

  const syncFormState = (data: ClassFlowBackupData) => {
    setName(data.userProfile.name);
    setCollege(data.userProfile.college);
    setGrade(data.userProfile.grade);
    setStudentId(data.userProfile.studentId);
    setCompletedCredits(data.userProfile.completedCredits);
    setTotalCredits(data.userProfile.totalCredits);
    setSemesterName(data.semester.name);
    setSemesterStartDate(data.semester.startDate);
    setTotalWeeks(data.semester.totalWeeks);
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const input = e.currentTarget;
    const isZip = file.name.toLowerCase().endsWith(".zip");

    const finish = () => {
      input.value = "";
    };

    if (isZip) {
      // --- 完整备份 ZIP：先纯解析校验，通过后才写入 IndexedDB 与 Zustand ---
      parseFullBackupFile(file)
        .then(async (outcome) => {
          if (!outcome.ok) {
            alert(outcome.error);
            return;
          }
          const { data, materials, missingMaterials } = outcome.parsed;

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
          syncFormState(data);

          const warnings: string[] = [];
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
            setImportWarning(`${warnings.length} 个资料存在问题：` + warnings.join("；"));
          }
          setTimeout(() => {
            setImportStatus(null);
            setImportWarning(null);
          }, 7000);
        })
        .catch(() => {
          alert("读取备份文件失败，请确认文件未损坏");
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
        alert(result.error);
        finish();
        return;
      }

      // 原子恢复：整体替换现有业务数据，而非追加
      restoreAppData(result.data);
      syncFormState(result.data);

      setImportStatus(
        `备份已恢复：${result.data.courses.length} 门课程、${result.data.schedules.length} 个上课时段、${result.data.assignments.length} 项任务`
      );
      if (hasMaterialStorageKeys(result.data.courses)) {
        setImportWarning("该备份不含课程附件，相关文件可能需要重新上传");
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
    if (confirm("确定重置所有数据？将恢复为演示数据，现有修改会丢失。")) {
      resetAllDataToDefault();
      window.location.reload();
    }
  };

  return (
    <div className="w-full space-y-5 pb-10">
      {/* Header Banner */}
      <div className="bg-white border border-[#E7E3DD] rounded-2xl p-5 shadow-subtle flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-charcoal mb-0.5 flex items-center gap-2">
            <Settings className="w-4 h-4 text-[#A48F82]" />
            系统设置
          </h2>
          <p className="text-xs text-[#8C827A]">
            学业账户偏好、学期校历配置与本地数据备份管理
          </p>
        </div>
        <span className="text-[11px] font-mono font-semibold px-2.5 py-1 bg-[#F0EBE1] border border-[#E0D7C6] rounded-xl text-charcoal">
          ClassFlow v2.4.0
        </span>
      </div>

      {/* Feedback Alerts */}
      {savedSuccess && (
        <div className="p-3 bg-[#E3E6E0] border border-[#D0D5CC] rounded-xl flex items-center space-x-2 text-[#4A7C59] font-bold text-xs animate-in fade-in">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>设置已保存</span>
        </div>
      )}

      {importStatus && (
        <div className="p-3 bg-[#E3E6E0] border border-[#D0D5CC] rounded-xl flex items-center space-x-2 text-[#4A7C59] font-bold text-xs animate-in fade-in">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{importStatus}</span>
        </div>
      )}

      {importWarning && (
        <div className="p-3 bg-[#FFF6EE] border border-[#FDE6D2] rounded-xl flex items-start space-x-2 text-[#D97706] font-bold text-xs animate-in fade-in">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{importWarning}</span>
        </div>
      )}

      {/* Responsive 2-Column Grid filling entire width without right whitespace */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        {/* Left Column (2/3 Width) */}
        <div className="lg:col-span-2 space-y-5">
          {/* Card 1: 个人信息 */}
          <form
            onSubmit={handleSaveProfile}
            className="bg-white border border-[#E7E3DD] rounded-2xl p-6 shadow-subtle space-y-4"
          >
            <h3 className="text-sm font-bold text-charcoal flex items-center gap-2 pb-2 border-b border-[#F0EBE1]">
              <User className="w-4 h-4 text-[#A48F82]" />
              个人信息
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-[#8C827A]">姓名</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl text-charcoal font-semibold focus:outline-none"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-[#8C827A]">学号</label>
                <input
                  type="text"
                  value={studentId}
                  onChange={(e) => setStudentId(e.target.value)}
                  className="w-full p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl text-charcoal font-mono focus:outline-none"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-[#8C827A]">学院专业</label>
                <input
                  type="text"
                  value={college}
                  onChange={(e) => setCollege(e.target.value)}
                  className="w-full p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl text-charcoal focus:outline-none"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-[#8C827A]">年级</label>
                <input
                  type="text"
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                  className="w-full p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl text-charcoal focus:outline-none"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-[#8C827A]">已修学分</label>
                <input
                  type="number"
                  value={completedCredits}
                  onChange={(e) => setCompletedCredits(Number(e.target.value))}
                  className="w-full p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl text-charcoal font-bold focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-[#8C827A]">本学期总学分</label>
                <input
                  type="number"
                  value={totalCredits}
                  onChange={(e) => setTotalCredits(Number(e.target.value))}
                  className="w-full p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl text-charcoal font-bold focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="flex items-center space-x-1.5 px-4 py-2 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-xl transition-colors shadow-subtle"
              >
                <Save className="w-3.5 h-3.5" />
                <span>保存个人信息</span>
              </button>
            </div>
          </form>

          {/* Card 2: 学期信息设置 */}
          <form
            onSubmit={handleSaveSemester}
            className="bg-white border border-[#E7E3DD] rounded-2xl p-6 shadow-subtle space-y-4"
          >
            <h3 className="text-sm font-bold text-charcoal flex items-center gap-2 pb-2 border-b border-[#F0EBE1]">
              <Calendar className="w-4 h-4 text-[#A48F82]" />
              学期设置
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-[#8C827A]">学期名称</label>
                <input
                  type="text"
                  value={semesterName}
                  onChange={(e) => setSemesterName(e.target.value)}
                  className="w-full p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl text-charcoal font-semibold focus:outline-none"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-[#8C827A]">开学日期</label>
                <input
                  type="date"
                  value={semesterStartDate}
                  onChange={(e) => setSemesterStartDate(e.target.value)}
                  className="w-full p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl text-charcoal font-mono focus:outline-none"
                  required
                />
                <p className="text-[10px] text-[#8C827A]">周一为学期第 1 周起始日</p>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-[#8C827A]">总教学周数</label>
                <select
                  value={totalWeeks}
                  onChange={(e) => setTotalWeeks(Number(e.target.value))}
                  className="w-full p-2.5 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl text-charcoal font-bold focus:outline-none"
                >
                  <option value={16}>16 周 (标准学期)</option>
                  <option value={18}>18 周</option>
                  <option value={20}>20 周</option>
                  <option value={12}>12 周 (短学期)</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="flex items-center space-x-1.5 px-4 py-2 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-xl transition-colors shadow-subtle"
              >
                <Save className="w-3.5 h-3.5" />
                <span>保存学期设置</span>
              </button>
            </div>
          </form>
        </div>

        {/* Right Column (1/3 Width) */}
        <div className="space-y-5">
          {/* Card 3: 数据管理 */}
          <div className="bg-white border border-[#E7E3DD] rounded-2xl p-6 shadow-subtle space-y-4">
            <h3 className="text-sm font-bold text-charcoal flex items-center gap-2 pb-2 border-b border-[#F0EBE1]">
              <ShieldCheck className="w-4 h-4 text-[#A48F82]" />
              数据管理
            </h3>

            <div className="space-y-2.5 text-xs">
              {/* 课程资料可用性状态 */}
              <div className="p-3 bg-[#F7F5F5] border border-[#E7E3DD] rounded-xl space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-charcoal">课程资料本地状态</span>
                  <button
                    onClick={handleRefreshMaterialHealth}
                    disabled={isCheckingMaterials}
                    className="p-1 text-[#8C827A] hover:bg-[#E0D7C6] rounded-lg transition-colors disabled:opacity-50"
                    title="重新检测"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isCheckingMaterials ? "animate-spin" : ""}`} />
                  </button>
                </div>
                {materialHealth ? (
                  <p className="text-[10px] text-[#676268]">
                    课程资料：{materialHealth.total} 个 · 本地文件正常：{materialHealth.available} 个
                    {materialHealth.missing.length > 0 && (
                      <span className="text-[#D94F4F] font-bold">
                        {" "}· 缺失：{materialHealth.missing.length} 个
                      </span>
                    )}
                  </p>
                ) : (
                  <p className="text-[10px] text-[#8C827A]">检测中…</p>
                )}
              </div>

              {/* 1. 导出完整备份 ZIP（含课程附件） */}
              <button
                onClick={handleExportFullBackup}
                className="flex items-center justify-between w-full p-3 bg-charcoal hover:bg-black text-white font-bold rounded-xl transition-colors"
              >
                <div className="flex items-center space-x-2">
                  <Archive className="w-4 h-4" />
                  <span>导出备份 ZIP</span>
                </div>
                <span className="text-[10px] opacity-80 font-normal">含附件</span>
              </button>

              {/* 2. 导出仅数据 JSON（不含附件） */}
              <button
                onClick={handleExportDataJSON}
                className="flex items-center justify-between w-full p-3 bg-[#F7F5F5] hover:bg-[#F0EBE1] border border-[#E7E3DD] text-charcoal font-bold rounded-xl transition-colors"
              >
                <div className="flex items-center space-x-2">
                  <Download className="w-4 h-4 text-[#A48F82]" />
                  <span>导出数据 JSON</span>
                </div>
                <span className="text-[10px] text-[#8C827A] font-normal">仅数据</span>
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
                className="flex items-center justify-between w-full p-3 bg-[#F7F5F5] hover:bg-[#F0EBE1] border border-[#E7E3DD] text-charcoal font-bold rounded-xl cursor-pointer transition-colors"
              >
                <div className="flex items-center space-x-2">
                  <Upload className="w-4 h-4 text-[#A48F82]" />
                  <span>导入备份</span>
                </div>
                <span className="text-[10px] text-[#8C827A] font-normal">支持 .zip / .json</span>
              </label>

              {/* 4. 重置演示数据 */}
              <button
                onClick={handleResetData}
                className="flex items-center justify-between w-full p-3 bg-[#FDF0F0] hover:bg-[#F8D7D7] border border-[#F8D7D7] text-[#D94F4F] font-bold rounded-xl transition-colors"
              >
                <div className="flex items-center space-x-2">
                  <RotateCcw className="w-4 h-4" />
                  <span>重置演示数据</span>
                </div>
                <span className="text-[10px] font-normal opacity-80">重置</span>
              </button>
            </div>
          </div>

          {/* Card 4: 课表与显示偏好 */}
          <div className="bg-white border border-[#E7E3DD] rounded-2xl p-6 shadow-subtle space-y-4">
            <h3 className="text-sm font-bold text-charcoal flex items-center gap-2 pb-2 border-b border-[#F0EBE1]">
              <Sliders className="w-4 h-4 text-[#A48F82]" />
              显示偏好
            </h3>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between p-3 bg-[#F7F5F5] rounded-xl border border-[#E7E3DD]">
                <div>
                  <h4 className="font-bold text-charcoal">显示周末课表</h4>
                  <p className="text-[10px] text-[#8C827A]">包含周六与周日排课</p>
                </div>
                <input
                  type="checkbox"
                  defaultChecked
                  className="w-4 h-4 rounded text-charcoal border-[#CDB9AB] focus:ring-0 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-[#F7F5F5] rounded-xl border border-[#E7E3DD]">
                <div>
                  <h4 className="font-bold text-charcoal">临近 DDL 提醒</h4>
                  <p className="text-[10px] text-[#8C827A]">3 天内作业高亮标红</p>
                </div>
                <input
                  type="checkbox"
                  defaultChecked
                  className="w-4 h-4 rounded text-charcoal border-[#CDB9AB] focus:ring-0 cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Card 5: 关于 */}
          <div className="bg-[#F0EBE1]/60 border border-[#E0D7C6] rounded-2xl p-4 space-y-2 text-xs">
            <div className="flex items-center space-x-2 font-bold text-charcoal">
              <Info className="w-4 h-4 text-[#A48F82]" />
              <span>关于 ClassFlow</span>
            </div>
            <p className="text-[11px] text-[#676268] leading-relaxed">
              课表、任务与 DDL 管理工具，数据保存在本地浏览器。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
