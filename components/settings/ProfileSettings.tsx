"use client";

import React, { useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsSaveBar } from "@/components/settings/SettingsSaveBar";
import { SettingsInput } from "@/components/settings/SettingsControls";

export function ProfileSettings() {
  const userProfile = useAppStore((s) => s.userProfile);
  const updateUserProfile = useAppStore((s) => s.updateUserProfile);
  const pushToast = useToastStore((s) => s.pushToast);

  const [name, setName] = useState(userProfile.name);
  const [avatarUrl, setAvatarUrl] = useState(userProfile.avatarUrl);
  const [studentId, setStudentId] = useState(userProfile.studentId);
  const [college, setCollege] = useState(userProfile.college);
  const [grade, setGrade] = useState(userProfile.grade);
  const [completedCredits, setCompletedCredits] = useState(userProfile.completedCredits);
  const [totalCredits, setTotalCredits] = useState(userProfile.totalCredits);

  const dirty =
    name !== userProfile.name ||
    avatarUrl !== userProfile.avatarUrl ||
    studentId !== userProfile.studentId ||
    college !== userProfile.college ||
    grade !== userProfile.grade ||
    completedCredits !== userProfile.completedCredits ||
    totalCredits !== userProfile.totalCredits;

  const save = () => {
    updateUserProfile({
      name,
      avatarUrl: avatarUrl.trim(),
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
    setAvatarUrl(userProfile.avatarUrl);
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
          {/* 头像：预览 + URL 修改（无本地文件上传） */}
          <div className="flex items-center gap-3">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={name || "用户"}
                className="w-12 h-12 rounded-full object-cover border border-line-strong shrink-0"
              />
            ) : (
              <span className="w-12 h-12 rounded-full bg-pastel-mint border border-line-strong flex items-center justify-center text-base font-bold text-charcoal shrink-0">
                {name ? name.slice(0, 1) : "用"}
              </span>
            )}
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="font-bold text-charcoal">头像</p>
                {avatarUrl && (
                  <button
                    onClick={() => setAvatarUrl("")}
                    className="text-[10px] font-semibold text-sandrift hover:text-danger transition-colors"
                  >
                    清除头像
                  </button>
                )}
              </div>
              <SettingsInput
                id="settings-profile-avatar-url"
                type="url"
                value={avatarUrl}
                onChange={setAvatarUrl}
                placeholder="头像图片 URL（可留空）"
                ariaLabel="头像地址"
                className="text-[11px]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1" data-setting-id="profile-name">
              <label htmlFor="settings-profile-name" className="font-bold text-sandrift">姓名</label>
              <SettingsInput id="settings-profile-name" value={name} onChange={setName} required />
            </div>
            <div className="space-y-1" data-setting-id="profile-student-id">
              <label htmlFor="settings-profile-student-id" className="font-bold text-sandrift">学号</label>
              <SettingsInput id="settings-profile-student-id" value={studentId} onChange={setStudentId} mono required />
            </div>
            <div className="space-y-1" data-setting-id="profile-college">
              <label htmlFor="settings-profile-college" className="font-bold text-sandrift">学院 / 专业</label>
              <SettingsInput id="settings-profile-college" value={college} onChange={setCollege} required />
            </div>
            <div className="space-y-1" data-setting-id="profile-grade">
              <label htmlFor="settings-profile-grade" className="font-bold text-sandrift">年级</label>
              <SettingsInput id="settings-profile-grade" value={grade} onChange={setGrade} required />
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="学业信息" description="用于总览与侧栏的学分进度展示。">
        <div className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1" data-setting-id="profile-credits">
              <label htmlFor="settings-profile-credits-completed" className="font-bold text-sandrift">已完成学分</label>
              <SettingsInput
                id="settings-profile-credits-completed"
                type="number"
                min={0}
                value={completedCredits}
                onChange={(v) => setCompletedCredits(Number(v))}
                className="font-bold"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="settings-profile-credits-total" className="font-bold text-sandrift">目标 / 总学分</label>
              <SettingsInput
                id="settings-profile-credits-total"
                type="number"
                min={0}
                value={totalCredits}
                onChange={(v) => setTotalCredits(Number(v))}
                className="font-bold"
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
