"use client";

import React, { useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsSaveBar } from "@/components/settings/SettingsSaveBar";

const inputCls =
  "w-full p-2.5 bg-[#F7F5F5] border border-line rounded-xl text-charcoal font-semibold focus:outline-none";

export function ProfileSettings() {
  const userProfile = useAppStore((s) => s.userProfile);
  const updateUserProfile = useAppStore((s) => s.updateUserProfile);
  const pushToast = useToastStore((s) => s.pushToast);

  const [name, setName] = useState(userProfile.name);
  const [studentId, setStudentId] = useState(userProfile.studentId);
  const [college, setCollege] = useState(userProfile.college);
  const [grade, setGrade] = useState(userProfile.grade);
  const [completedCredits, setCompletedCredits] = useState(userProfile.completedCredits);
  const [totalCredits, setTotalCredits] = useState(userProfile.totalCredits);

  const dirty =
    name !== userProfile.name ||
    studentId !== userProfile.studentId ||
    college !== userProfile.college ||
    grade !== userProfile.grade ||
    completedCredits !== userProfile.completedCredits ||
    totalCredits !== userProfile.totalCredits;

  const save = () => {
    updateUserProfile({
      name,
      college,
      grade,
      studentId,
      completedCredits: Number(completedCredits) || 0,
      totalCredits: Number(totalCredits) || 0,
    });
    pushToast({ message: "设置已保存" });
  };

  const discard = () => {
    setName(userProfile.name);
    setStudentId(userProfile.studentId);
    setCollege(userProfile.college);
    setGrade(userProfile.grade);
    setCompletedCredits(userProfile.completedCredits);
    setTotalCredits(userProfile.totalCredits);
  };

  const creditPercent =
    totalCredits > 0 ? Math.min(Math.round((completedCredits / totalCredits) * 100), 100) : 0;

  return (
    <div className="space-y-6" data-testid="settings-profile">
      <SettingsSection title="基本资料" description="你的身份信息，用于学习卡片与课表展示。">
        <div className="space-y-4 text-xs">
          {/* 头像：预览现有值（本任务不实现文件上传） */}
          <div className="flex items-center gap-3">
            <img
              src={userProfile.avatarUrl}
              alt={userProfile.name}
              className="w-12 h-12 rounded-full object-cover border border-line-strong"
            />
            <div>
              <p className="font-bold text-charcoal">头像</p>
              <p className="text-[10px] text-sandrift">使用当前资料中的头像（文件上传将在后续版本提供）</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label htmlFor="settings-profile-name" className="font-bold text-sandrift">姓名</label>
              <input id="settings-profile-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} required />
            </div>
            <div className="space-y-1">
              <label htmlFor="settings-profile-student-id" className="font-bold text-sandrift">学号</label>
              <input id="settings-profile-student-id" type="text" value={studentId} onChange={(e) => setStudentId(e.target.value)} className={`${inputCls} font-mono`} required />
            </div>
            <div className="space-y-1">
              <label htmlFor="settings-profile-college" className="font-bold text-sandrift">学院 / 专业</label>
              <input id="settings-profile-college" type="text" value={college} onChange={(e) => setCollege(e.target.value)} className={inputCls} required />
            </div>
            <div className="space-y-1">
              <label htmlFor="settings-profile-grade" className="font-bold text-sandrift">年级</label>
              <input id="settings-profile-grade" type="text" value={grade} onChange={(e) => setGrade(e.target.value)} className={inputCls} required />
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="学业信息" description="用于总览与侧栏的学分进度展示。">
        <div className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="font-bold text-sandrift">已完成学分</label>
              <input
                type="number"
                min={0}
                value={completedCredits}
                onChange={(e) => setCompletedCredits(Number(e.target.value))}
                className={`${inputCls} font-bold`}
              />
            </div>
            <div className="space-y-1">
              <label className="font-bold text-sandrift">目标 / 总学分</label>
              <input
                type="number"
                min={0}
                value={totalCredits}
                onChange={(e) => setTotalCredits(Number(e.target.value))}
                className={`${inputCls} font-bold`}
              />
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-sandrift">
              <span>学分进度</span>
              <span className="font-bold text-charcoal">
                {completedCredits} / {totalCredits}
              </span>
            </div>
            <div className="w-full bg-alabaster rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-sandrift h-1.5 rounded-full transition-[width] duration-[var(--motion-data)] ease-[var(--ease-emphasized)]"
                style={{ width: `${creditPercent}%` }}
              />
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSaveBar dirty={dirty} onSave={save} onDiscard={discard} />
    </div>
  );
}
