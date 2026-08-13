"use client";

import { useCallback } from "react";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";
import { useKiroArtifactUiStore } from "@/store/useKiroArtifactUiStore";
import { useToastStore } from "@/store/useToastStore";
import { getArtifactPreview, getArtifactDownloadPayload } from "@/lib/ai/computer/artifacts/access";
import { triggerArtifactDownload } from "@/lib/ai/computer/artifacts/download";

/**
 * Artifact UI Actions（Preview / Download）。
 * 用户显式 UI Read：不启用 Computer、不改 Artifact metadata、不写 audit、不消耗 Agent quota。
 * 点击瞬间读取 live workspaces（Artifact Access Service 内部强制 grant/sandbox 检查）。
 */
export function useKiroArtifactActions() {
  const pushToast = useToastStore((s) => s.pushToast);
  const openPreview = useKiroArtifactUiStore((s) => s.openPreview);

  const previewArtifact = useCallback(
    (artifactId: string) => {
      openPreview(artifactId);
    },
    [openPreview]
  );

  const downloadArtifact = useCallback(
    async (artifactId: string) => {
      try {
        const workspaces = useKiroComputerStore.getState().workspaces;
        const payload = await getArtifactDownloadPayload({ artifactId, workspaces });
        triggerArtifactDownload(payload);
      } catch (err) {
        const message = err instanceof Error ? err.message : "下载失败";
        pushToast({ message, type: "error" });
      }
    },
    [pushToast]
  );

  return { previewArtifact, downloadArtifact };
}

export { getArtifactPreview };
