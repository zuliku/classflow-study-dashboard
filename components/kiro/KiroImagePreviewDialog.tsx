"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * Kiro Image Preview Dialog（Visual Intake V1.5）：
 * 大图预览（聊天截图核对）。只接受 runtime File（调用方从 Live Image Source Registry 解析）。
 *
 * Object URL 生命周期（本组件全权负责）：
 * - file 变化 / 挂载：URL.createObjectURL(file)
 * - 关闭 / file 变化 / unmount：URL.revokeObjectURL(当前 url)
 * 不缓存任何 object URL；不把 File/Blob/URL 写入历史。
 *
 * 交互：Esc / Backdrop / Close Button 关闭；图片保持原比例，
 * max viewport 内可滚动查看长聊天截图；无图片编辑器。
 */
export function KiroImagePreviewDialog({
  file,
  name,
  onClose,
}: {
  file: File | null;
  name?: string;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    let created = "";
    try {
      created = URL.createObjectURL(file);
    } catch {
      created = "";
    }
    setUrl(created || null);
    return () => {
      if (created) URL.revokeObjectURL(created);
    };
  }, [file]);

  // Esc 关闭（Dialog 挂载期间全局生效）
  useEffect(() => {
    if (!file) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [file, onClose]);

  if (!file || !url) return null;

  return createPortal(
    <div
      data-testid="kiro-image-preview"
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 md:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={name ? `查看原图：${name}` : "查看原图"}
    >
      {/* Backdrop */}
      <div
        data-testid="kiro-image-preview-backdrop"
        className="absolute inset-0 bg-charcoal/60 backdrop-blur-[2px]"
        onClick={onClose}
      />

      <div className="relative max-w-[94vw] max-h-[92dvh] w-auto flex flex-col items-stretch">
        <div className="flex items-center justify-between gap-3 mb-2 shrink-0">
          <p className="min-w-0 truncate text-[11px] font-semibold text-white/90">{name ?? "图片预览"}</p>
          <button
            data-testid="kiro-image-preview-close"
            onClick={onClose}
            aria-label="关闭预览"
            title="关闭预览"
            className="w-8 h-8 shrink-0 flex items-center justify-center rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 长截图可滚动；保持原比例（object-contain 不裁剪） */}
        <div className="overflow-auto rounded-2xl bg-white shadow-card border border-white/10">
          <img src={url} alt={name ?? "截图预览"} className="max-w-none h-auto object-contain" style={{ maxHeight: "80dvh" }} />
        </div>
      </div>
    </div>,
    document.body
  );
}
