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
  setOutputTextSize: (size: KiroOutputTextSize) => void;
}

export const useKiroPreferencesStore = create<KiroPreferencesState>()(
  persist(
    (set) => ({
      outputTextSize: "standard",
      setOutputTextSize: (size) => set({ outputTextSize: normalizeKiroOutputTextSize(size) }),
    }),
    {
      name: "classflow-kiro-preferences-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ outputTextSize: state.outputTextSize }),
      // 持久化值 hydrate 时同样清洗（旧数据 / 非法值 → standard）
      merge: (persisted, current) => {
        const p = persisted as Partial<KiroPreferencesState> | undefined;
        return {
          ...current,
          ...p,
          outputTextSize: normalizeKiroOutputTextSize(p?.outputTextSize),
        };
      },
    }
  )
);
