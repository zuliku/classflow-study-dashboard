"use client";

import React, { useState, useEffect, useRef } from "react";
import { X, Download, FileText, Loader2 } from "lucide-react";
import { Material } from "@/types";
import { getFileBlob } from "@/lib/fileStorage";

export function FilePreviewModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [material, setMaterial] = useState<Material | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const objectUrlRef = useRef<string | null>(null);

  const releaseObjectUrl = () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setPreviewUrl(null);
  };

  useEffect(() => {
    const handlePreview = (e: CustomEvent) => {
      if (e.detail?.material) {
        releaseObjectUrl();
        setMaterial(e.detail.material);
        setLoadFailed(false);
        setIsOpen(true);
      }
    };

    window.addEventListener("preview-material" as any, handlePreview);
    return () => window.removeEventListener("preview-material" as any, handlePreview);
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

  if (!isOpen || !material) return null;

  const isPdf = material.type === "pdf" || material.title.endsWith(".pdf");
  const isImage =
    material.type === "image" || !!material.title.match(/\.(png|jpg|jpeg|gif|svg|webp)$/i);
  const displayUrl = previewUrl ?? material.url;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-in fade-in">
      <div className="w-full max-w-4xl bg-white rounded-3xl shadow-2xl border border-[#E7E3DD] flex flex-col h-[88vh] overflow-hidden">
        {/* Header */}
        <div className="p-4 px-6 border-b border-[#F0EBE1] bg-[#F7F5F5] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-xl bg-[#E3E6E0] border border-[#D0D5CC] flex items-center justify-center text-charcoal shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-charcoal truncate">
                {material.title}
              </h3>
              <p className="text-[10px] text-[#8C827A]">
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
                <span>下载原文件</span>
              </a>
            )}
            <button
              onClick={handleClose}
              className="p-1.5 rounded-xl text-[#8C827A] hover:bg-[#E0D7C6] hover:text-charcoal transition-colors border border-[#E0D7C6] bg-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Viewer Body */}
        <div className="flex-1 p-4 bg-[#313032] flex items-center justify-center overflow-hidden relative">
          {isLoading ? (
            <div className="flex flex-col items-center space-y-2 text-white/80 text-xs">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span>正在从本地存储读取文件…</span>
            </div>
          ) : loadFailed ? (
            <div className="bg-white p-8 rounded-3xl max-w-md text-center space-y-3 shadow-2xl border border-[#E7E3DD]">
              <div className="w-14 h-14 rounded-2xl bg-[#FDF0F0] border border-[#F8D7D7] flex items-center justify-center mx-auto text-[#D94F4F]">
                <FileText className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h4 className="text-base font-bold text-charcoal">
                  文件读取失败
                </h4>
                <p className="text-xs text-[#8C827A]">
                  本地存储中找不到该文件，可能已被删除。请返回课程资料重新上传。
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
              className="max-w-full max-h-full object-contain rounded-xl shadow-lg"
            />
          ) : (
            <div className="bg-white p-8 rounded-3xl max-w-md text-center space-y-4 shadow-2xl border border-[#E7E3DD]">
              <div className="w-14 h-14 rounded-2xl bg-[#F0EBE1] border border-[#E0D7C6] flex items-center justify-center mx-auto text-charcoal">
                <FileText className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h4 className="text-base font-bold text-charcoal">
                  {material.title}
                </h4>
                <p className="text-xs text-[#8C827A]">
                  此格式支持本地高清直接下载与阅读
                </p>
              </div>
              {displayUrl ? (
                <a
                  href={displayUrl}
                  download={material.title}
                  className="inline-flex items-center space-x-2 px-5 py-2.5 bg-charcoal hover:bg-black text-white text-xs font-bold rounded-xl transition-colors shadow-card"
                >
                  <Download className="w-4 h-4" />
                  <span>立刻保存/下载原文件</span>
                </a>
              ) : (
                <div className="text-xs text-[#8C827A] p-3 bg-[#F7F5F5] rounded-xl border border-[#E7E3DD]">
                  演示课件文件 ({material.size || "2.4 MB"}) · 真实上传文件后支持直接预览与下载
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
