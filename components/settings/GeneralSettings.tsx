"use client";

import React from "react";
import { useAppStore } from "@/store/useAppStore";
import { useUIChromeStore } from "@/store/useUIChromeStore";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { SettingsRow } from "@/components/settings/SettingsRow";
import {
  SettingsSegmentedControl,
  SettingsSelect,
  SettingsToggle,
} from "@/components/settings/SettingsControls";
import {
  STARTUP_VIEWS,
  MOTION_PREFERENCES,
  CONTENT_DENSITIES,
  getModifiedPreferenceKeys,
  resetPreferencePatch,
} from "@/lib/preferences";
import { CoursePaletteEditor } from "@/components/settings/CoursePaletteEditor";
import { SettingsSlider } from "@/components/settings/SettingsSlider";
import { UI_FONT_LABELS } from "@/lib/typography/fonts";
import { SINGLE_KEY_SHORTCUTS } from "@/lib/shortcuts";
import type { StartupView, ContentDensity, UIFontPreset } from "@/types";

const STARTUP_VIEW_LABELS: Record<StartupView, string> = {
  overview: "总览",
  timetable: "课表",
  assignments: "任务",
  last: "上次使用的位置",
};

/**
 * V5A4：只读快捷键说明（静态真值展示，不可修改按键）。
 * 按键字符派生自 lib/shortcuts.ts；X = 选择/取消选择（绝非删除），Space = 预览任务（桌面端）。
 */
const SHORTCUT_OVERVIEW_ROWS: { keys: string; label: string }[] = [
  { keys: SINGLE_KEY_SHORTCUTS.quickCreateTask, label: "快速新建任务" },
  { keys: SINGLE_KEY_SHORTCUTS.openSearch, label: "打开搜索" },
  {
    keys: `${SINGLE_KEY_SHORTCUTS.assignmentMoveDown} / ${SINGLE_KEY_SHORTCUTS.assignmentMoveUp}`,
    label: "任务列表上下移动",
  },
  { keys: SINGLE_KEY_SHORTCUTS.assignmentToggleSelection, label: "选择 / 取消选择任务" },
  { keys: "Space", label: "预览任务（桌面端）" },
  { keys: SINGLE_KEY_SHORTCUTS.openHelp, label: "快捷键帮助" },
];

/**
 * 通用（Settings V4）：启动 / 界面 / 操作与快捷键 三组。
 * 原「交互与快捷键」的直接操作与单键快捷键偏好已并入「操作与快捷键」组。
 */
export function GeneralSettings({ highlightedId }: { highlightedId?: string }) {
  const preferences = useAppStore((s) => s.preferences);
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const sidebarCollapsed = useUIChromeStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useUIChromeStore((s) => s.setSidebarCollapsed);
  const modified = new Set(getModifiedPreferenceKeys(preferences));

  return (
    <div className="space-y-6" data-testid="settings-general">
      <SettingsSection
        title="通用"
        description="启动位置、界面表现与直接操作偏好。"
      >
        {/* 1. 启动 */}
        <SettingsGroup title="启动">
          <SettingsRow
            settingId="startup-view"
            title="默认打开位置"
            description="下次打开 ClassFlow 时进入的位置。"
            modified={modified.has("startupView")}
            onReset={() => updatePreferences(resetPreferencePatch("startupView"))}
            resetAriaLabel="将默认打开位置恢复默认"
            highlighted={highlightedId === "startup-view"}
          >
            <SettingsSegmentedControl<StartupView>
              value={preferences.startupView}
              onChange={(v) => updatePreferences({ startupView: v })}
              options={STARTUP_VIEWS.map((v) => ({ value: v, label: STARTUP_VIEW_LABELS[v] }))}
              ariaLabel="默认打开位置"
            />
          </SettingsRow>
        </SettingsGroup>

        {/* 2. 界面 */}
        <SettingsGroup title="界面">
          <SettingsRow
            settingId="content-density"
            title="界面密度"
            description="任务工作区、课程列表与命令中心的行高与间距。"
            modified={modified.has("contentDensity")}
            onReset={() => updatePreferences(resetPreferencePatch("contentDensity"))}
            resetAriaLabel="将界面密度恢复默认"
            highlighted={highlightedId === "content-density"}
          >
            <SettingsSegmentedControl<ContentDensity>
              value={preferences.contentDensity}
              onChange={(v) => updatePreferences({ contentDensity: v })}
              ariaLabel="界面密度"
              options={CONTENT_DENSITIES.map((d) => ({
                value: d,
                label: d === "comfortable" ? "舒适" : "紧凑",
              }))}
            />
          </SettingsRow>

          <SettingsRow
            settingId="motion-preference"
            title="动效偏好"
            description="界面动画强度；跟随系统时尊重系统减弱动效设置。"
            modified={modified.has("motionPreference")}
            onReset={() => updatePreferences(resetPreferencePatch("motionPreference"))}
            resetAriaLabel="将动效偏好恢复默认"
            highlighted={highlightedId === "motion-preference"}
          >
            <SettingsSelect
              value={preferences.motionPreference}
              onChange={(v) =>
                updatePreferences({ motionPreference: v as "system" | "full" | "reduced" })
              }
              ariaLabel="动效偏好"
              options={MOTION_PREFERENCES.map((m) => ({
                value: m,
                label: m === "system" ? "跟随系统" : m === "full" ? "完整动效" : "减少动效",
              }))}
            />
          </SettingsRow>

          <SettingsRow
            settingId="ui-font"
            title="界面字体"
            description="调整 ClassFlow 的界面字体，不影响代码、终端与数学公式。"
            modified={modified.has("uiFont")}
            onReset={() => updatePreferences(resetPreferencePatch("uiFont"))}
            resetAriaLabel="将界面字体恢复默认"
            highlighted={highlightedId === "ui-font"}
          >
            <SettingsSelect<UIFontPreset>
              value={preferences.uiFont}
              onChange={(v) => updatePreferences({ uiFont: v })}
              ariaLabel="界面字体"
              options={(
                [
                  "harmonyos-sans-sc",
                  "source-han-sans-sc",
                  "misan",
                ] as const
              ).map((v) => ({
                value: v,
                label: UI_FONT_LABELS[v],
              }))}
            />
          </SettingsRow>

          <SettingsRow
            settingId="ui-font-scale"
            title="界面字号缩放"
            description="整体界面字号缩放，90% - 120%。"
            modified={modified.has("uiFontScale")}
            onReset={() => updatePreferences(resetPreferencePatch("uiFontScale"))}
            resetAriaLabel="将界面字号缩放恢复默认"
            highlighted={highlightedId === "ui-font-scale"}
          >
            <SettingsSlider
              value={preferences.uiFontScale}
              min={0.9}
              max={1.2}
              step={0.05}
              onChange={(v) => updatePreferences({ uiFontScale: v })}
              ariaLabel="界面字号缩放"
              formatValue={(v) => `${Math.round(v * 100)}%`}
            />
          </SettingsRow>

          <SettingsRow
            settingId="sidebar-default-collapsed"
            title="侧栏收起状态"
            description="切换侧栏展开或收起，并在下次打开时保持当前状态。"
            modified={sidebarCollapsed}
            onReset={() => setSidebarCollapsed(false)}
            resetAriaLabel="将侧栏收起状态恢复默认"
            highlighted={highlightedId === "sidebar-default-collapsed"}
          >
            <SettingsToggle
              checked={sidebarCollapsed}
              onChange={setSidebarCollapsed}
              label="侧栏收起状态"
            />
          </SettingsRow>

          <SettingsRow
            settingId="course-auto-palette"
            title="课程自动配色"
            description="新建课程时自动从调色板轮换柔和配色，关闭则使用默认灰色。"
            modified={modified.has("courseAutoPalette")}
            onReset={() => updatePreferences(resetPreferencePatch("courseAutoPalette"))}
            resetAriaLabel="将课程自动配色恢复默认"
            highlighted={highlightedId === "course-auto-palette"}
          >
            <SettingsToggle
              checked={preferences.courseAutoPalette}
              onChange={(v) => updatePreferences({ courseAutoPalette: v })}
              label="课程自动配色"
            />
          </SettingsRow>

          <SettingsRow
            settingId="course-palette"
            title="课程调色板"
            description="自定义课程自动配色的候选颜色（点击色块右上 × 可移除）。新课程按此顺序轮换。"
            modified={modified.has("coursePalette")}
            onReset={() => updatePreferences(resetPreferencePatch("coursePalette"))}
            resetAriaLabel="将课程调色板恢复默认"
            highlighted={highlightedId === "course-palette"}
          >
            <CoursePaletteEditor
              value={preferences.coursePalette}
              onChange={(coursePalette) => updatePreferences({ coursePalette })}
            />
          </SettingsRow>
        </SettingsGroup>

        {/* 3. 操作与快捷键（原「交互与快捷键」） */}
        <SettingsGroup title="操作与快捷键">
          <SettingsRow
            settingId="schedule-direct-manipulation"
            title="课表直接操作"
            description="在时间表中启用课程、学习计划与待安排任务的直接操作。"
            modified={modified.has("enableScheduleDirectManipulation")}
            onReset={() =>
              updatePreferences(resetPreferencePatch("enableScheduleDirectManipulation"))
            }
            resetAriaLabel="将课表直接操作恢复默认"
            highlighted={highlightedId === "schedule-direct-manipulation"}
          >
            <SettingsToggle
              checked={preferences.enableScheduleDirectManipulation}
              onChange={(v) => updatePreferences({ enableScheduleDirectManipulation: v })}
              label="课表直接操作"
            />
          </SettingsRow>

          <SettingsRow
            settingId="ddl-direct-manipulation"
            title="DDL 直接操作"
            description="在日历中启用拖动调整截止日期。"
            modified={modified.has("enableDDLDirectManipulation")}
            onReset={() => updatePreferences(resetPreferencePatch("enableDDLDirectManipulation"))}
            resetAriaLabel="将 DDL 直接操作恢复默认"
            highlighted={highlightedId === "ddl-direct-manipulation"}
          >
            <SettingsToggle
              checked={preferences.enableDDLDirectManipulation}
              onChange={(v) => updatePreferences({ enableDDLDirectManipulation: v })}
              label="DDL 直接操作"
            />
          </SettingsRow>

          <SettingsRow
            settingId="single-key-shortcuts"
            title="启用单键快捷键"
            description="在未编辑文本时启用 N、J/K、X 等快速操作；标准键盘操作（方向键、Enter、Tab 与 Cmd/Ctrl 组合）始终可用。"
            modified={modified.has("enableSingleKeyShortcuts")}
            onReset={() => updatePreferences(resetPreferencePatch("enableSingleKeyShortcuts"))}
            resetAriaLabel="将单键快捷键恢复默认"
            highlighted={highlightedId === "single-key-shortcuts"}
          >
            <SettingsToggle
              checked={preferences.enableSingleKeyShortcuts}
              onChange={(v) => updatePreferences({ enableSingleKeyShortcuts: v })}
              label="启用单键快捷键"
            />
          </SettingsRow>

          <SettingsRow
            settingId="shortcuts-overview"
            title="快捷键说明"
            description="常用单键与任务列表操作（只读说明，不可修改按键）。"
            highlighted={highlightedId === "shortcuts-overview"}
          >
            <div className="flex flex-wrap gap-1.5 max-w-[260px]">
              {SHORTCUT_OVERVIEW_ROWS.map((row) => (
                <span key={row.keys} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-alabaster border border-line text-[11px] font-mono">
                  <span className="bg-white border border-line rounded px-1.5 py-0.5 font-bold text-charcoal">{row.keys}</span>
                  <span className="font-bold text-sandrift">{row.label}</span>
                </span>
              ))}
            </div>
          </SettingsRow>
        </SettingsGroup>
      </SettingsSection>
    </div>
  );
}
