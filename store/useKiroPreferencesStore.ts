"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  KiroOutputTextSize,
  normalizeKiroOutputTextSize,
} from "@/lib/ai/ui/typography";
import {
  KiroResponsePreference,
  DEFAULT_KIRO_RESPONSE_PREFERENCE,
  normalizeKiroResponsePreference,
} from "@/lib/ai/responsePreference";

/**
 * Kiro UI / Behavior Preference（独立于业务 useAppStore / useAISettingsStore）：
 * - 输出字号 / 自动环境上下文 / 回答偏好
 * - 持久化：localStorage `classflow-kiro-preferences-v1`（key 不变，不建 v2）
 * - Workspace 与 Sidecar 共用（都经 KiroChatSurface 读取）
 */

interface KiroPreferencesState {
  outputTextSize: KiroOutputTextSize;
  /** Task 7E：自动环境上下文（auto/entry 中的 auto 部分；manual @ 不受影响） */
  autoContextEnabled: boolean;
  /** Intelligence V2 Task 1：回答偏好（只影响 Final Answer 表达深度） */
  responsePreference: KiroResponsePreference;
  setOutputTextSize: (size: KiroOutputTextSize) => void;
  setAutoContextEnabled: (enabled: boolean) => void;
  setResponsePreference: (preference: KiroResponsePreference) => void;
}

export const useKiroPreferencesStore = create<KiroPreferencesState>()(
  persist(
    (set) => ({
      outputTextSize: "standard",
      autoContextEnabled: true,
      responsePreference: DEFAULT_KIRO_RESPONSE_PREFERENCE,
      setOutputTextSize: (size) => set({ outputTextSize: normalizeKiroOutputTextSize(size) }),
      setAutoContextEnabled: (enabled) => set({ autoContextEnabled: enabled }),
      setResponsePreference: (preference) =>
        set({ responsePreference: normalizeKiroResponsePreference(preference) }),
    }),
    {
      name: "classflow-kiro-preferences-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        outputTextSize: state.outputTextSize,
        autoContextEnabled: state.autoContextEnabled,
        responsePreference: state.responsePreference,
      }),
      // 持久化值 hydrate 时同样清洗（旧数据 / 非法值 → 默认）
      merge: (persisted, current) => {
        const p = persisted as Partial<KiroPreferencesState> | undefined;
        return {
          ...current,
          ...p,
          outputTextSize: normalizeKiroOutputTextSize(p?.outputTextSize),
          // 旧持久化（Task 7C 时代）没有该字段 → 默认 true
          autoContextEnabled:
            typeof p?.autoContextEnabled === "boolean" ? p.autoContextEnabled : true,
          // 旧持久化没有 responsePreference → 默认 dense；非法旧数据 → dense
          responsePreference: normalizeKiroResponsePreference(p?.responsePreference),
        };
      },
    }
  )
);
