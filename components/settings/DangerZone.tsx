"use client";

import React from "react";
import { RotateCcw, Trash2, XCircle } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { useToastStore } from "@/store/useToastStore";
import { SettingsActionRow } from "@/components/settings/SettingsActionRow";
import { resetOuterScopesForEntireApp } from "@/lib/reset/resetOuterScopes";

/** 危险操作：三个明确语义层级（偏好 / 学习数据 / 全部本地数据）；确认逻辑保持原有 safety */
export function DangerZone() {
  const resetPreferences = useAppStore((s) => s.resetPreferences);
  const clearLearningData = useAppStore((s) => s.clearLearningData);
  const resetEntireApp = useAppStore((s) => s.resetEntireApp);
  const confirmRequest = useConfirmStore((s) => s.confirm);
  const pushToast = useToastStore((s) => s.pushToast);

  const [confirmPhase, setConfirmPhase] = React.useState(0);

  const handleResetPreferences = () => {
    confirmRequest({
      title: "恢复默认设置？",
      description: "恢复主工作区偏好，不影响课程、任务和个人资料；其他设置需单独恢复。",
      confirmLabel: "恢复默认设置",
      onConfirm: () => {
        resetPreferences();
        pushToast({ message: "已恢复主工作区默认设置" });
      },
    });
  };

  const handleClearLearningData = () => {
    confirmRequest({
      title: "清空学习数据？",
      description:
        "删除课程、任务、资料、小组项目、作息表、提醒与专注记录；个人资料、学期、偏好与 Kiro 对话保留。",
      confirmLabel: "清空学习数据",
      danger: true,
      onConfirm: () => {
        clearLearningData();
        pushToast({ message: "学习数据已清空" });
      },
    });
  };

  // 两阶段确认（不引入复杂输入确认框架）：第一次点按进入确认态，第二次执行
  const handleResetEntireApp = () => {
    if (confirmPhase === 0) {
      confirmRequest({
        title: "清除所有本地数据？",
        description:
          "删除主工作区数据、偏好、收件箱与本会话凭据，回到首次使用；无法撤销。账号凭据与 Kiro 对话历史需单独清理。",
        confirmLabel: "继续",
        danger: true,
        onConfirm: () => {
          setConfirmPhase(1);
        },
      });
      return;
    }
    confirmRequest({
      title: "确认清除？",
      description: "最后确认：删除全部本地数据并回到首次使用。",
      confirmLabel: "确认清除",
      danger: true,
      onConfirm: () => {
        setConfirmPhase(0);
        resetEntireApp();
        // 主库之外：偏好/收件箱/会话凭据/待办快照回到首次使用（vault/对话 IDB 不动，见函数注释）
        resetOuterScopesForEntireApp();
        pushToast({ message: "已清除所有本地数据" });
      },
    });
  };

  const rows = [
    {
      key: "preferences",
      icon: <RotateCcw className="w-3.5 h-3.5" />,
      title: "恢复默认设置",
      description: "恢复主工作区偏好，不影响学习数据。",
      action: handleResetPreferences,
      label: "恢复默认设置",
      danger: false,
    },
    {
      key: "learning",
      icon: <Trash2 className="w-3.5 h-3.5" />,
      title: "清空学习数据",
      description: "删除课程、任务、作息表等学习数据；资料与偏好保留。",
      action: handleClearLearningData,
      label: "清空学习数据",
      danger: true,
    },
    {
      key: "entire",
      icon: <XCircle className="w-3.5 h-3.5" />,
      title: "清除所有本地数据",
      description: "清除工作区、偏好与收件箱，回到首次使用；凭据与对话历史除外。",
      action: handleResetEntireApp,
      label: confirmPhase === 1 ? "再次点击确认清除" : "清除所有本地数据",
      danger: true,
    },
  ];

  return (
    <div className="space-y-0" data-testid="danger-zone">
      {rows.map((r) => (
        <SettingsActionRow
          key={r.key}
          title={r.title}
          description={r.description}
          variant={r.danger ? "danger" : "secondary"}
          icon={r.icon}
          actionLabel={r.label}
          onAction={r.action}
          actionTestid={`danger-${r.key}`}
          actionMinWidth="min-w-[104px]"
        />
      ))}
    </div>
  );
}
