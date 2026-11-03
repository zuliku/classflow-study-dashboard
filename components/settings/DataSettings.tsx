"use client";

import React, { useState, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsActionRow } from "@/components/settings/SettingsActionRow";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { DataOverview } from "@/components/settings/DataOverview";
import { DataHealth } from "@/components/settings/DataHealth";
import { BackupSection } from "@/components/settings/BackupSection";
import { RestoreSection, RestoreResult } from "@/components/settings/RestoreSection";
import { DangerZone } from "@/components/settings/DangerZone";
import { LearningHistorySettings } from "@/components/settings/LearningHistorySettings";
import { CheckCircle2, AlertTriangle, ChevronDown, RefreshCcw } from "lucide-react";
import { useConfirmStore } from "@/store/useConfirmStore";
import { cn } from "@/lib/utils";

/** 数据与隐私中心：数据管理 / 学习历史 / 当前设备数据 / 隐私边界 / 危险操作 */
export function DataSettings() {
  // 选择性订阅：只有业务数据变化才重渲染（不订阅 Modal/activeTab 等 UI 状态）
  const { courses, schedules, assignments, groupProjects } = useAppStore(
    useShallow((s) => ({
      courses: s.courses,
      schedules: s.schedules,
      assignments: s.assignments,
      groupProjects: s.groupProjects,
    }))
  );

  const counts = useMemo(
    () => ({
      courses: courses.length,
      schedules: schedules.length,
      assignments: assignments.length,
      groupProjects: groupProjects.length,
      materials: courses.reduce((sum, c) => sum + c.materials.length, 0),
    }),
    [courses, schedules, assignments, groupProjects]
  );

  // 恢复结果：留在数据管理区内，不制造页面顶部大 Alert
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);

  // 数据诊断：日常不需要常开，默认收起
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  // 体验示例数据：收拢进「数据诊断」内（设置 → 数据 → 当前设备数据 → 数据诊断展开后可见）。
  // 日常隐藏降低 demo 感；载入前快照当前业务数据，Toast 提供一次撤销恢复。
  // 个人资料原样保留（restoreAppData 会整库覆盖，此处快照回填，备份恢复路径不受影响）
  const reloadDemoData = () => {
    useConfirmStore.getState().confirm({
      title: "载入示例数据？",
      description: "用示例课表和任务替换当前数据，可撤销；个人资料与偏好不受影响。",
      confirmLabel: "载入示例数据",
      onConfirm: () => {
        import("@/lib/dev/fullDemoData").then(({ buildFullDemoData }) => {
          const store = useAppStore.getState();
          const savedProfile = store.userProfile;
          // 快照当前业务数据，供 Toast 撤销一次恢复（profile 以当前真实为准）；
          // 深拷贝：restoreAppData 归一化与演示期写入不得污染快照引用
          const snapshot = structuredClone({
            userProfile: savedProfile,
            semester: store.semester,
            courses: store.courses,
            schedules: store.schedules,
            assignments: store.assignments,
            calendarMarks: store.calendarMarks,
            groupProjects: store.groupProjects,
            studyBlocks: store.studyBlocks,
            preferences: store.preferences,
            reminders: store.reminders,
            focusSessions: store.focusSessions,
            scheduleOccurrenceOverrides: store.scheduleOccurrenceOverrides,
            bellSchedules: store.bellSchedules,
            activeBellScheduleId: store.activeBellScheduleId,
          });
          store.restoreAppData(buildFullDemoData());
          // 兑现“个人资料不受影响”：restoreAppData 整库覆盖，演示载入把真名回填
          useAppStore.getState().updateUserProfile(savedProfile);
          // 演示学期开学于数周前：按新学期校准当前教学周
          store.resetToCurrentWeek();
          useToastStore.getState().pushToast({
            message: "示例数据已载入",
            type: "success",
            actionLabel: "撤销",
            onAction: () => {
              useAppStore.getState().restoreAppData(snapshot);
              // 撤销后教学周按恢复的学期重算（否则停留在演示周）
              useAppStore.getState().resetToCurrentWeek();
            },
          });
        });
      },
    });
  };

  return (
    <SettingsSection title="数据与隐私">
      <div className="space-y-4" data-testid="settings-data">
        {/* 数据管理：日常真实动作优先 */}
        <SettingsGroup title="数据管理">
          <BackupSection />
          {restoreResult && (
            <div className="my-2 p-3 bg-pastel-mint/60 border border-line rounded-xl space-y-0.5 text-xs" data-testid="restore-result">
              <p className="flex items-center gap-1.5 font-bold text-success">
                <CheckCircle2 className="w-3.5 h-3.5" />
                恢复完成
              </p>
              <p className="text-[11px] text-satin-grey">
                {restoreResult.courses} 门课程 · {restoreResult.schedules} 个排课时段 ·{" "}
                {restoreResult.assignments} 项任务 · {restoreResult.materials} 个附件
              </p>
              {restoreResult.warnings.map((w) => (
                <p key={w} className="flex items-start gap-1.5 text-warning font-semibold text-[11px]">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {w}
                </p>
              ))}
            </div>
          )}
          <RestoreSection onRestored={setRestoreResult} />
        </SettingsGroup>

        {/* 学习历史 */}
        <SettingsGroup title="学习历史">
          <LearningHistorySettings />
        </SettingsGroup>

        {/* 当前设备数据：概览常驻；诊断默认收起；体验示例收拢进诊断内 */}
        <SettingsGroup title="当前设备数据" contentClassName="px-4 py-3 space-y-2">
          <DataOverview counts={counts} />
          <button
            type="button"
            data-testid="data-diagnostics-toggle"
            onClick={() => setDiagnosticsOpen((v) => !v)}
            aria-expanded={diagnosticsOpen}
            className="w-full flex items-center justify-between py-2 text-left"
          >
            <span className="text-xs font-bold text-charcoal">数据诊断</span>
            <ChevronDown
              className={cn(
                "w-4 h-4 text-sandrift transition-transform duration-[var(--motion-fast)]",
                diagnosticsOpen && "rotate-180"
              )}
              aria-hidden="true"
            />
          </button>
          <DisclosureRegion open={diagnosticsOpen}>
            <div className="pb-1 space-y-3">
              <DataHealth />
              {/* 体验示例：诊断内的次级入口（用于熟悉功能与测试），日常收起降低 demo 感 */}
              <div data-testid="dev-demo-reload" className="rounded-xl border border-line-soft bg-surface-soft/60 px-3 py-1">
                <SettingsActionRow
                  title="体验示例数据"
                  description="载入示例课表和任务，会替换当前课程与任务；可撤销，个人资料不受影响。"
                  icon={<RefreshCcw className="w-3.5 h-3.5 text-[#A48F82]" />}
                  actionLabel="载入示例数据"
                  onAction={reloadDemoData}
                  actionMinWidth="min-w-[140px]"
                />
              </div>
            </div>
          </DisclosureRegion>
        </SettingsGroup>

        {/* 隐私：本地优先的数据边界（真实行为说明，非虚构承诺） */}
        <SettingsGroup title="隐私">
          <SettingsRow settingId="kiro-privacy-local" title="本地优先">
            <span className="px-2 py-0.5 rounded-full bg-alabaster border border-line text-[10px] font-bold text-satin-grey shrink-0">
              本地存储
            </span>
          </SettingsRow>
          <SettingsRow settingId="kiro-privacy-api-key" title="API Key">
            <span className="px-2 py-0.5 rounded-full bg-alabaster border border-line text-[10px] font-bold text-satin-grey shrink-0">
              会话级
            </span>
          </SettingsRow>
          <SettingsRow settingId="kiro-privacy-context" title="上下文发送">
            <span className="px-2 py-0.5 rounded-full bg-alabaster border border-line text-[10px] font-bold text-satin-grey shrink-0">
              按需发送
            </span>
          </SettingsRow>
        </SettingsGroup>

        {/* 危险操作 */}
        <SettingsGroup title="危险操作">
          <DangerZone />
        </SettingsGroup>
      </div>
    </SettingsSection>
  );
}
