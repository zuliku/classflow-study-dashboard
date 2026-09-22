"use client";

import { create } from "zustand";

/**
 * Kiro Artifact Preview UI Store（V2 Part 3）：ephemeral，不 persist。
 * 只保存 previewArtifactId；绝不含 preview text / bytes / Source IR / handle。
 *
 * Kiro Inspector P2：增加 artifactUiVersion —— 仅 UI invalidation scalar（delete / 移除失效记录后 +1），
 * 用于常驻 Inspector 刷新 Outputs；Artifact 内容绝不进入 store。
 */
export interface KiroArtifactUiState {
  previewArtifactId: string | null;
  artifactUiVersion: number;
  openPreview: (artifactId: string) => void;
  closePreview: () => void;
  bumpArtifactUiVersion: () => void;
}

export const useKiroArtifactUiStore = create<KiroArtifactUiState>()((set) => ({
  previewArtifactId: null,
  artifactUiVersion: 0,
  openPreview: (artifactId) => set({ previewArtifactId: artifactId }),
  closePreview: () => set({ previewArtifactId: null }),
  bumpArtifactUiVersion: () => set((state) => ({ artifactUiVersion: state.artifactUiVersion + 1 })),
}));
