"use client";

import { create } from "zustand";
import type { DesktopObservationUiEvidence } from "@/lib/ai/computer/gui/uiEvidence";

/**
 * Desktop Session Preview Store（P5）— **完全 ephemeral** 的「最近画面」。
 *
 * 契约（§22/§23）：
 * - 只保存**最新一张** bounded screenshot evidence；不保留历史帧；
 * - 绝不 persist（无 localStorage / IndexedDB / filesystem / history / audit / console）；
 * - 刷新即消失；session 切换 / terminal / 受保护应用 / Computer 权限关闭 → 清理；
 * - 只允许 KiroComputerSessionPreview 订阅（Conversation / Composer / Navigator 绝不订阅）；
 * - 保存同一 string reference（不做 base64 克隆）。
 */
export interface DesktopSessionPreview {
  sessionId: string;
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
  capturedAt: string;
  appName: string;
  windowTitle: string;
}

export interface DesktopSessionPreviewState {
  preview: DesktopSessionPreview | null;
  /** 真实观察证据 → 替换为最新一张（blocked evidence 由调用方过滤） */
  setPreview: (evidence: DesktopObservationUiEvidence) => void;
  /**
   * 清理 preview：
   * - 无 sessionId → 无条件清理（新 session / 权限关闭 / Stop）；
   * - 带 sessionId → 只清理匹配的（旧 session 的迟到事件不得清掉新 session 的画面）。
   */
  clearPreview: (sessionId?: string) => void;
}

export const useDesktopSessionPreviewStore = create<DesktopSessionPreviewState>()((set, get) => ({
  preview: null,
  setPreview: (evidence) => {
    if (evidence.appProfileBlocked) return;
    set({
      preview: {
        sessionId: evidence.sessionId,
        dataUrl: evidence.dataUrl,
        mimeType: evidence.mimeType,
        width: evidence.width,
        height: evidence.height,
        capturedAt: evidence.capturedAt,
        appName: evidence.appName,
        windowTitle: evidence.windowTitle,
      },
    });
  },
  clearPreview: (sessionId) => {
    const current = get().preview;
    if (!current) return;
    if (sessionId !== undefined && current.sessionId !== sessionId) return;
    set({ preview: null });
  },
}));
