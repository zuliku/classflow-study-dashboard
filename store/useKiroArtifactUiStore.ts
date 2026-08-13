"use client";

import { create } from "zustand";

/**
 * Kiro Artifact Preview UI Store（V2 Part 3）：ephemeral，不 persist。
 * 只保存 previewArtifactId；绝不含 preview text / bytes / Source IR / handle。
 */
export interface KiroArtifactUiState {
  previewArtifactId: string | null;
  openPreview: (artifactId: string) => void;
  closePreview: () => void;
}

export const useKiroArtifactUiStore = create<KiroArtifactUiState>()((set) => ({
  previewArtifactId: null,
  openPreview: (artifactId) => set({ previewArtifactId: artifactId }),
  closePreview: () => set({ previewArtifactId: null }),
}));
