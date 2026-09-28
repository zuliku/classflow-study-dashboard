"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Plus, Trash2 } from "lucide-react";
import { useKiroSessionActions } from "@/components/kiro/KiroSessionProvider";
import { useConfirmStore } from "@/store/useConfirmStore";
import { useToastStore } from "@/store/useToastStore";
import { KiroNavigatorSectionHeader } from "@/components/kiro/navigation/KiroNavigatorProjects";
import { KiroProjectFileRecord, MAX_PROJECT_FILES_PER_PROJECT } from "@/lib/ai/projects/files/types";
import { listProjectFiles, createProjectFile, deleteProjectFile } from "@/lib/ai/projects/files/db";
import { routeAttachment } from "@/lib/ai/attachments/router";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function FileTextIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 text-sandrift shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  );
}

/**
 * Kiro Navigator — Project Files 单元（V1.3A 能力迁移）。
 * 只在 Project Detail 挂载（lazy）：进入时读取 listProjectFiles；
 * 上传 / 删除后通过 actions.refreshProjects() 触发父级与自身刷新（quota / 进度语义保持）。
 */
export function KiroNavigatorProjectFiles({
  projectId,
  refreshToken,
}: {
  projectId: string;
  /** meta.projectsVersion：上传 / 删除后外部刷新信号 */
  refreshToken: number;
}) {
  const actions = useKiroSessionActions();
  const confirmRequest = useConfirmStore((s) => s.confirm);
  const pushToast = useToastStore((s) => s.pushToast);
  const [files, setFiles] = useState<KiroProjectFileRecord[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    listProjectFiles(projectId)
      .then((list) => {
        if (!cancelled) setFiles(list);
      })
      .catch(() => {
        if (!cancelled) pushToast({ message: "项目资料加载失败，请重试", type: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshToken, pushToast]);

  const handleUploadFiles = useCallback(
    async (input: FileList | null) => {
      if (!input || input.length === 0 || uploading) return;
      const quotaLeft = MAX_PROJECT_FILES_PER_PROJECT - files.length;
      const accepted: File[] = [];
      for (const file of Array.from(input)) {
        const routed = routeAttachment(file);
        if (!routed.ok) {
          pushToast({ message: "项目资料暂支持 PDF、DOCX、TXT、Markdown 和 PNG/JPEG/WEBP 图片。", type: "error" });
          continue;
        }
        if (accepted.length >= quotaLeft) break;
        accepted.push(file);
      }
      if (accepted.length === 0) return;
      if (accepted.length < Array.from(input).length) {
        pushToast({ message: `项目最多保存 ${MAX_PROJECT_FILES_PER_PROJECT} 个资料，已添加可容纳的文件。` });
      }
      setUploading(true);
      setUploadProgress({ done: 0, total: accepted.length });
      try {
        let added = 0;
        for (const file of accepted) {
          const routed = routeAttachment(file);
          if (!routed.ok) continue;
          await createProjectFile({
            projectId,
            name: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            kind: routed.kind as KiroProjectFileRecord["kind"],
            blob: file,
          });
          added++;
          setUploadProgress({ done: added, total: accepted.length });
        }
        actions.refreshProjects();
        if (added > 0) pushToast({ message: `已添加 ${added} 个资料` });
      } catch (err) {
        const message = (err as { message?: string })?.message;
        if (message === "PROJECT_FILE_LIMIT_REACHED") {
          pushToast({ message: `项目最多保存 ${MAX_PROJECT_FILES_PER_PROJECT} 个资料。`, type: "error" });
        } else {
          pushToast({ message: "资料上传失败，请重试", type: "error" });
        }
      } finally {
        setUploading(false);
        setUploadProgress(null);
      }
    },
    [actions, files.length, projectId, pushToast, uploading]
  );

  const requestDeleteFile = (file: KiroProjectFileRecord) => {
    confirmRequest({
      title: "删除项目资料？",
      description: "这不会删除你的聊天记录，但 Kiro 将无法再读取该资料。",
      confirmLabel: "删除",
      danger: true,
      onConfirm: () => {
        void deleteProjectFile(file.id)
          .then(() => {
            actions.refreshProjects();
            pushToast({ message: "已删除资料" });
          })
          .catch(() => pushToast({ message: "资料删除失败，请重试", type: "error" }));
      },
      onCancel: () => {},
    });
  };

  return (
    <div className="pb-1" data-testid="kiro-navigator-project-files">
      <KiroNavigatorSectionHeader
        label={`资料 · ${files.length}`}
        action={
          uploading && uploadProgress ? (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-sandrift">
              <span
                className="w-3 h-3 border border-sandrift/30 border-t-sandrift rounded-full animate-spin"
                aria-hidden="true"
              />
              上传中 {uploadProgress.done}/{uploadProgress.total}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || files.length >= MAX_PROJECT_FILES_PER_PROJECT}
              aria-label="添加项目资料"
              className="flex items-center gap-0.5 px-1.5 h-5 rounded-md text-[10px] font-semibold text-satin-grey bg-alabaster hover:bg-pastel-mint hover:text-charcoal transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-3 h-3" />
              添加资料
            </button>
          )
        }
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.xlsx,.xls,.pptx,.csv,.txt,.md,.markdown,.png,.jpg,.jpeg,.webp"
        aria-label="上传项目资料"
        className="hidden"
        onChange={(e) => {
          void handleUploadFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {files.length === 0 ? (
        <p className="px-1.5 text-[10px] text-sandrift mt-0.5">暂无项目资料</p>
      ) : (
        <div className="mt-0.5 space-y-0.5">
          {files.map((file) => (
            <div key={file.id} className="flex items-center gap-2 px-1.5 py-1 rounded-lg group/file">
              {file.kind === "image" ? (
                <ImageIcon className="w-3.5 h-3.5 shrink-0 text-sandrift" />
              ) : (
                <FileTextIcon />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-semibold text-charcoal truncate">{file.name}</span>
                <span className="block text-[9px] text-sandrift">
                  {file.kind === "image" ? "IMAGE" : file.kind.toUpperCase()} · {formatBytes(file.sizeBytes)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => requestDeleteFile(file)}
                aria-label={`删除项目资料 ${file.name}`}
                className="p-1 rounded-md text-sandrift hover:bg-alabaster hover:text-danger transition-colors opacity-0 group-hover/file:opacity-100 group-focus-within/file:opacity-100"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
