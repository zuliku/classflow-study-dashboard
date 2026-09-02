"use client";

import React, { useState } from "react";
import { useAppStore } from "@/store/useAppStore";
import { useReminderPreferencesStore } from "@/store/useReminderPreferencesStore";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsToggle, SettingsSelect, SettingsSegmentedControl, SettingsInput } from "@/components/settings/SettingsControls";
import { DDL_WARNING_DAYS, TASK_PRIORITIES, TASK_STATUSES, DEADLINE_REMINDER_MINUTES, DEADLINE_REMINDER_LABELS, DEFAULT_DEADLINE_REMINDER_MINUTES } from "@/lib/preferences";
import { getModifiedPreferenceKeys, resetPreferencePatch } from "@/lib/preferences";
import { PRIMARY_TASK_WORKSPACE_VIEWS } from "@/lib/tasks/taskViews";
import { MissedReminderPolicy } from "@/types";
import { MissedReminderWindowHours } from "@/store/useReminderPreferencesStore";
import {
  getBrowserNotificationPermission,
  isBrowserNotificationSupported,
  requestBrowserNotificationPermission,
  describeBrowserNotificationPermission,
} from "@/lib/reminders/browserNotifications";
import { cn } from "@/lib/utils";

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
  const doNotDisturbEnabled = useReminderPreferencesStore((s) => s.doNotDisturbEnabled);
  const setDoNotDisturbEnabled = useReminderPreferencesStore((s) => s.setDoNotDisturbEnabled);
  const doNotDisturbStart = useReminderPreferencesStore((s) => s.doNotDisturbStart);
  const setDoNotDisturbStart = useReminderPreferencesStore((s) => s.setDoNotDisturbStart);
  const doNotDisturbEnd = useReminderPreferencesStore((s) => s.doNotDisturbEnd);
  const setDoNotDisturbEnd = useReminderPreferencesStore((s) => s.setDoNotDisturbEnd);
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
      setPermissionNote("当前浏览器不支持系统通知，站内提醒仍可正常使用。");
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
      setPermissionNote("浏览器已阻止通知权限，请在浏览器设置中修改。");
      return;
    }
    const result = await requestBrowserNotificationPermission();
    if (result === "granted") {
      setBrowserNotificationsEnabled(true);
      setPermissionNote("");
    } else {
      setBrowserNotificationsEnabled(false);
      setPermissionNote(
        result === "denied" ? "浏览器已阻止通知权限，请在浏览器设置中修改。" : ""
      );
    }
  };

  return (
    <SettingsSection
      title="任务与提醒"
      description="任务默认值、临近截止提示与提醒通知偏好。"
    >
      <div className="text-xs space-y-4" data-testid="settings-tasks">
        <SettingsGroup title="任务">
        <SettingsRow
          settingId="ddl-warning-days"
          title="临近截止提醒"
          description="未来多少天内显示截止任务。"
          modified={modified.has("ddlWarningDays")}
          onReset={() => updatePreferences(resetPreferencePatch("ddlWarningDays"))}
          resetAriaLabel="将临近截止提醒恢复默认"
          highlighted={highlightedId === "ddl-warning-days"}
        >
          <div className="flex items-center gap-1 bg-alabaster p-0.5 rounded-xl border border-line-strong">
            {DDL_WARNING_DAYS.map((d) => {
              const isActive = preferences.ddlWarningDays === d;
              return (
                <button
                  key={d}
                  onClick={() => updatePreferences({ ddlWarningDays: d })}
                  aria-pressed={isActive}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors duration-[var(--motion-fast)]",
                    isActive
                      ? "bg-white text-charcoal shadow-subtle"
                      : "text-satin-grey hover:text-charcoal"
                  )}
                >
                  {d} 天
                </button>
              );
            })}
          </div>
        </SettingsRow>

        <SettingsRow
          settingId="default-ddl-time"
          title="默认截止时间"
          description="新建任务时预填的截止时刻（HH:mm）；编辑已有任务不受影响。"
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
          description="新建任务时预填的优先级。"
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
          description="新建任务时预填的状态（进行中的任务默认待完成）。"
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
          description="每次打开 ClassFlow 时，任务工作区默认显示的视图。"
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

        <SettingsGroup title="提醒">
          {/* P3：自动 DDL 提醒默认提前量（semantic action：修改后同步重算所有 scheduled auto；custom 不受影响） */}
          <SettingsRow
            settingId="deadline-default-reminder"
            title="任务与 DDL 默认提醒"
            description="为新建和现有的截止事项自动创建提醒。修改后会同步更新使用默认设置的自动提醒，自定义提醒不受影响。"
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

          {/* 应用内提醒：核心行为，始终开启（无底层开关，不伪造设置） */}
          <SettingsRow
            settingId="in-app-reminders"
            title="应用内提醒"
            description="提醒到期时在 ClassFlow 内展示提醒中心与角标。"
          >
            <span className="px-2 py-0.5 rounded-full bg-pastel-mint text-[10px] font-bold text-charcoal shrink-0">
              始终开启
            </span>
          </SettingsRow>

          <SettingsRow
            settingId="browser-notifications"
            title="浏览器系统通知"
            description="提醒到期时同时发送浏览器系统通知。"
            highlighted={highlightedId === "browser-notifications"}
          >
            <div className="flex flex-col items-end gap-1">
              <SettingsToggle
                checked={browserNotificationsEnabled}
                onChange={(v) => void handleBrowserNotificationToggle(v)}
                label="浏览器系统通知"
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
            description="ClassFlow 未打开期间错过提醒时的处理方式。"
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
              description="只补发距离当前时间不超过该范围的提醒。"
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

          <SettingsRow
            settingId="reminder-sound"
            title="提醒声音"
            description="提醒到期时播放提示音；关闭后仅保留视觉提醒。"
            highlighted={highlightedId === "reminder-sound"}
          >
            <SettingsToggle
              checked={reminderSoundEnabled}
              onChange={setReminderSoundEnabled}
              label="提醒声音"
            />
          </SettingsRow>

          <SettingsRow
            settingId="do-not-disturb"
            title="免打扰时段"
            description="在此时段内暂停系统通知和提醒声音，仅保留应用内提醒。"
            highlighted={highlightedId === "do-not-disturb"}
          >
            <div className="flex flex-col items-end gap-2">
              <SettingsToggle checked={doNotDisturbEnabled} onChange={setDoNotDisturbEnabled} label="免打扰时段" />
              {doNotDisturbEnabled && (
                <div className="flex items-center gap-1.5">
                  <input
                    type="time"
                    value={doNotDisturbStart}
                    onChange={(e) => setDoNotDisturbStart(e.target.value)}
                    className="h-8 px-2 bg-[#F7F5F5] border border-line rounded-lg text-xs font-mono"
                    aria-label="免打扰开始时间"
                  />
                  <span className="text-sandrift">-</span>
                  <input
                    type="time"
                    value={doNotDisturbEnd}
                    onChange={(e) => setDoNotDisturbEnd(e.target.value)}
                    className="h-8 px-2 bg-[#F7F5F5] border border-line rounded-lg text-xs font-mono"
                    aria-label="免打扰结束时间"
                  />
                </div>
              )}
            </div>
          </SettingsRow>
        </SettingsGroup>
      </div>
    </SettingsSection>
  );
}
