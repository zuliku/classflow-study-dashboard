"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { AIProviderId, AICustomConfig, AISettings } from "@/lib/ai/providers/types";
import { getDefaultModel } from "@/lib/ai/providers/registry";
import { KiroReasoningEffort } from "@/lib/ai/reasoning/types";

/**
 * AI 服务设置（独立于业务 useAppStore）：
 * ClassFlow business backup 不应包含 AI 配置（更不包含 API Key）。
 * 持久化：localStorage `classflow-ai-settings-v1`。
 * API Key 一律放 sessionStorage（见 lib/ai/sessionKeys.ts），不进入本 store。
 */
interface AISettingsState extends AISettings {
  setEnabled: (enabled: boolean) => void;
  setProvider: (provider: AIProviderId) => void;
  setModel: (model: string) => void;
  setCustom: (patch: Partial<AICustomConfig>) => void;
  setMemoryEnabled: (enabled: boolean) => void;
  setReasoningEffort: (effort: KiroReasoningEffort) => void;
  reset: () => void;
}

const DEFAULT_SETTINGS: AISettings = {
  enabled: false,
  provider: "deepseek",
  model: getDefaultModel("deepseek"),
  custom: { providerName: "", baseURL: "", model: "" },
  memoryEnabled: true,
  reasoningEffort: "default",
};

export const useAISettingsStore = create<AISettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,

      setEnabled: (enabled) => set({ enabled }),
      setProvider: (provider) =>
        set((state) => ({
          provider,
          // 切换 provider 时自动带上该 provider 的默认模型
          model: provider === "custom-openai" ? state.custom.model : getDefaultModel(provider),
        })),
      setModel: (model) => set({ model }),
      setMemoryEnabled: (enabled) => set({ memoryEnabled: enabled }),
      setReasoningEffort: (effort) => set({ reasoningEffort: effort }),
      setCustom: (patch) =>
        set((state) => ({
          custom: { ...state.custom, ...patch },
          // custom 模型同步到当前 model（自定义时 model 字段即 customModel）
          model: patch.model !== undefined ? patch.model : state.model,
        })),
      reset: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: "classflow-ai-settings-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state): AISettings => ({
        enabled: state.enabled,
        provider: state.provider,
        model: state.model,
        custom: state.custom,
        memoryEnabled: state.memoryEnabled,
        reasoningEffort: state.reasoningEffort,
      }),
    }
  )
);

export type { AISettings, AISettingsState };
