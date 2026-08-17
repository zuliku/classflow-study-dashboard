"use client";

import React from "react";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { SettingsRow } from "@/components/settings/SettingsRow";

/**
 * 专注与学习（Settings V3 Task 4 — 结构规划）。
 * 当前 Focus Session 领域没有用户偏好（时长/关联等均由会话与 Kiro 语义决定），
 * 因此不伪造开关；只展示真实行为说明，为后续真实偏好预留结构。
 */
export function FocusSettings() {
  return (
    <SettingsSection title="专注与学习" description="专注会话的行为说明与后续偏好入口。">
      <div className="text-xs space-y-4" data-testid="settings-focus">
        <SettingsGroup title="专注会话">
          <SettingsRow
            settingId="focus-tracking"
            title="实时专注计时"
            description="FocusSession 记录真实的专注时间；暂停期间不计入，结束后写入实际专注时长。"
          >
            <span className="px-2 py-0.5 rounded-full bg-pastel-mint text-[10px] font-bold text-charcoal shrink-0">
              已启用
            </span>
          </SettingsRow>

          <SettingsRow
            settingId="focus-completion-notification"
            title="完成提示"
            description="专注结束时会播放本地提示音；若系统已授权通知权限，同时发送系统通知。"
          >
            <span className="px-2 py-0.5 rounded-full bg-alabaster border border-line text-[10px] font-bold text-satin-grey shrink-0">
              跟随系统权限
            </span>
          </SettingsRow>

          <SettingsRow
            settingId="focus-kiro-duration"
            title="Kiro 启动专注"
            description="Kiro 收到「开始专注」但未指定时长时，会先询问时长，不会擅自使用默认值。"
          >
            <span className="text-[10px] text-sandrift shrink-0">需明确时长</span>
          </SettingsRow>
        </SettingsGroup>
      </div>
    </SettingsSection>
  );
}
