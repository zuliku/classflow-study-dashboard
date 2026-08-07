"use client";

import React, { useState } from "react";
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
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";

export function SettingsView() {
  const {
    userProfile,
    updateUserProfile,
    resetAllDataToDefault,
    courses,
    schedules,
    assignments,
    calendarMarks,
    groupProjects,
    semester,
    setSemester,
    importSchedules,
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

  const handleExportData = () => {
    const backupData = {
      exportTime: new Date().toISOString(),
      userProfile,
      semester,
      courses,
      schedules,
      assignments,
      calendarMarks,
      groupProjects,
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `classflow_backup_${new Date().toISOString().split("T")[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImportBackupJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const raw = JSON.parse(evt.target?.result as string);
        if (raw.courses && raw.schedules) {
          importSchedules(raw.courses, raw.schedules);
          if (raw.userProfile) updateUserProfile(raw.userProfile);
          if (raw.semester && raw.semester.startDate && raw.semester.totalWeeks) {
            setSemester(raw.semester);
          }
          setImportStatus(`成功从备份中恢复 ${raw.courses.length} 门课程与数据！`);
          setTimeout(() => setImportStatus(null), 3000);
        } else {
          alert("无效的备份文件格式：未读取到课程与排课数据");
        }
      } catch {
        alert("导入失败：备份 JSON 语法有误");
      }
    };
    reader.readAsText(file);
  };

  const handleResetData = () => {
    if (confirm("确定要重置所有数据恢复演示数据吗？现有的修改将被覆盖。")) {
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
          <span>个人资料与学业配置保存成功！</span>
        </div>
      )}

      {importStatus && (
        <div className="p-3 bg-[#E3E6E0] border border-[#D0D5CC] rounded-xl flex items-center space-x-2 text-[#4A7C59] font-bold text-xs animate-in fade-in">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{importStatus}</span>
        </div>
      )}

      {/* Responsive 2-Column Grid filling entire width without right whitespace */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        {/* Left Column (2/3 Width) */}
        <div className="lg:col-span-2 space-y-5">
          {/* Card 1: 个人学业信息设置 */}
          <form
            onSubmit={handleSaveProfile}
            className="bg-white border border-[#E7E3DD] rounded-2xl p-6 shadow-subtle space-y-4"
          >
            <h3 className="text-sm font-bold text-charcoal flex items-center gap-2 pb-2 border-b border-[#F0EBE1]">
              <User className="w-4 h-4 text-[#A48F82]" />
              个人学业信息设置
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
              学期信息与校历配置
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
              {/* 1. 导出本地数据 JSON */}
              <button
                onClick={handleExportData}
                className="flex items-center justify-between w-full p-3 bg-[#F7F5F5] hover:bg-[#F0EBE1] border border-[#E7E3DD] text-charcoal font-bold rounded-xl transition-colors"
              >
                <div className="flex items-center space-x-2">
                  <Download className="w-4 h-4 text-[#A48F82]" />
                  <span>导出本地数据 JSON</span>
                </div>
                <span className="text-[10px] text-[#8C827A] font-normal">备份 ↗</span>
              </button>

              {/* 2. 导入备份 JSON */}
              <input
                type="file"
                accept=".json"
                onChange={handleImportBackupJSON}
                className="hidden"
                id="json-backup-import-input"
              />
              <label
                htmlFor="json-backup-import-input"
                className="flex items-center justify-between w-full p-3 bg-[#F7F5F5] hover:bg-[#F0EBE1] border border-[#E7E3DD] text-charcoal font-bold rounded-xl cursor-pointer transition-colors"
              >
                <div className="flex items-center space-x-2">
                  <Upload className="w-4 h-4 text-[#A48F82]" />
                  <span>导入备份 JSON</span>
                </div>
                <span className="text-[10px] text-[#8C827A] font-normal">恢复 ↗</span>
              </label>

              {/* 3. 重置演示数据 */}
              <button
                onClick={handleResetData}
                className="flex items-center justify-between w-full p-3 bg-[#FDF0F0] hover:bg-[#F8D7D7] border border-[#F8D7D7] text-[#D94F4F] font-bold rounded-xl transition-colors"
              >
                <div className="flex items-center space-x-2">
                  <RotateCcw className="w-4 h-4" />
                  <span>重置演示数据</span>
                </div>
                <span className="text-[10px] font-normal opacity-80">重置 ↗</span>
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
              大学生课表与作业 DDL 学习管理系统 · 纯前端离线优先构建。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
