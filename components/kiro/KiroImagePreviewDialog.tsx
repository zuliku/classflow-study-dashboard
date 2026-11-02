"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { pushOverlay, popOverlay, isTopmostOverlay } from "@/lib/overlayStack";
import { useFocusTrap } from "@/lib/useFocusTrap";

/** Gallery 项：runtime File（调用方从 Live Image Source Registry 解析；绝不落历史） */
export interface KiroImagePreviewSource {
  file: File;
  name: string;
}

/**
 * Kiro Image Preview Dialog（Visual Intake V1.5 / V1.5.1）：
 * 大图预览（聊天截图核对）—— 可靠审阅，不做图片编辑 / crop / OCR / zoom editor。
 *
 * 长聊天截图：Scroll Viewport（width min(94vw, 1080px) / max-height ~86dvh / overflow auto），
 * 图片 display:block + h-auto + max-w-100%（不再对 img 设 max-height —— 超长竖图按可读宽度
 * 显示并纵向滚动，而不是被压缩成窄条）。
 *
 * 多来源（G）：sources[] + initialIndex → ←/→ 切换 + 「1 / 3」计数 + ArrowLeft/ArrowRight。
 * 这只是 Source Gallery，绝不声称某条 Action 与某张图存在精确 mapping。
 *
 * Accessibility（F）：Esc / Backdrop / Close 关闭；aria-modal + accessible name；
 * 打开时聚焦 Close Button；关闭后 restore previous focus；body scroll lock。
 *
 * Object URL 生命周期（本组件全权负责）：current source 变化 / 关闭 / unmount → revoke；
 * 不缓存任何 object URL；File/Blob/URL 绝不进入历史。
 */
export function KiroImagePreviewDialog({
  source,
  sources,
  initialIndex,
  onClose,
}: {
  /** 当前展示的 runtime File（null = 不渲染；历史恢复后无 File） */
  source: KiroImagePreviewSource | null;
  /** 可选 Gallery：多来源（如 Proposal Source Strip 的全部截图） */
  sources?: KiroImagePreviewSource[];
  /** 初始索引（默认 0） */
  initialIndex?: number;
  onClose: () => void;
}) {
  const gallery = sources && sources.length > 1 ? sources : null;
  const [index, setIndex] = useState(() => Math.max(0, initialIndex ?? 0));
  const current = gallery ? gallery[index] : source;
  const [url, setUrl] = useState<string | null>(null);
  // P0：图片加载失败态（此前 createObjectURL 失败直接 return null 消失，img 坏图只剩空白 viewport，用户以为卡死）
  const [loadError, setLoadError] = useState(false);
  // 失败原地重试：不关闭画廊（index 保留），重建 object URL + 重载 img
  const [retryKey, setRetryKey] = useState(0);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const safeIndex = (() => {
    if (!gallery) return 0;
    return Math.min(Math.max(index, 0), gallery.length - 1);
  })();
  const currentSource = gallery ? gallery[safeIndex] : source;
  // S2-1 焦点陷阱：aria-modal 已声明，Tab 不得逃逸到背后页面（此前缺 trap）；
  // 与 Dialog/Drawer 同一 useFocusTrap 语义
  const trapTab = useFocusTrap(panelRef, !!currentSource);

  // ---- Object URL lifecycle：current source 变化 → 旧 revoke + 新 create ----
  useEffect(() => {
    setLoadError(false);
    if (!currentSource) {
      setUrl(null);
      return;
    }
    let created = "";
    try {
      created = URL.createObjectURL(currentSource.file);
    } catch {
      created = "";
    }
    setUrl(created || null);
    return () => {
      if (created) URL.revokeObjectURL(created);
    };
  }, [currentSource, retryKey]);

  // ---- Focus management + body scroll lock ----
  // prev focus / scroll lock 在 source 挂载时捕获；恢复在 cleanup（unmount / source 变化）
  useEffect(() => {
    if (!currentSource) return;
    prevFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      prevFocusRef.current?.focus?.();
    };
  }, [currentSource]);

  // 对话框真正可见（url ready）后聚焦 Close Button
  useEffect(() => {
    if (url) closeBtnRef.current?.focus();
  }, [url]);

  // ---- Esc / 方向键（Gallery）----
  // Esc 经 overlay 栈 topmost 判定（预览叠在审批/Dialog 上时不穿透双关）
  const step = useCallback(
    (delta: number) => {
      if (!gallery) return;
      setIndex((prev) => Math.min(Math.max(prev + delta, 0), gallery.length - 1));
    },
    [gallery]
  );
  useEffect(() => {
    if (!currentSource) return;
    pushOverlay("kiro-image-preview", 80);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isTopmostOverlay("kiro-image-preview")) onClose();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      popOverlay("kiro-image-preview");
    };
  }, [currentSource, onClose, step]);

  // P0：URL 创建失败也进对话框错误态（此前直接 return null 消失，用户盲按 Esc）
  if (!currentSource) return null;
  const urlFailed = !url;

  const total = gallery?.length ?? 1;
  const shownIndex = gallery ? safeIndex : 0;

  return createPortal(
    <div
      data-testid="kiro-image-preview"
      ref={panelRef}
      onKeyDown={trapTab}
      className="fixed inset-x-0 bottom-0 top-[var(--titlebar-h)] z-[80] flex items-center justify-center p-4 md:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={currentSource.name ? `查看原图：${currentSource.name}` : "查看原图"}
    >
      {/* Backdrop — 与全局灯箱同一强磨砂层；enter 一次性播放，退出由父级卸载 */}
      <div
        data-testid="kiro-image-preview-backdrop"
        className="absolute inset-0 ux-scrim-strong animate-enter"
        onClick={onClose}
      />

      <div className="animate-enter relative flex flex-col w-[min(94vw,1080px)] max-h-[86dvh]">
        {/* Header：名称 + Gallery 计数 + Close */}
        <div className="flex items-center justify-between gap-3 mb-2 shrink-0">
          <p className="min-w-0 truncate text-[11px] font-semibold text-white/90">
            {currentSource.name ?? "图片预览"}
          </p>
          {gallery && (
            <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-white/70">
              <button
                data-testid="kiro-image-preview-prev"
                onClick={() => step(-1)}
                disabled={safeIndex === 0}
                aria-label="上一张"
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              {shownIndex + 1} / {total}
              <button
                data-testid="kiro-image-preview-next"
                onClick={() => step(1)}
                disabled={safeIndex === total - 1}
                aria-label="下一张"
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </span>
          )}
          <button
            ref={closeBtnRef}
            data-testid="kiro-image-preview-close"
            onClick={onClose}
            aria-label="关闭预览"
            className="w-8 h-8 shrink-0 flex items-center justify-center rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scroll Viewport：长截图可滚动；图片保持原比例（不做 max-height 压缩） */}
        <div
          data-testid="kiro-image-preview-viewport"
          className="overflow-auto rounded-2xl bg-white shadow-card border border-white/10"
          style={{ maxHeight: "calc(86dvh - 44px)" }}
        >
          {loadError || urlFailed ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <p className="text-xs font-bold text-charcoal">原图加载失败</p>
              <p className="text-[11px] text-sandrift">文件可能已损坏或过大，可原地重试（画廊位置保留）</p>
              <div className="mt-1 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setLoadError(false);
                    setRetryKey((k) => k + 1);
                  }}
                  className="px-3 h-8 rounded-lg text-[11px] font-bold text-white bg-charcoal hover:bg-black transition-colors"
                >
                  重试
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 h-8 rounded-lg text-[11px] font-bold text-charcoal bg-alabaster hover:bg-pastel-mint transition-colors"
                >
                  关闭
                </button>
              </div>
            </div>
          ) : (
            <img
              data-testid="kiro-image-preview-image"
              key={retryKey}
              src={url}
              alt={currentSource.name ?? "截图预览"}
              onError={() => setLoadError(true)}
              className="block h-auto max-w-full mx-auto"
            />
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
