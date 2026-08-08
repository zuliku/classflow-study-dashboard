"use client";

import React from "react";
import { RotateCcw } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useConfirmStore } from "@/store/useConfirmStore";
import { useToastStore } from "@/store/useToastStore";

/**
 * 危险操作：重置行为 = resetAllDataToDefault（恢复为初始演示数据），
 * 文案与真实行为保持一致。
 */
export function DangerZone() {
  const resetAllDataToDefault = useAppStore((s) => s.resetAllDataToDefault);
  const confirmRequest = useConfirmStore((s) => s.confirm);
  const pushToast = useToastStore((s) => s.pushToast);

  const handleReset = () => {
    confirmRequest({
      title: "重置所有数据？",
      description:
        "课程、任务、日历与本地资料都会恢复为初始演示数据，现有修改会丢失。",
      confirmLabel: "重置数据",
      danger: true,
      onConfirm: () => {
        resetAllDataToDefault();
        pushToast({ message: "已恢复初始演示数据" });
      },
    });
  };

  return (
    <div
      className="flex items-center justify-between gap-4 p-3 bg-danger-bg/60 border border-danger-border rounded-xl"
      data-testid="danger-zone"
    >
      <div className="min-w-0">
        <p className="font-bold text-danger">重置 ClassFlow</p>
        <p className="text-[10px] text-satin-grey mt-0.5">恢复初始演示数据，所有修改将丢失</p>
      </div>
      <button
        onClick={handleReset}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-danger text-white font-bold rounded-xl transition-colors hover:bg-danger/85 shrink-0"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        重置所有数据
      </button>
    </div>
  );
}
