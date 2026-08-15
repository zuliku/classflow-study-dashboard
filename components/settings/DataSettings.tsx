"use client";

import React, { useState, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/store/useAppStore";
import { useToastStore } from "@/store/useToastStore";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { SettingsActionRow } from "@/components/settings/SettingsActionRow";
import { DisclosureRegion } from "@/components/ui/DisclosureRegion";
import { DataOverview } from "@/components/settings/DataOverview";
import { DataHealth } from "@/components/settings/DataHealth";
import { BackupSection } from "@/components/settings/BackupSection";
import { RestoreSection, RestoreResult } from "@/components/settings/RestoreSection";
import { DangerZone } from "@/components/settings/DangerZone";
import { LearningHistorySettings } from "@/components/settings/LearningHistorySettings";
import { CheckCircle2, AlertTriangle, ChevronDown, RefreshCcw } from "lucide-react";
import { cn } from "@/lib/utils";

/** 数据与存储中心：数据管理 / 学习历史 / 数据诊断（默认收起）/ 危险操作 */
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

  // 数据诊断：日常不需要常开（概览计数 / 健康检查），默认收起
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  // Dev Only：重新载入全模块演示数据（解决旧版预览数据残留，无需 ?preview= URL）
  const reloadDemoData = () => {
    if (
      !confirm(
        "重新载入完整演示数据？\n\n将覆盖当前全部任务/课程/学习计划数据（个人资料与偏好保留）。"
      )
    ) {
      return;
    }
    import("@/lib/dev/fullDemoData").then(({ buildFullDemoData }) => {
      useAppStore.getState().restoreAppData(buildFullDemoData());
      localStorage.setItem("classflow-demo-injected", "1");
      useToastStore.getState().pushToast({ message: "已重新载入完整演示数据", type: "success" });
    });
  };

  return (
    <SettingsSection title="数据与存储" description="备份、恢复、学习历史与危险操作管理。">
      <div className="space-y-4" data-testid="settings-data">
        {/* 数据管理：日常真实动作优先 */}
        <SettingsGroup title="数据管理">
          <BackupSection />
          {restoreResult && (
            <div className="mx-3 mb-3 p-3 bg-pastel-mint/60 border border-line rounded-xl space-y-0.5 text-xs" data-testid="restore-result">
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
          <div className="mx-3 mb-3">
            <RestoreSection onRestored={setRestoreResult} />
          </div>
        </SettingsGroup>

        {/* 学习历史 */}
        <SettingsGroup title="学习历史">
          <LearningHistorySettings />
        </SettingsGroup>

        {/* 数据诊断：信息性质（非设置），默认收起 */}
        <SettingsGroup>
          <button
            type="button"
            onClick={() => setDiagnosticsOpen((v) => !v)}
            aria-expanded={diagnosticsOpen}
            className="w-full flex items-center justify-between px-3 py-2.5 text-left"
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
            <div className="px-3 pb-3 space-y-1">
              <div className="py-3">
                <DataOverview counts={counts} />
              </div>
              <div className="py-2">
                <DataHealth />
              </div>
            </div>
          </DisclosureRegion>
        </SettingsGroup>

        {/* 危险操作 */}
        <SettingsGroup title="危险操作">
          <DangerZone />
        </SettingsGroup>

        {/* 开发工具（仅 dev）：低权重，位于页面最底部，不属于正式设置 */}
        {process.env.NODE_ENV === "development" && (
          <SettingsGroup title="开发工具">
            <SettingsActionRow
              title="完整演示数据"
              description="重载用于本地开发的完整模块数据（覆盖业务数据，保留个人资料与偏好）"
              icon={<RefreshCcw className="w-3.5 h-3.5 text-[#A48F82]" />}
              actionLabel="重新载入"
              onAction={reloadDemoData}
              actionMinWidth="min-w-[104px]"
            />
          </SettingsGroup>
        )}
      </div>
    </SettingsSection>
  );
}
