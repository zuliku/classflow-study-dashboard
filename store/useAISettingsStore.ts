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

const VALID_PROVIDERS: AIProviderId[] = ["opencode-go", "deepseek", "custom-openai"];
const VALID_REASONING: KiroReasoningEffort[] = ["default", "minimal", "low", "medium", "high", "xhigh", "max"];

function sanitizeAISettings(persisted: unknown): Partial<AISettings> {
  if (!persisted || typeof persisted !== "object") return {};
  const p = persisted as Record<string, unknown>;
  const out: Partial<AISettings> = {};
  if (typeof p.enabled === "boolean") out.enabled = p.enabled;
  if (typeof p.provider === "string" && (VALID_PROVIDERS as string[]).includes(p.provider)) {
    out.provider = p.provider as AIProviderId;
  }
  if (typeof p.model === "string" && p.model.trim()) out.model = p.model.trim().slice(0, 120);
  if (p.custom && typeof p.custom === "object") {
    const c = p.custom as Record<string, unknown>;
    out.custom = {
      providerName: typeof c.providerName === "string" ? c.providerName.slice(0, 80) : "",
      baseURL: typeof c.baseURL === "string" ? c.baseURL.slice(0, 512) : "",
      model: typeof c.model === "string" ? c.model.slice(0, 120) : "",
    };
  }
  if (typeof p.memoryEnabled === "boolean") out.memoryEnabled = p.memoryEnabled;
  if (typeof p.reasoningEffort === "string" && (VALID_REASONING as string[]).includes(p.reasoningEffort)) {
    out.reasoningEffort = p.reasoningEffort as KiroReasoningEffort;
  }
  return out;
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
      merge: (persisted, current) => {
        const sanitized = sanitizeAISettings((persisted as any)?.state ?? persisted);
        // provider 非法回落 deepseek 并同步默认模型
        if (sanitized.provider && sanitized.provider !== current.provider && !sanitized.model) {
          sanitized.model = getDefaultModel(sanitized.provider);
        }
        // model 非法或 provider 已回落但 model 不匹配提供商前缀，做一次最小修复
        if (sanitized.model && sanitized.provider) {
          const validForProvider =
            sanitized.provider === "custom-openai"
              ? true
              : sanitized.model.startsWith(sanitized.provider === "deepseek" ? "deepseek-" : sanitized.provider === "opencode-go" ? "" : "");
          // 保守：仅当 deepseek 模型却落在 opencode-go 等明显越界时回落
          if (!validForProvider && sanitized.provider === "deepseek" && !sanitized.model.startsWith("deepseek-")) {
            sanitized.model = getDefaultModel("deepseek");
          }
        }
        return { ...current, ...sanitized };
      },
    }
  )
);

export type { AISettings, AISettingsState };
