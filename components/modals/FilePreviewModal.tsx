"use client";

import React, { useState, useEffect, useRef } from "react";
import { X, Download, FileText, Loader2, Plus } from "lucide-react";
import { Material } from "@/types";
import { getFileBlob } from "@/lib/fileStorage";


import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui/Dialog";
import { onPreviewMaterial, openAssignmentEditor } from "@/lib/uiEvents";
import { useAppStore } from "@/store/useAppStore";




export function FilePreviewModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [material, setMaterial] = useState<Material | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  // Workflow UX V7：Resource → Task Promotion——
  // 通过 Store Source of Truth 反查 Material 所属课程（不修改 previewMaterial contract、
  // 不给 Material Domain 加 courseId）。找不到（已删 / stale）→ 隐藏创建任务入口。
  const courses = useAppStore((s) => s.courses);
  const sourceCourse =
    isOpen && material
      ? courses.find((c) => c.materials.some((m) => m.id === material.id)) ?? null
      : null;

  const handleCreateTask = () => {
    if (!sourceCourse || !material) return;
    openAssignmentEditor({ courseId: sourceCourse.id, materialId: material.id });
    handleClose(); // Preview semantic close；Editor 持有创建上下文
  };

  const objectUrlRef = useRef<string | null>(null);

  const releaseObjectUrl = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setPreviewUrl(null);
  };

  useEffect(() => {
    const handlePreview = (material: Material) => {
      releaseObjectUrl();
      setMaterial(material);
      setLoadFailed(false);
      setIsOpen(true);
    };

    return onPreviewMaterial(handlePreview);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // storageKey → IndexedDB 读取 Blob → createObjectURL（关闭/更换文件时 revoke）
  useEffect(() => {
    releaseObjectUrl();
    setLoadFailed(false);
    if (!isOpen || !material?.storageKey) return;

    let cancelled = false;
    setIsLoading(true);

    getFileBlob(material.storageKey)
      .then((blob) => {
        if (cancelled) return;
        if (blob) {
          const url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          setPreviewUrl(url);
        } else {
          setLoadFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material, isOpen]);

  const handleClose = () => {
    setIsOpen(false);
    releaseObjectUrl();
  };

  if (!material) return null;

  const isPdf = material.type === "pdf" || material.title.endsWith(".pdf");
  const isImage =
    material.type === "image" || !!material.title.match(/\.(png|jpg|jpeg|gif|svg|webp)$/i);
  const displayUrl = previewUrl ?? material.url;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
      overlayId="file-preview-modal"
      stackZ={50}
      aria-label="文件预览"
      className="max-w-4xl h-[88dvh]"
    >
        {/* Header（触及区 token 等价迁移：bg-background / border-line-soft） */}
        <div className="p-4 px-6 border-b border-line-soft bg-background flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-xl bg-pastel-mint border border-pastel-mint flex items-center justify-center text-charcoal shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-charcoal truncate">
                {material.title}
              </h3>
              <p className="text-[10px] text-sandrift">
                {material.size ? `${material.size} · ` : ""}上传于 {material.uploadDate}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0 ml-2">
            {/* Resource → Task Promotion：低于 Download 权重的 secondary action */}
            {sourceCourse && (
              <button
                type="button"
                onClick={handleCreateTask}
                title="基于此资料创建任务"
                aria-label="基于此资料创建任务"
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-line-strong hover:border-charcoal text-charcoal text-xs font-bold rounded-xl transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>创建任务</span>
              </button>
            )}
            {displayUrl && (
              <a
                href={displayUrl}
                download={material.title}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-xl transition-colors shadow-subtle"
              >
                <Download className="w-3.5 h-3.5" />
                <span>下载</span>
              </a>
            )}
            <button
              onClick={handleClose}
              aria-label="关闭"
              className="p-1.5 rounded-xl text-sandrift hover:bg-alba hover:text-charcoal transition-colors border border-line-strong bg-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Viewer Body */}
        <div className="flex-1 p-4 bg-charcoal flex items-center justify-center overflow-hidden relative">
          {isLoading ? (
            <div className="flex flex-col items-center space-y-2 text-white/80 text-xs">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span>正在读取文件…</span>
            </div>
          ) : loadFailed ? (
            <div className="bg-surface p-8 rounded-2xl max-w-md text-center space-y-3 shadow-2xl border border-line">
              <div className="w-14 h-14 rounded-2xl bg-danger-bg border border-danger-border flex items-center justify-center mx-auto text-danger">
                <FileText className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h4 className="text-base font-bold text-charcoal">
                  文件读取失败
                </h4>
                <p className="text-xs text-sandrift">
                  找不到该文件，可能已被删除，请重新上传。
                </p>
              </div>
            </div>
          ) : displayUrl && isPdf ? (
            <iframe
              src={displayUrl}
              className="w-full h-full rounded-xl bg-white border-none"
              title={material.title}
            />
          ) : displayUrl && isImage ? (
            <img
              src={displayUrl}
              alt={material.title}
              className="max-w-full max-h-full object-contain rounded-xl shadow-card"
            />
          ) : (
            <div className="bg-surface p-8 rounded-2xl max-w-md text-center space-y-4 shadow-2xl border border-line">
              <div className="w-14 h-14 rounded-2xl bg-alabaster border border-line-strong flex items-center justify-center mx-auto text-charcoal">
                <FileText className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h4 className="text-base font-bold text-charcoal">
                  {material.title}
                </h4>
                <p className="text-xs text-sandrift">
                  该格式支持下载后阅读
                </p>
              </div>
              {displayUrl ? (
                <a
                  href={displayUrl}
                  download={material.title}
                  className="inline-flex items-center space-x-2 px-5 py-2.5 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-xl transition-colors shadow-card"
                >
                  <Download className="w-4 h-4" />
                  <span>下载文件</span>
                </a>
              ) : (
                <div className="text-xs text-sandrift p-3 bg-background rounded-xl border border-line">
                  本地示例资料 ({material.size || "2.4 MB"})，上传后可预览与下载
                </div>
              )}
            </div>
          )}
        </div>
      </Dialog>
  );
}
