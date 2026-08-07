"use client";

import React, { useState, useEffect, useRef } from "react";
import { X, Download, FileText, Loader2 } from "lucide-react";
import { Material } from "@/types";
import { getFileBlob } from "@/lib/fileStorage";
import { usePresence } from "@/lib/usePresence";
import { useRestoreFocus } from "@/lib/useRestoreFocus";
import { cn } from "@/lib/utils";
import { onPreviewMaterial } from "@/lib/uiEvents";
import { pushOverlay, popOverlay, isTopmostOverlay } from "@/lib/overlayStack";

const OVERLAY_ID = "file-preview-modal";

export function FilePreviewModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [material, setMaterial] = useState<Material | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const objectUrlRef = useRef<string | null>(null);
  const { mounted, visible } = usePresence(isOpen, 220);
  useRestoreFocus(isOpen);

  // Esc 关闭
  useEffect(() => {
    if (!mounted) return;
    pushOverlay(OVERLAY_ID, 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopmostOverlay(OVERLAY_ID)) {
        setIsOpen(false);
        releaseObjectUrl();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      popOverlay(OVERLAY_ID);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

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

  if (!mounted || !material) return null;

  const isPdf = material.type === "pdf" || material.title.endsWith(".pdf");
  const isImage =
    material.type === "image" || !!material.title.match(/\.(png|jpg|jpeg|gif|svg|webp)$/i);
  const displayUrl = previewUrl ?? material.url;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6",
        "ux-overlay",
        visible ? "opacity-100" : "opacity-0"
      )}
    >
      <div
        className={cn(
          "w-full max-w-4xl bg-surface rounded-2xl shadow-2xl border border-line flex flex-col h-[88vh] overflow-hidden",
          "ux-modal-panel",
          visible ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-[0.985] translate-y-1"
        )}
      >
        {/* Header */}
        <div className="p-4 px-6 border-b border-[#F0EBE1] bg-[#F7F5F5] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-xl bg-pastel-mint border border-pastel-mint flex items-center justify-center text-charcoal shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-charcoal truncate">
                {material.title}
              </h3>
              <p className="text-[10px] text-sandrift">
                {material.size || "1.5 MB"} · 上传于 {material.uploadDate}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0 ml-2">
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
                <div className="text-xs text-sandrift p-3 bg-[#F7F5F5] rounded-xl border border-line">
                  本地示例资料 ({material.size || "2.4 MB"})，上传后可预览与下载
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
