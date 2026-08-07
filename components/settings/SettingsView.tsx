"use client";

import React, { useState } from "react";
import {
  User,
  Settings,
  Calendar,
  Download,
  RotateCcw,
  CheckCircle,
  Bell,
  Sliders,
  Github,
  ShieldCheck,
  Save,
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
  } = useAppStore();

  const [name, setName] = useState(userProfile.name);
  const [college, setCollege] = useState(userProfile.college);
  const [grade, setGrade] = useState(userProfile.grade);
  const [studentId, setStudentId] = useState(userProfile.studentId);
  const [completedCredits, setCompletedCredits] = useState(userProfile.completedCredits);
  const [totalCredits, setTotalCredits] = useState(userProfile.totalCredits);

  const [savedSuccess, setSavedSuccess] = useState(false);

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

  const handleExportData = () => {
    const backupData = {
      exportTime: new Date().toISOString(),
      userProfile,
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

  const handleResetData = () => {
    if (confirm("确定要重置所有数据恢复初始演示状态吗？现有的修改将被覆盖。")) {
      resetAllDataToDefault();
      window.location.reload();
    }
  };

  return (
    <div className="space-y-6 max-w-4xl pb-10">
      {/* Header Banner */}
      <div className="bg-white border border-[#E7E3DD] rounded-2xl p-5 shadow-subtle flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-charcoal mb-0.5 flex items-center gap-2">
            <Settings className="w-4 h-4 text-[#A48F82]" />
            系统设置
          </h2>
          <p className="text-xs text-[#8C827A]">
            学业账户偏好、课表学期配置与本地数据管理
          </p>
        </div>
        <span className="text-[11px] font-mono font-semibold px-2.5 py-1 bg-[#F0EBE1] border border-[#E0D7C6] rounded-xl text-charcoal">
          ClassFlow v2.4.0
        </span>
      </div>

      {/* Success Alert */}
      {savedSuccess && (
        <div className="p-3 bg-[#E3E6E0] border border-[#D0D5CC] rounded-xl flex items-center space-x-2 text-[#4A7C59] font-bold text-xs animate-in fade-in">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>个人资料与学业配置保存成功！</span>
        </div>
      )}

      {/* Section 1: User Profile Settings Form */}
      <form onSubmit={handleSaveProfile} className="bg-white border border-[#E7E3DD] rounded-2xl p-6 shadow-subtle space-y-4">
        <h3 className="text-sm font-bold text-charcoal flex items-center gap-2 pb-2 border-b border-[#F0EBE1]">
          <User className="w-4 h-4 text-[#A48F82]" />
          个人学业信息设置
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
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

      {/* Section 2: Timetable & Semester Preferences */}
      <div className="bg-white border border-[#E7E3DD] rounded-2xl p-6 shadow-subtle space-y-4">
        <h3 className="text-sm font-bold text-charcoal flex items-center gap-2 pb-2 border-b border-[#F0EBE1]">
          <Sliders className="w-4 h-4 text-[#A48F82]" />
          课表与学期显示偏好
        </h3>

        <div className="space-y-3 text-xs">
          <div className="flex items-center justify-between p-3 bg-[#F7F5F5] rounded-xl border border-[#E7E3DD]">
            <div>
              <h4 className="font-bold text-charcoal">自动显示周末课表</h4>
              <p className="text-[11px] text-[#8C827A]">开启后课表网格将包含周六与周日</p>
            </div>
            <input
              type="checkbox"
              defaultChecked
              className="w-4 h-4 rounded text-charcoal border-[#CDB9AB] focus:ring-0 cursor-pointer"
            />
          </div>

          <div className="flex items-center justify-between p-3 bg-[#F7F5F5] rounded-xl border border-[#E7E3DD]">
            <div>
              <h4 className="font-bold text-charcoal">高亮临近 3 天内 DDL 任务</h4>
              <p className="text-[11px] text-[#8C827A]">在日历与总览卡片中显示红底高亮警示</p>
            </div>
            <input
              type="checkbox"
              defaultChecked
              className="w-4 h-4 rounded text-charcoal border-[#CDB9AB] focus:ring-0 cursor-pointer"
            />
          </div>
        </div>
      </div>

      {/* Section 3: Data Export & Backup */}
      <div className="bg-white border border-[#E7E3DD] rounded-2xl p-6 shadow-subtle space-y-4">
        <h3 className="text-sm font-bold text-charcoal flex items-center gap-2 pb-2 border-b border-[#F0EBE1]">
          <ShieldCheck className="w-4 h-4 text-[#A48F82]" />
          数据管理与安全备份
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {/* Export Backup JSON */}
          <div className="p-4 border border-[#E7E3DD] bg-[#F7F5F5] rounded-xl space-y-2 flex flex-col justify-between">
            <div>
              <h4 className="font-bold text-charcoal">导出完整备份文件</h4>
              <p className="text-[11px] text-[#8C827A] mt-0.5">
                将课程、排课、作业 DDL 及资料导出为 JSON 备份
              </p>
            </div>
            <button
              onClick={handleExportData}
              className="flex items-center justify-center space-x-1.5 w-full py-2 bg-white hover:bg-[#F0EBE1] border border-[#E0D7C6] text-charcoal font-bold rounded-lg transition-colors mt-2"
            >
              <Download className="w-3.5 h-3.5" />
              <span>导出 JSON 备份</span>
            </button>
          </div>

          {/* Reset All Data */}
          <div className="p-4 border border-[#F8D7D7] bg-[#FDF0F0] rounded-xl space-y-2 flex flex-col justify-between">
            <div>
              <h4 className="font-bold text-[#D94F4F]">重置为系统默认数据</h4>
              <p className="text-[11px] text-[#D94F4F]/80 mt-0.5">
                清空当前本地数据并恢复标准演示课表与任务
              </p>
            </div>
            <button
              onClick={handleResetData}
              className="flex items-center justify-center space-x-1.5 w-full py-2 bg-[#D94F4F] hover:bg-[#c44343] text-white font-bold rounded-lg transition-colors mt-2"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>重置默认数据</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
