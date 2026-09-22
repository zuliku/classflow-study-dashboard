"use client";

import { useCallback } from "react";
import { useKiroComputerStore } from "@/store/useKiroComputerStore";
import { useKiroArtifactUiStore } from "@/store/useKiroArtifactUiStore";
import { useToastStore } from "@/store/useToastStore";
import { useKiroSessionActions } from "@/components/kiro/KiroSessionProvider";
import { getArtifactPreview, getArtifactDownloadPayload } from "@/lib/ai/computer/artifacts/access";
import { artifactToContextRef } from "@/lib/ai/computer/artifacts/context";
import { triggerArtifactDownload } from "@/lib/ai/computer/artifacts/download";
import { getArtifact } from "@/lib/ai/computer/artifacts/service";
import { deleteWorkspaceFile } from "@/lib/ai/computer/filesystem/deleteFile";

/**
 * Artifact UI Actions（Preview / Download / Delete / Ask Kiro）。
 * 用户显式 UI 操作：不启用 Computer quota、不写 audit。
 * - Delete 走共享 deleteWorkspaceFile（确认 Dialog 即 user gesture；仍完整检查 read-write/grant/path）
 * - Ask Kiro 只添加 Manual Context（不自动发送）；context ref 由 canonical artifactToContextRef 构造
 * - addManualContext 从 KiroSessionActionsContext 获取（稳定 callback；避免订阅 streaming runtime）
 */
export function useKiroArtifactActions() {
  const pushToast = useToastStore((s) => s.pushToast);
  const openPreview = useKiroArtifactUiStore((s) => s.openPreview);
  const bumpArtifactUiVersion = useKiroArtifactUiStore((s) => s.bumpArtifactUiVersion);
  const addManualContext = useKiroSessionActions().addManualContext;

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
        // Inspector P2：UI invalidation（常驻面板立即刷新 Outputs）
        bumpArtifactUiVersion();
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "删除失败";
        pushToast({ message, type: "error" });
        return false;
      }
    },
    [bumpArtifactUiVersion, pushToast]
  );

  /**
   * Ask Kiro：把工作区文件加入 Manual Context（用户显式要求 → 可显式开启 Computer；
   * 绝不切换 Workspace / 绝不请求 Browser 授权）。
   */
  const askKiroArtifact = useCallback(
    async (artifactId: string): Promise<boolean> => {
      const activeWorkspaceId = useKiroComputerStore.getState().activeWorkspaceId;
      const artifact = await getArtifact(artifactId);
      if (!artifact) {
        pushToast({ message: "文件记录不存在。", type: "error" });
        return false;
      }
      if (!activeWorkspaceId || artifact.workspaceId !== activeWorkspaceId) {
        pushToast({ message: "该文件不属于当前工作区，无法加入上下文。", type: "error" });
        return false;
      }
      if (!useKiroComputerStore.getState().computerEnabled) {
        useKiroComputerStore.getState().setComputerEnabled(true);
      }
      addManualContext(artifactToContextRef(artifact));
      pushToast({ message: "已添加到 Kiro 上下文" });
      return true;
    },
    [addManualContext, pushToast]
  );

  return { previewArtifact, downloadArtifact, deleteArtifact, askKiroArtifact };
}

export { getArtifactPreview };
