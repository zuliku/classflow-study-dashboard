"use client";

import React, { useCallback, useState } from "react";
import { Brain } from "lucide-react";
import { useAISettingsStore } from "@/store/useAISettingsStore";
import { useKiroMemory } from "@/hooks/useKiroMemory";
import { useConfirmStore } from "@/store/useConfirmStore";
import { useToastStore } from "@/store/useToastStore";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { KiroMemoryManager } from "@/components/kiro/KiroMemoryManager";

/**
 * Kiro 记忆（Task 9）设置块：开关 + 条数 + 管理入口 + 清空。
 * 记忆归属：MemoryEnabled 开关所在分区对应 provider 的 Provider 设置命名空间。
 */
export function KiroMemorySettings() {
  const memoryEnabled = useAISettingsStore((s) => s.memoryEnabled);
  const setMemoryEnabled = useAISettingsStore((s) => s.setMemoryEnabled);
  const memory = useKiroMemory();
  const confirmRequest = useConfirmStore((s) => s.confirm);
  const pushToast = useToastStore((s) => s.pushToast);
  const [managerOpen, setManagerOpen] = useState(false);

  const onChanged = useCallback(() => {
    void memory.refresh();
  }, [memory.refresh]);

  const clearAll = () => {
    confirmRequest({
      title: "清空 Kiro 的全部记忆？",
      description: "不会删除聊天记录、课程、任务或资料。",
      confirmLabel: "清空",
      danger: true,
      onConfirm: () => {
        void memory.clear().then(() => pushToast({ message: "记忆已清空" }));
      },
    });
  };

  return (
    <>
      <SettingsRow settingId="kiro-memory-enabled" title="Kiro 记忆" description="Kiro 记住你的学习偏好并持续运用。记忆保存在当前浏览器中。">
        <button
          onClick={() => setMemoryEnabled(!memoryEnabled)}
          role="switch"
          aria-checked={memoryEnabled}
          aria-label="启用 Kiro 记忆"
          className={
            "relative w-9 h-5 rounded-full transition-colors duration-200 shrink-0 " +
            (memoryEnabled ? "bg-emerald-500" : "bg-line-strong")
          }
        >
          <span
            className={
              "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 " +
              (memoryEnabled ? "translate-x-4" : "translate-x-0")
            }
          />
        </button>
      </SettingsRow>

      <SettingsRow settingId="kiro-memory-manager" title="记忆条目" description={`Kiro 已记住 ${memory.memories.length} 条偏好。`}>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setManagerOpen(true)}
            className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[11px] font-bold text-charcoal bg-pastel-mint hover:bg-pastel-mint transition-colors"
          >
            <Brain className="w-3.5 h-3.5" />
            管理
          </button>
          {memory.memories.length > 0 && (
            <button
              onClick={clearAll}
              className="px-2.5 h-7 rounded-lg text-[11px] font-bold text-satin-grey hover:text-danger hover:bg-alabaster transition-colors"
            >
              清空
            </button>
          )}
        </div>
      </SettingsRow>

      <KiroMemoryManager open={managerOpen} onClose={() => setManagerOpen(false)} onChanged={onChanged} />
    </>
  );
}
