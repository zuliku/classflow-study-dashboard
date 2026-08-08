"use client";

import React from "react";
import { CheckCircle2, Circle, Plus, FileUp } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import type { SettingsSection } from "@/types";
import { SettingsSection as SettingsSectionUI } from "@/components/settings/SettingsSection";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsSegmentedControl } from "@/components/settings/SettingsControls";
import { STARTUP_VIEWS, getModifiedPreferenceKeys, resetPreferencePatch } from "@/lib/preferences";
import type { StartupView } from "@/types";

const STARTUP_VIEW_LABELS: Record<StartupView, string> = {
  overview: "总览",
  timetable: "课表",
  assignments: "任务",
  last: "上次使用的位置",
};

/**
 * General：学习工作区状态（derived checklist，不新增 persisted state）
 * + 默认打开位置 + 常用入口。不是「乱放所有设置」。
 */
export function GeneralSettings({
  onNavigate,
}: {
  onNavigate: (section: SettingsSection) => void;
}) {
  const { courses, schedules, semester, preferences, setAddCourseModalOpen, setImportScheduleModalOpen, updatePreferences } =
    useAppStore();
  const modifiedCount = getModifiedPreferenceKeys(preferences).length;

  const checks = [
    {
      done: true,
      label: "当前学期已设置",
      detail: `${semester.name} · ${semester.totalWeeks} 个教学周`,
    },
    {
      done: courses.length > 0,
      label: courses.length > 0 ? `${courses.length} 门课程` : "尚未添加课程",
      detail: schedules.length > 0 ? `${schedules.length} 个排课时段` : "暂无排课",
    },
    {
      done: true,
      label: `默认截止时间 ${preferences.defaultDDLTime}`,
      detail: "新建任务时预填",
    },
    {
      done: preferences.enableSingleKeyShortcuts,
      label: `单键快捷键 · ${preferences.enableSingleKeyShortcuts ? "已开启" : "已关闭"}`,
      detail: preferences.enableSingleKeyShortcuts ? "N 新建任务 / J/K 快速操作" : "可在「交互与快捷键」中开启",
    },
  ];
  const allReady = checks.filter((c) => c.done).length >= 3;

  return (
    <div className="space-y-6" data-testid="settings-general">
      <SettingsSectionUI title="学习工作区" description="当前本地工作区的准备状态。">
        <div className="p-4 bg-[#F7F5F5] border border-line rounded-xl space-y-2.5">
          <p className="text-sm font-bold text-charcoal">
            {allReady ? "工作区运行正常" : "还差 1 步"}
          </p>
          <div className="space-y-1.5">
            {checks.map((c) => (
              <div key={c.label} className="flex items-start gap-2 text-xs">
                {c.done ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />
                ) : (
                  <Circle className="w-3.5 h-3.5 text-sandrift shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <p className={c.done ? "font-semibold text-charcoal" : "font-semibold text-sandrift"}>
                    {c.label}
                  </p>
                  <p className="text-[10px] text-sandrift">{c.detail}</p>
                </div>
              </div>
            ))}
          </div>

          {courses.length === 0 && (
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setAddCourseModalOpen(true)}
                className="ux-press flex items-center gap-1.5 px-3 py-1.5 bg-charcoal text-white text-[11px] font-bold rounded-xl transition-colors hover:bg-black"
              >
                <Plus className="w-3.5 h-3.5" />
                添加课程
              </button>
              <button
                onClick={() => setImportScheduleModalOpen(true)}
                className="ux-press flex items-center gap-1.5 px-3 py-1.5 bg-white border border-line text-charcoal text-[11px] font-bold rounded-xl transition-colors hover:bg-alabaster"
              >
                <FileUp className="w-3.5 h-3.5 text-[#A48F82]" />
                导入课表
              </button>
            </div>
          )}
        </div>
      </SettingsSectionUI>

      <SettingsSectionUI title="默认打开位置" description="应用启动后进入的工作区。">
        <SettingsRow
          settingId="startup-view"
          title="默认打开位置"
          description="下次打开 ClassFlow 时进入的位置。"
          modified={getModifiedPreferenceKeys(preferences).includes("startupView")}
          onReset={() => updatePreferences(resetPreferencePatch("startupView"))}
          resetAriaLabel="将默认打开位置恢复默认"
        >
          <SettingsSegmentedControl<StartupView>
            value={preferences.startupView}
            onChange={(v) => updatePreferences({ startupView: v })}
            options={STARTUP_VIEWS.map((v) => ({ value: v, label: STARTUP_VIEW_LABELS[v] }))}
            ariaLabel="默认打开位置"
          />
        </SettingsRow>
      </SettingsSectionUI>

      <SettingsSectionUI title="常用入口" description="快速前往相关设置与数据区域。">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <button
            onClick={() => onNavigate("semester")}
            className="p-3 bg-[#F7F5F5] border border-line rounded-xl text-left hover:bg-alabaster transition-colors"
          >
            <p className="font-bold text-charcoal">学期与课表</p>
            <p className="text-[10px] text-sandrift mt-0.5">开学日期、教学周数、显示周末</p>
          </button>
          <button
            onClick={() => onNavigate("tasks")}
            className="p-3 bg-[#F7F5F5] border border-line rounded-xl text-left hover:bg-alabaster transition-colors"
          >
            <p className="font-bold text-charcoal">任务偏好</p>
            <p className="text-[10px] text-sandrift mt-0.5">临近截止提醒、默认截止时间</p>
          </button>
          <button
            onClick={() => onNavigate("interaction")}
            className="p-3 bg-[#F7F5F5] border border-line rounded-xl text-left hover:bg-alabaster transition-colors"
          >
            <p className="font-bold text-charcoal">交互与快捷键</p>
            <p className="text-[10px] text-sandrift mt-0.5">课表/DDL 直接操作、动效偏好</p>
          </button>
          <button
            onClick={() => onNavigate("data")}
            className="p-3 bg-[#F7F5F5] border border-line rounded-xl text-left hover:bg-alabaster transition-colors"
          >
            <p className="font-bold text-charcoal">数据与存储</p>
            <p className="text-[10px] text-sandrift mt-0.5">备份、恢复、健康检查</p>
          </button>
        </div>
      </SettingsSectionUI>

      {modifiedCount > 0 && (
        <p className="text-[11px] text-sandrift">
          有 {modifiedCount} 项偏好已被修改，可在顶部「已修改」中查看
        </p>
      )}
    </div>
  );
}
