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
import { KiroWebSearchCredentialMode } from "@/lib/ai/web/types";
import {
  DEFAULT_WEB_PDF_VISION_MODEL,
  normalizeWebPdfVisionModel,
} from "@/lib/ai/web/vision/models";
import {
  SidecarSize,
  SIDECAR_DEFAULT_SIZE,
  normalizeSidecarSize,
} from "@/lib/ai/ui/sidecarSize";
import {
  SidecarPosition,
  SIDECAR_DEFAULT_POSITION,
  normalizeSidecarPosition,
} from "@/lib/ai/ui/sidecarPosition";

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
  /** Task 14：Kiro Search（联网搜索）；Key 绝不进入 Store */
  webSearchEnabled: boolean;
  webSearchCredentialMode: KiroWebSearchCredentialMode;
  /** Task 19C1：扫描 Web PDF Vision（设置；Key 绝不进入 Store） */
  webPdfVisionEnabled: boolean;
  webPdfVisionModel: string;
  /** Sidecar UX V2：面板尺寸（用户拖拽调整后持久化；首次使用默认值） */
  sidecarSize: SidecarSize;
  /** Sidecar Move V1：浮动面板位置（top/right；拖拽后持久化；首次使用右上 24px） */
  sidecarPosition: SidecarPosition;
  setOutputTextSize: (size: KiroOutputTextSize) => void;
  setAutoContextEnabled: (enabled: boolean) => void;
  setResponsePreference: (preference: KiroResponsePreference) => void;
  setWebSearchEnabled: (enabled: boolean) => void;
  setWebSearchCredentialMode: (mode: KiroWebSearchCredentialMode) => void;
  setWebPdfVisionEnabled: (enabled: boolean) => void;
  setWebPdfVisionModel: (model: string) => void;
  setSidecarSize: (size: SidecarSize) => void;
  setSidecarPosition: (position: SidecarPosition) => void;
}

export const useKiroPreferencesStore = create<KiroPreferencesState>()(
  persist(
    (set) => ({
      outputTextSize: "standard",
      autoContextEnabled: true,
      responsePreference: DEFAULT_KIRO_RESPONSE_PREFERENCE,
      webSearchEnabled: true,
      webSearchCredentialMode: "server",
      webPdfVisionEnabled: true,
      webPdfVisionModel: DEFAULT_WEB_PDF_VISION_MODEL,
      sidecarSize: SIDECAR_DEFAULT_SIZE,
      sidecarPosition: SIDECAR_DEFAULT_POSITION,
      setOutputTextSize: (size) => set({ outputTextSize: normalizeKiroOutputTextSize(size) }),
      setAutoContextEnabled: (enabled) => set({ autoContextEnabled: enabled }),
      setResponsePreference: (preference) =>
        set({ responsePreference: normalizeKiroResponsePreference(preference) }),
      setWebSearchEnabled: (enabled) => set({ webSearchEnabled: enabled }),
      setWebSearchCredentialMode: (mode) =>
        set({ webSearchCredentialMode: mode === "byok" ? "byok" : "server" }),
      setWebPdfVisionEnabled: (enabled) => set({ webPdfVisionEnabled: enabled }),
      // Store 内永远不保存任意 model id（非法 → 默认 mimo-v2.5）
      setWebPdfVisionModel: (model) => set({ webPdfVisionModel: normalizeWebPdfVisionModel(model) }),
      // 结构归一后保存；viewport clamp 由 Shell 在浏览器内执行
      setSidecarSize: (size) => set({ sidecarSize: normalizeSidecarSize(size) }),
      setSidecarPosition: (position) =>
        set({ sidecarPosition: normalizeSidecarPosition(position) }),
    }),
    {
      name: "classflow-kiro-preferences-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        outputTextSize: state.outputTextSize,
        autoContextEnabled: state.autoContextEnabled,
        responsePreference: state.responsePreference,
        webSearchEnabled: state.webSearchEnabled,
        webSearchCredentialMode: state.webSearchCredentialMode,
        // Task 19C1：持久化设置（API Key 绝不进入 partialize）
        webPdfVisionEnabled: state.webPdfVisionEnabled,
        webPdfVisionModel: state.webPdfVisionModel,
        // Sidecar UX V2：尺寸持久化（刷新后保留；不进 URL / IndexedDB）
        sidecarSize: state.sidecarSize,
        // Sidecar Move V1：浮动位置持久化（top/right；key 不变，不建 v2）
        sidecarPosition: state.sidecarPosition,
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
          // Task 14：旧持久化无字段 → 默认 enabled=true / server
          webSearchEnabled:
            typeof p?.webSearchEnabled === "boolean" ? p.webSearchEnabled : true,
          webSearchCredentialMode: p?.webSearchCredentialMode === "byok" ? "byok" : "server",
          // Task 19C1：旧持久化无字段 → 默认 enabled=true / mimo-v2.5；非法持久化模型 → 归一
          webPdfVisionEnabled:
            typeof p?.webPdfVisionEnabled === "boolean" ? p.webPdfVisionEnabled : true,
          webPdfVisionModel: normalizeWebPdfVisionModel(p?.webPdfVisionModel),
          // Sidecar UX V2：旧持久化无字段 → 默认尺寸；非法值 → 结构归一
          sidecarSize: normalizeSidecarSize(p?.sidecarSize),
          // Sidecar Move V1：旧持久化无字段 → 默认右上 24px；非法值 → 归一
          sidecarPosition: normalizeSidecarPosition(p?.sidecarPosition),
        };
      },
    }
  )
);
