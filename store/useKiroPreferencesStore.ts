"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  KiroOutputTextSize,
  normalizeKiroOutputTextSize,
} from "@/lib/ai/ui/typography";

/**
 * Kiro UI Preference（独立于业务 useAppStore / useAISettingsStore）：
 * - 当前只有 Kiro 输出字号（YAGNI：不塞 density / font family / theme）
 * - 持久化：localStorage `classflow-kiro-preferences-v1`
 * - Workspace 与 Sidecar 共用（都经 KiroChatSurface 读取）
 */

interface KiroPreferencesState {
  outputTextSize: KiroOutputTextSize;
  /** Task 7E：自动环境上下文（auto/entry 中的 auto 部分；manual @ 不受影响） */
  autoContextEnabled: boolean;
  setOutputTextSize: (size: KiroOutputTextSize) => void;
  setAutoContextEnabled: (enabled: boolean) => void;
}

export const useKiroPreferencesStore = create<KiroPreferencesState>()(
  persist(
    (set) => ({
      outputTextSize: "standard",
      autoContextEnabled: true,
      setOutputTextSize: (size) => set({ outputTextSize: normalizeKiroOutputTextSize(size) }),
      setAutoContextEnabled: (enabled) => set({ autoContextEnabled: enabled }),
    }),
    {
      name: "classflow-kiro-preferences-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        outputTextSize: state.outputTextSize,
        autoContextEnabled: state.autoContextEnabled,
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
        };
      },
    }
  )
);
