"use client";

import React, { useCallback, useState } from "react";
import { Brain } from "lucide-react";
import { useAISettingsStore } from "@/store/useAISettingsStore";
import { useKiroMemory } from "@/hooks/useKiroMemory";
import { useConfirmStore } from "@/store/useConfirmStore";
import { useToastStore } from "@/store/useToastStore";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsToggle, SettingsButton } from "@/components/settings/SettingsControls";
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
      <SettingsRow settingId="kiro-memory-enabled" title="Kiro 记忆" description="Kiro 记住你的学习偏好并持续运用。记忆保存在当前设备中。">
        <SettingsToggle checked={memoryEnabled} onChange={setMemoryEnabled} label="启用 Kiro 记忆" />
      </SettingsRow>

      <SettingsRow settingId="kiro-memory-manager" title="记忆条目" description={`Kiro 已记住 ${memory.memories.length} 条偏好。`}>
        <div className="flex items-center gap-2">
          <SettingsButton variant="accent" onClick={() => setManagerOpen(true)}>
            <Brain className="w-3.5 h-3.5" />
            管理
          </SettingsButton>
          {memory.memories.length > 0 && (
            <SettingsButton variant="ghost" onClick={clearAll}>
              清空
            </SettingsButton>
          )}
        </div>
      </SettingsRow>

      <KiroMemoryManager open={managerOpen} onClose={() => setManagerOpen(false)} onChanged={onChanged} />
    </>
  );
}
