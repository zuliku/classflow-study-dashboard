"use client";

import { useCallback } from "react";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";
import { useKiroArtifactUiStore } from "@/store/useKiroArtifactUiStore";
import { useToastStore } from "@/store/useToastStore";
import { getArtifactPreview, getArtifactDownloadPayload } from "@/lib/ai/computer/artifacts/access";
import { triggerArtifactDownload } from "@/lib/ai/computer/artifacts/download";
import { getArtifact } from "@/lib/ai/computer/artifacts/service";
import { deleteWorkspaceFile } from "@/lib/ai/computer/filesystem/deleteFile";

/**
 * Artifact UI Actions（Preview / Download / Delete）。
 * 用户显式 UI 操作：不启用 Computer、不消耗 Agent quota。
 * Delete 走共享 deleteWorkspaceFile（确认 Dialog 即 user gesture；仍完整检查 read-write/grant/path）。
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

  const deleteArtifact = useCallback(
    async (artifactId: string): Promise<boolean> => {
      try {
        const artifact = await getArtifact(artifactId);
        if (!artifact) {
          pushToast({ message: "文件记录不存在。", type: "error" });
          return false;
        }
        const workspaces = useKiroComputerStore.getState().workspaces;
        await deleteWorkspaceFile({
          workspaceId: artifact.workspaceId,
          rootId: artifact.rootId,
          relativePath: artifact.relativePath,
          workspaces,
        });
        pushToast({ message: `已删除 ${artifact.displayName}` });
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "删除失败";
        pushToast({ message, type: "error" });
        return false;
      }
    },
    [pushToast]
  );

  return { previewArtifact, downloadArtifact, deleteArtifact };
}

export { getArtifactPreview };
