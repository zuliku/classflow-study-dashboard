"use client";

import React, { useRef, useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsSaveBar } from "@/components/settings/SettingsSaveBar";
import { SettingsInput } from "@/components/settings/SettingsControls";
import { useProfileAvatar } from "@/hooks/useProfileAvatar";
import {
  AVATAR_STORAGE_KEY,
  validateAvatarFile,
  validateAvatarDecodable,
  processAvatarFile,
  saveAvatarBlob,
  deleteAvatarBlob,
} from "@/lib/profileAvatar";

export function ProfileSettings({
  onDirtyChange,
  discardToken,
}: {
  /** 脏状态上报（Modal 关闭确认用） */
  onDirtyChange?: (dirty: boolean) => void;
  /** Modal 确认放弃草稿时递增：丢弃本地草稿 */
  discardToken?: number;
}) {
  const userProfile = useAppStore((s) => s.userProfile);
  const updateUserProfile = useAppStore((s) => s.updateUserProfile);
  const pushToast = useToastStore((s) => s.pushToast);

  const [name, setName] = useState(userProfile.name);
  const [studentId, setStudentId] = useState(userProfile.studentId);
  const [college, setCollege] = useState(userProfile.college);
  const [grade, setGrade] = useState(userProfile.grade);
  const [completedCredits, setCompletedCredits] = useState(userProfile.completedCredits);
  const [totalCredits, setTotalCredits] = useState(userProfile.totalCredits);

  // ---- 头像：本地文件选择 + 降采样 + IndexedDB 持久化 ----
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string>("");
  const [removeRequested, setRemoveRequested] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const persistedAvatarUrl = useProfileAvatar();

  const dirty =
    name !== userProfile.name ||
    studentId !== userProfile.studentId ||
    college !== userProfile.college ||
    grade !== userProfile.grade ||
    completedCredits !== userProfile.completedCredits ||
    totalCredits !== userProfile.totalCredits ||
    pickedFile !== null ||
    removeRequested;

  // 脏状态上报（V4.1：Modal 据此决定是否要求显式放弃确认）
  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // Modal 确认放弃草稿：重置本地草稿（含头像预览 URL 回收）
  React.useEffect(() => {
    if (discardToken && discardToken > 0) discard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discardToken]);

  const displayAvatarUrl = avatarPreview || (removeRequested ? "" : persistedAvatarUrl);
  const hasAvatar = displayAvatarUrl.length > 0;

  const handlePickFile = async (file: File | null) => {
    setAvatarError("");
    if (!file) return;
    const validation = validateAvatarFile(file);
    if (!validation.ok) {
      setAvatarError(
        validation.reason === "type" ? "请选择图片文件（JPG、PNG、WebP 等）。" : "图片不能超过 5 MB。"
      );
      return;
    }
    // 权威校验：伪装成 image/* 的无效字节在解码层被拒绝（预览前即可反馈）
    const decodable = await validateAvatarDecodable(file);
    if (!decodable) {
      setAvatarError("无法识别该图片文件，请选择有效的 JPG、PNG 或 WebP 图片。");
      return;
    }
    // 替换选择时回收上一个预览 URL，避免会话内 Object URL 泄漏
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    // 预览用会话级 object URL；持久化在保存时写入 IndexedDB（不持久化 blob: URL）
    const url = URL.createObjectURL(file);
    setPickedFile(file);
    setAvatarPreview(url);
    setRemoveRequested(false);
  };

  const clearAvatarDrafts = () => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarPreview("");
    setPickedFile(null);
    setRemoveRequested(false);
    setAvatarError("");
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setAvatarError("");
    try {
      if (pickedFile) {
        const blob = await processAvatarFile(pickedFile);
        await saveAvatarBlob(blob);
        updateUserProfile({
          name,
          avatarStorageKey: AVATAR_STORAGE_KEY,
          avatarUrl: "",
          college,
          grade,
          studentId,
          completedCredits: Number(completedCredits) || 0,
          totalCredits: Number(totalCredits) || 0,
        });
      } else if (removeRequested) {
        // 移除头像：清理本地 Blob（失败不阻塞资料保存，但提示）
        try {
          await deleteAvatarBlob();
        } catch {
          pushToast({ message: "头像已移除，但本地缓存清理失败。", type: "error" });
        }
        updateUserProfile({
          name,
          avatarStorageKey: undefined,
          avatarUrl: "",
          college,
          grade,
          studentId,
          completedCredits: Number(completedCredits) || 0,
          totalCredits: Number(totalCredits) || 0,
        });
      } else {
        updateUserProfile({
          name,
          college,
          grade,
          studentId,
          completedCredits: Number(completedCredits) || 0,
          totalCredits: Number(totalCredits) || 0,
        });
      }
      clearAvatarDrafts();
      pushToast({ message: "设置已保存" });
    } catch {
      pushToast({ message: "头像保存失败，请重试。", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setName(userProfile.name);
    setStudentId(userProfile.studentId);
    setCollege(userProfile.college);
    setGrade(userProfile.grade);
    setCompletedCredits(userProfile.completedCredits);
    setTotalCredits(userProfile.totalCredits);
    clearAvatarDrafts();
  };

  const creditPercent =
    totalCredits > 0 ? Math.min(Math.round((completedCredits / totalCredits) * 100), 100) : 0;

  return (
    <div className="space-y-6" data-testid="settings-profile">
      <SettingsSection title="基本资料" description="你的身份信息，用于学习卡片与课表展示。">
        <div className="space-y-4 text-xs">
          {/* 头像：本地图片选择（无 URL 输入） */}
          <div className="flex items-center gap-4" data-setting-id="profile-avatar">
            {hasAvatar ? (
              <img
                src={displayAvatarUrl}
                alt={name || "用户"}
                className="w-14 h-14 rounded-full object-cover border border-line-strong shrink-0"
              />
            ) : (
              <span className="w-14 h-14 rounded-full bg-pastel-mint border border-line-strong flex items-center justify-center text-lg font-bold text-charcoal shrink-0">
                {name ? name.slice(0, 1) : "用"}
              </span>
            )}
            <div className="flex-1 min-w-0 space-y-1.5">
              <p className="font-bold text-charcoal">头像</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-2.5 py-1.5 bg-white border border-line text-charcoal text-[11px] font-bold rounded-xl transition-colors hover:bg-alabaster"
                >
                  更换头像
                </button>
                {(pickedFile || removeRequested || (userProfile.avatarStorageKey !== undefined) || userProfile.avatarUrl) && (
                  <button
                    onClick={() => {
                      clearAvatarDrafts();
                      setRemoveRequested(true);
                    }}
                    disabled={saving}
                    className="text-[11px] font-semibold text-sandrift hover:text-danger transition-colors disabled:opacity-50"
                  >
                    移除头像
                  </button>
                )}
              </div>
              {avatarError && <p className="text-[10px] font-bold text-danger">{avatarError}</p>}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              data-testid="profile-avatar-input"
              aria-label="选择头像图片"
              onChange={(e) => {
                void handlePickFile(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
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

          <p className="text-[10px] text-sandrift leading-relaxed">
            这些资料保存在当前设备，用于 ClassFlow 内的学习信息展示。
          </p>
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

      <SettingsSaveBar dirty={dirty} onSave={() => void save()} onDiscard={discard} saving={saving} />
    </div>
  );
}
