"use client";

import React, { useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useReminderPreferencesStore } from "@/store/useReminderPreferencesStore";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsToggle, SettingsSelect, SettingsSegmentedControl, SettingsInput, SettingsButton } from "@/components/settings/SettingsControls";
import { SettingsSlider } from "@/components/settings/SettingsSlider";
import { DDL_WARNING_DAYS, TASK_PRIORITIES, TASK_STATUSES, DEADLINE_REMINDER_MINUTES, DEADLINE_REMINDER_LABELS, DEFAULT_DEADLINE_REMINDER_MINUTES } from "@/lib/preferences";
import { getModifiedPreferenceKeys, resetPreferencePatch } from "@/lib/preferences";
import { PRIMARY_TASK_WORKSPACE_VIEWS } from "@/lib/tasks/taskViews";
import { MissedReminderPolicy } from "@/types";
import {
  MissedReminderWindowHours,
  getModifiedReminderPreferenceKeys,
  isDoNotDisturbModified,
  type ReminderPreferences,
} from "@/store/useReminderPreferencesStore";
import {
  getBrowserNotificationPermission,
  isBrowserNotificationSupported,
  requestBrowserNotificationPermission,
  describeBrowserNotificationPermission,
} from "@/lib/reminders/browserNotifications";
import { cn } from "@/lib/utils";
import { playReminderSound } from "@/lib/reminders/reminderSound";

const PRIORITY_LABELS: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
};
const STATUS_LABELS: Record<string, string> = {
  todo: "待完成",
  doing: "进行中",
};
const MISSED_POLICY_OPTIONS: { value: MissedReminderPolicy; label: string }[] = [
  { value: "deliver", label: "补发所有未处理提醒" },
  { value: "recent-only", label: "仅补发近期提醒" },
  { value: "skip", label: "跳过错过的提醒" },
];

/** 任务与提醒偏好（任务偏好 immediate save；Reminder 偏好独立 store，同样 immediate save） */
export function TaskSettings({ highlightedId }: { highlightedId?: string }) {
  const preferences = useAppStore((s) => s.preferences);
  const updatePreferences = useAppStore((s) => s.updatePreferences);
  const setDefaultDeadlineReminderMinutes = useAppStore((s) => s.setDefaultDeadlineReminderMinutes);
  const modified = new Set(getModifiedPreferenceKeys(preferences));

  const browserNotificationsEnabled = useReminderPreferencesStore((s) => s.browserNotificationsEnabled);
  const setBrowserNotificationsEnabled = useReminderPreferencesStore((s) => s.setBrowserNotificationsEnabled);
  const missedReminderPolicy = useReminderPreferencesStore((s) => s.missedReminderPolicy);
  const setMissedReminderPolicy = useReminderPreferencesStore((s) => s.setMissedReminderPolicy);
  const missedReminderWindowHours = useReminderPreferencesStore((s) => s.missedReminderWindowHours);
  const setMissedReminderWindowHours = useReminderPreferencesStore((s) => s.setMissedReminderWindowHours);
  const reminderSoundEnabled = useReminderPreferencesStore((s) => s.reminderSoundEnabled);
  const setReminderSoundEnabled = useReminderPreferencesStore((s) => s.setReminderSoundEnabled);
  const reminderSoundVolume = useReminderPreferencesStore((s) => s.reminderSoundVolume);
  const setReminderSoundVolume = useReminderPreferencesStore((s) => s.setReminderSoundVolume);
  const focusAutoDoNotDisturbEnabled = useReminderPreferencesStore((s) => s.focusAutoDoNotDisturbEnabled);
  const setFocusAutoDoNotDisturbEnabled = useReminderPreferencesStore((s) => s.setFocusAutoDoNotDisturbEnabled);
  const doNotDisturbEnabled = useReminderPreferencesStore((s) => s.doNotDisturbEnabled);
  const setDoNotDisturbEnabled = useReminderPreferencesStore((s) => s.setDoNotDisturbEnabled);
  const doNotDisturbStart = useReminderPreferencesStore((s) => s.doNotDisturbStart);
  const setDoNotDisturbStart = useReminderPreferencesStore((s) => s.setDoNotDisturbStart);
  const doNotDisturbEnd = useReminderPreferencesStore((s) => s.doNotDisturbEnd);
  const setDoNotDisturbEnd = useReminderPreferencesStore((s) => s.setDoNotDisturbEnd);
  const resetReminderPreference = useReminderPreferencesStore((s) => s.resetReminderPreference);
  const resetDoNotDisturb = useReminderPreferencesStore((s) => s.resetDoNotDisturb);
  // Reminder preferences modified-state（V5A7：与 canonical defaults 比较，无 magic literals）
  const reminderPrefs: ReminderPreferences = {
    browserNotificationsEnabled,
    missedReminderPolicy,
    missedReminderWindowHours,
    reminderSoundEnabled,
    reminderSoundVolume,
    focusAutoDoNotDisturbEnabled,
    doNotDisturbEnabled,
    doNotDisturbStart,
    doNotDisturbEnd,
  };
  const reminderModified = new Set(getModifiedReminderPreferenceKeys(reminderPrefs));
  // 权限状态直接行内小字展示（不用 Toast）：真实反映 granted / denied / default / unsupported
  const [permissionNote, setPermissionNote] = useState("");
  const permissionState = getBrowserNotificationPermission();
  const permissionLabel = permissionNote || describeBrowserNotificationPermission(permissionState).label;
  const permissionTone =
    permissionNote && !permissionNote.includes("已授权")
      ? "warning"
      : describeBrowserNotificationPermission(permissionState).tone;

  // 只有用户主动打开开关才申请权限；denied 不重复自动请求
  const handleBrowserNotificationToggle = async (checked: boolean) => {
    if (!checked) {
      setBrowserNotificationsEnabled(false);
      setPermissionNote("");
      return;
    }
    if (!isBrowserNotificationSupported()) {
      setBrowserNotificationsEnabled(false);
      setPermissionNote("当前设备不支持系统通知，站内提醒仍可正常使用。");
      return;
    }
    const permission = getBrowserNotificationPermission();
    if (permission === "granted") {
      setBrowserNotificationsEnabled(true);
      setPermissionNote("");
      return;
    }
    if (permission === "denied") {
      setBrowserNotificationsEnabled(false);
      setPermissionNote("系统已阻止通知权限，请在系统设置中修改。");
      return;
    }
    const result = await requestBrowserNotificationPermission();
    if (result === "granted") {
      setBrowserNotificationsEnabled(true);
      setPermissionNote("");
    } else {
      setBrowserNotificationsEnabled(false);
      setPermissionNote(
        result === "denied" ? "系统已阻止通知权限，请在系统设置中修改。" : ""
      );
    }
  };

  return (
    <SettingsSection
      title="任务与提醒"
    >
      <div className="text-xs space-y-4" data-testid="settings-tasks">
        <SettingsGroup title="任务">
        <SettingsRow
          settingId="ddl-warning-days"
          title="临近截止范围"
          description="仅影响总览与课表速览中显示哪些截止任务，不发送通知。"
          modified={modified.has("ddlWarningDays")}
          onReset={() => updatePreferences(resetPreferencePatch("ddlWarningDays"))}
          resetAriaLabel="将临近截止范围恢复默认"
          highlighted={highlightedId === "ddl-warning-days"}
        >
          <SettingsSegmentedControl<number>
            value={preferences.ddlWarningDays}
            onChange={(v) => updatePreferences({ ddlWarningDays: v as 1 | 3 | 7 })}
            ariaLabel="临近截止范围"
            options={DDL_WARNING_DAYS.map((d) => ({ value: d, label: `${d} 天` }))}
          />
        </SettingsRow>

        <SettingsRow
          settingId="default-ddl-time"
          title="默认截止时间"
          modified={modified.has("defaultDDLTime")}
          onReset={() => updatePreferences(resetPreferencePatch("defaultDDLTime"))}
          resetAriaLabel="将默认截止时间恢复默认"
          highlighted={highlightedId === "default-ddl-time"}
        >
          <SettingsInput
            type="time"
            value={preferences.defaultDDLTime}
            onChange={(v) => updatePreferences({ defaultDDLTime: v })}
            ariaLabel="默认截止时间"
            className="font-mono font-bold"
          />
        </SettingsRow>

        <SettingsRow
          settingId="default-task-priority"
          title="默认优先级"
          modified={modified.has("defaultTaskPriority")}
          onReset={() => updatePreferences(resetPreferencePatch("defaultTaskPriority"))}
          resetAriaLabel="将默认优先级恢复默认"
          highlighted={highlightedId === "default-task-priority"}
        >
          <SettingsSelect
            value={preferences.defaultTaskPriority}
            onChange={(v) => updatePreferences({ defaultTaskPriority: v })}
            ariaLabel="默认优先级"
            options={TASK_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
          />
        </SettingsRow>

        <SettingsRow
          settingId="default-task-status"
          title="默认状态"
          modified={modified.has("defaultTaskStatus")}
          onReset={() => updatePreferences(resetPreferencePatch("defaultTaskStatus"))}
          resetAriaLabel="将默认状态恢复默认"
          highlighted={highlightedId === "default-task-status"}
        >
          <SettingsSelect
            value={preferences.defaultTaskStatus}
            onChange={(v) => updatePreferences({ defaultTaskStatus: v })}
            ariaLabel="默认状态"
            options={TASK_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
          />
        </SettingsRow>

        <SettingsRow
          settingId="default-task-workspace-view"
          title="默认任务视图"
          modified={modified.has("defaultTaskWorkspaceView")}
          onReset={() => updatePreferences(resetPreferencePatch("defaultTaskWorkspaceView"))}
          resetAriaLabel="将默认任务视图恢复默认"
          highlighted={highlightedId === "default-task-workspace-view"}
        >
          <SettingsSegmentedControl
            value={preferences.defaultTaskWorkspaceView}
            onChange={(v) => updatePreferences({ defaultTaskWorkspaceView: v })}
            ariaLabel="默认任务视图"
            options={PRIMARY_TASK_WORKSPACE_VIEWS.map((v) => ({ value: v.id, label: v.label }))}
          />
        </SettingsRow>

        </SettingsGroup>

        <SettingsGroup
          title="通知与提醒"
          description="站内提醒始终开启；可单独控制系统通知、声音与免打扰。"
        >
          {/* P3：自动 DDL 提醒默认提前量（semantic action：修改后同步重算所有 scheduled auto；custom 不受影响） */}
          <SettingsRow
            settingId="deadline-default-reminder"
            title="任务与 DDL 默认提醒"
            description="为截止事项自动创建提醒；自定义提醒不受影响。"
            modified={modified.has("defaultDeadlineReminderMinutes")}
            onReset={() => setDefaultDeadlineReminderMinutes(DEFAULT_DEADLINE_REMINDER_MINUTES)}
            resetAriaLabel="将任务与 DDL 默认提醒恢复默认"
            highlighted={highlightedId === "deadline-default-reminder"}
          >
            <SettingsSegmentedControl<number>
              value={preferences.defaultDeadlineReminderMinutes}
              onChange={(v) => setDefaultDeadlineReminderMinutes(v)}
              ariaLabel="任务与 DDL 默认提醒"
              options={DEADLINE_REMINDER_MINUTES.map((m) => ({
                value: m,
                label: DEADLINE_REMINDER_LABELS[m],
              }))}
            />
          </SettingsRow>

          {/* 应用内提醒始终开启：作为分组说明展示，不再占用可配置设置行 */}

          <SettingsRow
            settingId="browser-notifications"
            title="系统通知"
            description="提醒到期与专注完成时发送；需系统权限。"
            modified={reminderModified.has("browserNotificationsEnabled")}
            onReset={() => resetReminderPreference("browserNotificationsEnabled")}
            resetAriaLabel="将系统通知恢复默认"
            highlighted={highlightedId === "browser-notifications"}
          >
            <div className="flex flex-col items-end gap-1">
              <SettingsToggle
                checked={browserNotificationsEnabled}
                onChange={(v) => void handleBrowserNotificationToggle(v)}
                label="系统通知"
              />
              {/* 权限状态反映真实浏览器状态（granted / denied / default / unsupported） */}
              <p
                className={cn(
                  "text-[10px] max-w-[220px] text-right",
                  permissionTone === "success"
                    ? "text-success"
                    : permissionTone === "warning"
                      ? "text-warning"
                      : "text-sandrift"
                )}
                data-testid="notification-permission-state"
              >
                {permissionLabel}
              </p>
            </div>
          </SettingsRow>

          <SettingsRow
            settingId="missed-reminder-policy"
            title="错过提醒处理"
            description="未打开应用时错过提醒的处理方式。"
            modified={reminderModified.has("missedReminderPolicy")}
            onReset={() => resetReminderPreference("missedReminderPolicy")}
            resetAriaLabel="将错过提醒处理恢复默认"
            highlighted={highlightedId === "missed-reminder-policy"}
          >
            <SettingsSelect
              value={missedReminderPolicy}
              onChange={(v) => setMissedReminderPolicy(v)}
              ariaLabel="错过提醒处理"
              options={MISSED_POLICY_OPTIONS}
            />
          </SettingsRow>

          {missedReminderPolicy === "recent-only" && (
            <SettingsRow
              settingId="missed-reminder-window"
              title="补发时间范围"
              description="仅补发此时间范围内的提醒。"
              modified={reminderModified.has("missedReminderWindowHours")}
              onReset={() => resetReminderPreference("missedReminderWindowHours")}
              resetAriaLabel="将补发时间范围恢复默认"
              highlighted={highlightedId === "missed-reminder-window"}
            >
              <SettingsSegmentedControl<MissedReminderWindowHours>
                value={missedReminderWindowHours}
                onChange={(v) => setMissedReminderWindowHours(v)}
                ariaLabel="补发时间范围"
                options={[
                  { value: 1, label: "1 小时" },
                  { value: 6, label: "6 小时" },
                  { value: 24, label: "24 小时" },
                ]}
              />
            </SettingsRow>
          )}

          <SettingsRow settingId="reminder-sound" title="提醒声音" modified={reminderModified.has("reminderSoundEnabled")} onReset={() => resetReminderPreference("reminderSoundEnabled")} resetAriaLabel="将提醒声音恢复默认" highlighted={highlightedId === "reminder-sound"}>
            <SettingsToggle checked={reminderSoundEnabled} onChange={setReminderSoundEnabled} label="提醒声音" />
          </SettingsRow>

          <SettingsRow
            settingId="reminder-sound-volume"
            title="提醒音量"
            description="关闭提醒声音时不可调；可先试听再调整。"
            modified={reminderModified.has("reminderSoundVolume")}
            onReset={() => resetReminderPreference("reminderSoundVolume")}
            resetAriaLabel="将提醒音量恢复默认"
            highlighted={highlightedId === "reminder-sound-volume"}
          >
            <div className="flex flex-wrap items-center justify-end gap-2">
              <SettingsSlider
                value={reminderSoundVolume}
                min={0}
                max={100}
                step={1}
                onChange={(v) => setReminderSoundVolume(v)}
                ariaLabel="提醒音量"
                disabled={!reminderSoundEnabled}
                formatValue={(v) => `${v}%`}
              />
              <SettingsButton
                variant="secondary"
                onClick={() => playReminderSound(reminderSoundVolume)}
                disabled={!reminderSoundEnabled || reminderSoundVolume <= 0}
              >
                试听
              </SettingsButton>
            </div>
          </SettingsRow>

          <SettingsRow
            settingId="do-not-disturb"
            title="免打扰时段"
            description="暂停提醒的系统通知与声音；站内提醒与专注完成提示不受影响。"
            modified={isDoNotDisturbModified(reminderPrefs)}
            onReset={() => resetDoNotDisturb()}
            resetAriaLabel="将免打扰时段恢复默认"
            highlighted={highlightedId === "do-not-disturb"}
          >
            <div className="flex flex-col items-end gap-2">
              <SettingsToggle checked={doNotDisturbEnabled} onChange={setDoNotDisturbEnabled} label="免打扰时段" />
              {doNotDisturbEnabled && (
                <div className="flex items-center gap-1.5">
                  <span className="w-[104px] shrink-0">
                    <SettingsInput
                      type="time"
                      value={doNotDisturbStart}
                      onChange={(v) => setDoNotDisturbStart(v)}
                      ariaLabel="免打扰开始时间"
                      mono
                    />
                  </span>
                  <span className="text-sandrift" aria-hidden="true">-</span>
                  <span className="w-[104px] shrink-0">
                    <SettingsInput
                      type="time"
                      value={doNotDisturbEnd}
                      onChange={(v) => setDoNotDisturbEnd(v)}
                      ariaLabel="免打扰结束时间"
                      mono
                    />
                  </span>
                </div>
              )}
            </div>
          </SettingsRow>

          <SettingsRow
            settingId="focus-auto-dnd"
            title="专注期间自动免打扰"
            description="专注进行中暂停提醒的系统通知与声音；专注完成提示不受影响。"
            modified={reminderModified.has("focusAutoDoNotDisturbEnabled")}
            onReset={() => resetReminderPreference("focusAutoDoNotDisturbEnabled")}
            resetAriaLabel="将专注期间自动免打扰恢复默认"
            highlighted={highlightedId === "focus-auto-dnd"}
          >
            <SettingsToggle
              checked={focusAutoDoNotDisturbEnabled}
              onChange={setFocusAutoDoNotDisturbEnabled}
              label="专注期间自动免打扰"
            />
          </SettingsRow>
        </SettingsGroup>
      </div>
    </SettingsSection>
  );
}
