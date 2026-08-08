"use client";

import React from "react";
import { RotateCcw, Trash2, XCircle } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { useToastStore } from "@/store/useToastStore";

/** 危险操作：三个明确语义层级（偏好 / 学习数据 / 全部本地数据） */
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
      description: "恢复所有 ClassFlow 偏好设置，不影响课程、任务和个人资料。",
      confirmLabel: "恢复默认设置",
      onConfirm: () => {
        resetPreferences();
        pushToast({ message: "已恢复默认设置" });
      },
    });
  };

  const handleClearLearningData = () => {
    confirmRequest({
      title: "清空学习数据？",
      description:
        "删除所有课程、排课、任务、小组项目和课程资料。个人资料、当前学期和应用偏好将保留。",
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
          "删除 ClassFlow 在此浏览器中的所有本地数据，包括个人资料、课程、任务、设置和课程附件。此操作无法撤销。",
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
      description: "最后确认：这将删除全部本地数据并回到首次使用状态。",
      confirmLabel: "确认清除",
      danger: true,
      onConfirm: () => {
        setConfirmPhase(0);
        resetEntireApp();
        pushToast({ message: "已清除所有本地数据" });
      },
    });
  };

  const rows = [
    {
      key: "preferences",
      icon: RotateCcw,
      title: "恢复默认设置",
      description: "恢复所有偏好设置，不影响课程、任务和个人资料。",
      action: handleResetPreferences,
      label: "恢复默认设置",
      danger: false,
    },
    {
      key: "learning",
      icon: Trash2,
      title: "清空学习数据",
      description: "删除所有课程、排课、任务、小组项目和课程资料。个人资料、学期和偏好将保留。",
      action: handleClearLearningData,
      label: "清空学习数据",
      danger: true,
    },
    {
      key: "entire",
      icon: XCircle,
      title: "清除所有本地数据",
      description: "删除此浏览器中的所有本地数据，包括个人资料、课程、任务、设置和课程附件。",
      action: handleResetEntireApp,
      label: confirmPhase === 1 ? "再次点击确认清除" : "清除所有本地数据",
      danger: true,
    },
  ];

  return (
    <div className="space-y-2.5 text-xs" data-testid="danger-zone">
      {rows.map((r) => {
        const Icon = r.icon;
        return (
          <div
            key={r.key}
            className="flex items-center justify-between gap-4 p-3 bg-[#F7F5F5] border border-line rounded-xl"
          >
            <div className="min-w-0">
              <p className={`font-bold ${r.danger ? "text-danger" : "text-charcoal"}`}>
                {r.title}
              </p>
              <p className="text-[10px] text-satin-grey mt-0.5">{r.description}</p>
            </div>
            <button
              onClick={r.action}
              className={`flex items-center gap-1.5 px-3 py-1.5 font-bold rounded-xl transition-colors shrink-0 ${
                r.danger
                  ? "bg-danger-bg text-danger border border-danger-border hover:bg-danger-border"
                  : "bg-white border border-line text-satin-grey hover:bg-alabaster"
              }`}
              data-testid={`danger-${r.key}`}
            >
              <Icon className="w-3.5 h-3.5" />
              {r.label}
            </button>
          </div>
        );
      })}
    </div>
  );
}
