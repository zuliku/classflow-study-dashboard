"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createGuardedStorage, subscribeCrossWindowSync } from "@/lib/persistStorage";
import { useToastStore } from "@/store/useToastStore";
import { AIProviderId, AICustomConfig, AISettings } from "@/lib/ai/providers/types";
import { getDefaultModel, getModelsForProvider } from "@/lib/ai/providers/registry";
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

/**
 * Custom 能力声明 canonical defaults（conservative false；sanitizer fallback 唯一来源）。
 * runtime（getModelCapabilities / getReasoningCapability）以 `=== true` 判定，
 * 因此缺失、false、malformed 最终语义一致为 conservative false。
 */
const DEFAULT_CUSTOM_CAPABILITIES: Required<Pick<AICustomConfig, "vision" | "fileParts" | "reasoningEffort">> = {
  vision: false,
  fileParts: false,
  reasoningEffort: false,
};

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
      // V5A8：能力旗标严格 boolean 清洗（禁 truthy 强转；"true"/1/{}/[]/null 一律回落 false）
      vision: typeof c.vision === "boolean" ? c.vision : DEFAULT_CUSTOM_CAPABILITIES.vision,
      fileParts: typeof c.fileParts === "boolean" ? c.fileParts : DEFAULT_CUSTOM_CAPABILITIES.fileParts,
      reasoningEffort:
        typeof c.reasoningEffort === "boolean" ? c.reasoningEffort : DEFAULT_CUSTOM_CAPABILITIES.reasoningEffort,
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
  custom: { providerName: "", baseURL: "", model: "", ...DEFAULT_CUSTOM_CAPABILITIES },
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
      storage: createGuardedStorage(() =>
        useToastStore.getState().pushToast({
          message: "本地存储空间已满，最新更改可能无法保存，请备份后清理空间。",
          type: "error",
        })
      ),
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
        // model 非法或 provider 已回落但 model 不匹配提供商，做一次最小修复：
        // 按该 provider 真实模型表校验（此前 startsWith("") 恒真，非法/下线模型永不回落）
        if (sanitized.model && sanitized.provider && sanitized.provider !== "custom-openai") {
          try {
            const validIds = getModelsForProvider(sanitized.provider).map((m) => m.id);
            if (validIds.length > 0 && !validIds.includes(sanitized.model)) {
              sanitized.model = getDefaultModel(sanitized.provider);
            }
          } catch {
            /* 模型表不可用时保留原值，不误伤 */
          }
        }
        return { ...current, ...sanitized };
      },
    }
  )
);

export type { AISettings, AISettingsState };

// 跨窗口收敛：他窗写入同 key 后去抖 rehydrate（单窗口写时无 storage 事件，零开销）
subscribeCrossWindowSync(useAISettingsStore, "classflow-ai-settings-v1");
